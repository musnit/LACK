// Runs the live strategy in a separate, locked-down Node process and drives it
// with the kit's Player calls over IPC. The child:
//   - may only read game/ and strategies/ (Node permission model): no token,
//     no ~/.config, no /proc, no file writes, no child processes or workers;
//   - has no network when Linux user namespaces allow it (`unshare --net`);
//   - gets an empty environment and no command-line secrets;
//   - can't stall the bot: each turn has a deadline, and a child that misses
//     STALL_LIMIT deadlines in a row is killed.
// Hot reload: live/ is checked for changes about once a second. Changed code
// starts in a fresh child, and once it has loaded every game switches to it at
// its next turn: the new code gets a fresh instance with the current round's
// context, just like after a reconnect, so only in-memory strategy state starts
// over. A crashed child is replaced the same way. Code that fails to load is
// logged and skipped until live/ changes again.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../../..');
const RUNNER = path.join(__dirname, 'runner.js');
const STALL_LIMIT = 3;
const MARGIN_MS = 40;   // our own share of each turn's time budget
const INERT = Object.freeze({ round() {}, turn: async () => [], roundEnd() {}, finish() {} });

let unshare;   // absolute path to unshare if it can give us a network namespace, else null
function networkIsolation() {
    if (unshare !== undefined) return unshare;
    const found = (process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, 'unshare')).find(file => fs.existsSync(file));
    const works = found && spawnSync(found, ['--user', '--map-root-user', '--net', 'true'], { stdio: 'ignore' }).status === 0;
    unshare = works ? found : null;
    return unshare;
}

// A fingerprint of every file under `dir`; it changes whenever the code does.
function versionOf(dir) {
    return fs.readdirSync(dir, { recursive: true }).sort().map(name => {
        const stat = fs.statSync(path.join(dir, name));
        return stat.isFile() ? `${name}:${stat.size}:${stat.mtimeMs}` : '';
    }).join('|');
}

class Sandbox {
    #entry; #readable; #log;
    #current = null;     // the child games play on
    #candidate = null;   // newer code, still loading
    #failedVersion = null;
    #nextGame = 1;
    #checkEveryMs; #checkedAt = 0;

    constructor({ entry, readable = [path.join(REPO, 'game'), path.join(REPO, 'strategies')], log = () => {}, checkEveryMs = 1000 }) {
        this.#entry = entry;
        this.#checkEveryMs = checkEveryMs;
        this.#readable = [...new Set([...readable, path.dirname(entry), __dirname])];
        this.#log = log;
    }

    // Per-game handle with the Player methods, backed by the newest working child.
    open() {
        this.#refresh();
        const seat = { box: null, game: 0, round: null };
        if (!this.#seat(seat)) return INERT;
        return {
            round: (width, height, targetShape) => {
                seat.round = { width, height, targetShape };
                this.#post(seat.box, { type: 'round', game: seat.game, ...seat.round });
            },
            turn: (state, remainingMs) => {
                if (Date.now() - this.#checkedAt >= this.#checkEveryMs) this.#refresh();
                const current = this.#current;
                if (current && !current.dead && current !== seat.box) this.#seat(seat);
                return this.#turn(seat.box, seat.game, state, remainingMs);
            },
            roundEnd: outcomes => this.#post(seat.box, { type: 'roundEnd', game: seat.game, outcomes }),
            finish: result => {
                this.#post(seat.box, { type: 'finish', game: seat.game, result });
                seat.box.games.delete(seat.game);
                this.#retireIfDone(seat.box);
            }
        };
    }

    // Put a game on the newest working child, moving it off its old one (if any)
    // and replaying the current round's context. Returns false if there's no child.
    #seat(seat) {
        const box = this.#current && !this.#current.dead ? this.#current : this.#candidate;
        if (!box) return false;
        if (seat.box) {
            this.#post(seat.box, { type: 'release', game: seat.game });
            seat.box.games.delete(seat.game);
            this.#retireIfDone(seat.box);
        }
        seat.box = box;
        seat.game = this.#nextGame++;
        box.games.add(seat.game);
        this.#post(box, { type: 'create', game: seat.game });
        if (seat.round) this.#post(box, { type: 'round', game: seat.game, ...seat.round });
        return true;
    }

    // Load the live code once and report { ok, error }. Used by check.js.
    probe(timeoutMs = 5000) {
        const box = this.#spawn('probe');
        return new Promise(resolve => {
            const done = result => { clearTimeout(timer); this.#stopChild(box); resolve(result); };
            const timer = setTimeout(() => done({ ok: false, error: 'timed out while loading' }), timeoutMs);
            box.onLoad = done;
        });
    }

    stop() {
        for (const box of [this.#current, this.#candidate]) if (box) this.#stopChild(box);
        this.#current = this.#candidate = null;
    }

    #refresh() {
        this.#checkedAt = Date.now();
        const version = versionOf(path.dirname(this.#entry));
        const newest = this.#candidate ?? this.#current;
        if (newest && !newest.dead && newest.version === version) return;
        if (version === this.#failedVersion) return;
        if (this.#candidate) this.#stopChild(this.#candidate);
        const box = this.#spawn(version);
        box.onLoad = ({ ok, error }) => this.#loaded(box, ok, error);
        this.#candidate = box;
    }

    #loaded(box, ok, error) {
        if (box !== this.#candidate) return;
        this.#candidate = null;
        if (!ok) {
            this.#failedVersion = box.version;
            this.#log(`live strategy failed to load, keeping the previous one: ${error}`);
            return;
        }
        const old = this.#current;
        this.#current = box;
        if (old) {
            old.retired = true;
            this.#retireIfDone(old);
            this.#log('loaded updated live strategy');
        }
    }

    #spawn(version) {
        const args = ['--permission', ...this.#readable.map(dir => `--allow-fs-read=${dir}`), RUNNER, this.#entry];
        const isolate = networkIsolation();
        const [command, argv] = isolate
            ? [isolate, ['--user', '--map-root-user', '--net', '--', process.execPath, ...args]]
            : [process.execPath, args];
        const child = spawn(command, argv, { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: {} });
        const box = { child, version, games: new Set(), pending: new Map(), nextRequest: 1, stalls: 0, dead: false, retired: false, errors: new Set(), onLoad: null };
        child.unref();
        child.channel?.unref();
        child.on('error', error => this.#died(box, error.message));
        child.on('exit', (code, signal) => this.#died(box, `exited (${signal || code})`));
        child.on('message', message => {
            if (message?.type === 'ready') box.onLoad?.({ ok: true });
            else if (message?.type === 'load-error') box.onLoad?.({ ok: false, error: message.message });
            else if (message?.type === 'result') box.pending.get(message.id)?.(message.commands);
            if (message?.error) this.#liveError(box, message.error);
        });
        return box;
    }

    #turn(box, game, state, remainingMs = 500) {
        if (box.dead) return Promise.resolve([]);
        const id = box.nextRequest++;
        const budget = Math.max(5, remainingMs - MARGIN_MS);
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                box.pending.delete(id);
                if (++box.stalls >= STALL_LIMIT) {
                    this.#log(`live strategy missed ${STALL_LIMIT} turn deadlines in a row; restarting it`);
                    this.#stopChild(box);
                }
                resolve([]);
            }, budget);
            box.pending.set(id, commands => {
                clearTimeout(timer);
                box.pending.delete(id);
                box.stalls = 0;
                resolve(Array.isArray(commands) ? commands : []);
            });
            this.#post(box, { type: 'turn', game, id, state, remainingMs: budget });
        });
    }

    #post(box, message) {
        if (box.dead || !box.child.connected) return;
        try { box.child.send(message); } catch {}
    }

    #liveError(box, error) {
        if (box.errors.has(error) || box.errors.size >= 20) return;
        box.errors.add(error);
        this.#log(`live strategy error: ${error}`);
    }

    #died(box, reason) {
        if (box.dead) return;
        box.dead = true;
        for (const reply of box.pending.values()) reply([]);
        box.onLoad?.({ ok: false, error: `sandbox ${reason}` });
        if (!box.retired && box.version !== 'probe' && box === this.#current) this.#log(`live strategy process ${reason}`);
    }

    #retireIfDone(box) {
        if (box.retired && box.games.size === 0) this.#stopChild(box);
    }

    #stopChild(box) {
        box.retired = true;
        box.dead = true;
        for (const reply of box.pending.values()) reply([]);
        box.child.kill();
    }
}

module.exports = { Sandbox };
