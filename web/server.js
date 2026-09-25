// LACK dashboard: gym runs, live bot control, recorded live games and strategy source.
// No dependencies. Serves on HOST/PORT (defaults 127.0.0.1:8080).
//
//   node web/server.js
//
// The live bot reads its token from ~/.config/lack/token (never from this repo).
const http = require('node:http');
const { fork, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { PRESETS } = require('../gym/presets');
const Game = require('../game/Game');
const { replayFromRecording } = require('./replay');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(__dirname, 'public');
const RECORDINGS = path.join(ROOT, 'gym', 'recordings');
const RUNS = path.join(ROOT, 'gym', 'runs');
const SETTINGS_DIR = path.join(os.homedir(), '.config', 'lack');
const TOKEN_FILE = path.join(SETTINGS_DIR, 'token');
const LIVE_FILE = path.join(SETTINGS_DIR, 'live.json');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8080);
fs.mkdirSync(RUNS, { recursive: true });

// ---------- helpers ----------
const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = req => new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (error) { reject(error); } });
});
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

// ---------- strategies ----------
function listStrategies() {
    const files = ['player.js', ...fs.readdirSync(path.join(ROOT, 'strategies')).filter(file => file.endsWith('.js')).map(file => `strategies/${file}`)];
    return files.map(file => {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const summary = source.split('\n').filter(line => line.startsWith('//')).slice(0, 3).map(line => line.replace(/^\/\/\s?/, '')).join(' ');
        return { file, lines: source.split('\n').length, summary, live: file === 'player.js' };
    });
}
const isStrategy = file => listStrategies().some(entry => entry.file === file);

// ---------- presets (built-in plus configs recorded from the live server) ----------
function presets() {
    const list = Object.entries(PRESETS).map(([id, config]) => ({ id, label: `${id} (README defaults)`, config }));
    const latest = readJson(path.join(RECORDINGS, 'latest-config.json'), null);
    for (const mode of ['arena', 'clash']) {
        const recorded = readJson(path.join(RECORDINGS, `latest-${mode}.json`), latest?.mode === mode ? latest : null);
        if (recorded) list.push({ id: `live-${mode}`, label: `${mode} (recorded live ${recorded.receivedAt?.slice(0, 10)})`,
            config: { ...PRESETS[mode], ...recorded.config, unitsPerPlayer: recorded.count } });
    }
    return list;
}
const describe = config => ({ ...config, shapes: config.shapes.map(shape => shape.name) });

// ---------- gym runs ----------
const runs = new Map();
for (const file of fs.readdirSync(RUNS).filter(file => file.endsWith('.json'))) {
    const run = readJson(path.join(RUNS, file), null);
    if (!run) continue;
    if (run.status === 'running') run.status = 'interrupted';
    runs.set(run.id, run);
}
const saveRun = run => fs.writeFileSync(path.join(RUNS, `${run.id}.json`), JSON.stringify(run));
const workers = new Map();

function startRun({ strategies, preset, games, golem }) {
    if (!Array.isArray(strategies) || strategies.length < 2 || strategies.length > 8 || !strategies.every(isStrategy)) {
        throw new Error('Pick 2–8 strategies.');
    }
    if (golem && !isStrategy(golem)) throw new Error('Unknown golem strategy.');
    const chosen = presets().find(entry => entry.id === preset);
    if (!chosen) throw new Error('Unknown preset.');
    const count = Math.max(1, Math.min(200, Math.floor(Number(games) || 1)));
    const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + randomUUID().slice(0, 4);
    const run = { id, status: 'running', strategies, golem: golem || null, preset, games: count,
        config: describe(chosen.config), names: [], results: [], replays: [], startedAt: Date.now(), finishedAt: null, error: null };
    runs.set(id, run);
    saveRun(run);
    fs.mkdirSync(path.join(RUNS, id), { recursive: true });

    const spec = { strategies, golem: golem || null, games: count, config: chosen.config };
    const worker = fork(path.join(__dirname, 'gym-worker.js'), [JSON.stringify(spec)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    workers.set(id, worker);
    let output = '';
    const capture = chunk => { output = (output + chunk).slice(-4000); };
    worker.stdout.on('data', capture);
    worker.stderr.on('data', capture);
    worker.on('message', message => {
        if (message.type === 'start') run.names = message.names;
        if (message.type === 'game') {
            run.results.push({ index: message.index, rounds: message.result.rounds, endReason: message.result.endReason, players: message.result.players });
            if (message.replay) {
                fs.writeFileSync(path.join(RUNS, id, `${message.index}.json`), JSON.stringify(message.replay));
                run.replays.push(message.index);
            }
        }
        if (message.type === 'error') run.error = message.message;
        saveRun(run);
    });
    worker.on('exit', code => {
        workers.delete(id);
        if (run.status === 'running') run.status = code === 0 ? 'done' : run.error ? 'failed' : 'stopped';
        if (!run.error && code !== 0 && run.status === 'failed') run.error = output;
        run.output = output;
        run.finishedAt = Date.now();
        saveRun(run);
    });
    return run;
}

function stopRun(id) {
    const run = runs.get(id);
    const worker = workers.get(id);
    if (!run || !worker) return false;
    run.status = 'stopped';
    worker.kill();
    return true;
}

const runSummary = ({ replays, output, ...run }) => ({ ...run, replays });

// ---------- live bot ----------
const live = { child: null, startedAt: null, exitedAt: null, exitCode: null, log: [] };
const liveSettings = () => ({ autostart: false, endpoint: 'wss://latticeanimals.com/ws', ...readJson(LIVE_FILE, {}) });
const saveLiveSettings = settings => {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    fs.writeFileSync(LIVE_FILE, JSON.stringify(settings, null, 2));
};
const logLive = text => {
    for (const line of String(text).split('\n').filter(Boolean)) live.log.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
    if (live.log.length > 500) live.log.splice(0, live.log.length - 500);
};

function startLive() {
    if (live.child) return;
    let token;
    try { token = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch {}
    if (!token) throw new Error(`No token. Save your player token to ${TOKEN_FILE}.`);
    const { endpoint } = liveSettings();
    const child = spawn(process.execPath, [path.join(ROOT, 'gym', 'record.js'), token, endpoint], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    live.child = child;
    live.startedAt = Date.now();
    live.exitCode = null;
    logLive(`--- started live bot (pid ${child.pid}) using player.js ---`);
    child.stdout.on('data', logLive);
    child.stderr.on('data', logLive);
    child.on('exit', code => {
        logLive(`--- live bot exited (${code}) ---`);
        if (live.child === child) Object.assign(live, { child: null, exitedAt: Date.now(), exitCode: code });
    });
    saveLiveSettings({ ...liveSettings(), autostart: true });
}

function stopLive({ remember = true } = {}) {
    const child = live.child;
    if (remember) saveLiveSettings({ ...liveSettings(), autostart: false });
    if (!child) return Promise.resolve();
    return new Promise(resolve => { child.once('exit', resolve); child.kill(); });
}

const liveStatus = () => ({
    running: !!live.child, pid: live.child?.pid ?? null, startedAt: live.startedAt, exitedAt: live.exitedAt,
    exitCode: live.exitCode, hasToken: fs.existsSync(TOKEN_FILE), tokenFile: TOKEN_FILE,
    endpoint: liveSettings().endpoint, log: live.log.slice(-200)
});

// ---------- recordings ----------
const recordingCache = new Map();
function recordingInfo(file) {
    const full = path.join(RECORDINGS, file);
    const stat = fs.statSync(full);
    const cached = recordingCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.info;
    let mode = null, finished = null, rounds = 0, firstAt = null, units = null;
    for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
        if (!line) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        const { message } = entry;
        firstAt ??= entry.at;
        if (message.game?.mode) mode = message.game.mode;
        if (message.type === 'player-round') rounds++;
        if (message.type === 'player-turn' && units === null) units = message.state.units.length;
        if (message.type === 'player-finished') finished = { endReason: message.endReason, results: message.results, ours: message.result };
    }
    const info = { id: file.replace(/\.jsonl$/, ''), mode, rounds, units, startedAt: firstAt, updatedAt: stat.mtimeMs,
        finished, inProgress: !finished && Date.now() - stat.mtimeMs < 120000, size: stat.size };
    recordingCache.set(file, { mtimeMs: stat.mtimeMs, info });
    return info;
}
const listRecordings = () => fs.existsSync(RECORDINGS)
    ? fs.readdirSync(RECORDINGS).filter(file => file.endsWith('.jsonl') && file !== 'configs.jsonl').map(recordingInfo).sort((a, b) => b.updatedAt - a.updatedAt)
    : [];

// ---------- routing ----------
const routes = [
    ['GET', /^\/api\/overview$/, () => ({
        live: { ...liveStatus(), log: undefined },
        runs: [...runs.values()].filter(run => run.status === 'running').map(runSummary),
        recordings: listRecordings().filter(recording => recording.inProgress)
    })],
    ['GET', /^\/api\/strategies$/, () => listStrategies()],
    ['GET', /^\/api\/strategy$/, (req, url) => {
        const file = url.searchParams.get('file');
        if (!isStrategy(file)) return [404, { error: 'Not found' }];
        return { file, source: fs.readFileSync(path.join(ROOT, file), 'utf8') };
    }],
    ['GET', /^\/api\/presets$/, () => presets().map(({ id, label, config }) => ({ id, label, config: describe(config) }))],
    ['GET', /^\/api\/runs$/, () => [...runs.values()].sort((a, b) => b.startedAt - a.startedAt).map(runSummary)],
    ['POST', /^\/api\/runs$/, async req => runSummary(startRun(await readBody(req)))],
    ['GET', /^\/api\/runs\/([\w-]+)$/, (req, url, [, id]) => runs.has(id) ? runs.get(id) : [404, { error: 'Not found' }]],
    ['POST', /^\/api\/runs\/([\w-]+)\/stop$/, (req, url, [, id]) => ({ stopped: stopRun(id) })],
    ['DELETE', /^\/api\/runs\/([\w-]+)$/, (req, url, [, id]) => {
        if (workers.has(id) || !runs.has(id)) return [409, { error: 'Stop the run first.' }];
        runs.delete(id);
        fs.rmSync(path.join(RUNS, `${id}.json`), { force: true });
        fs.rmSync(path.join(RUNS, id), { recursive: true, force: true });
        return { deleted: true };
    }],
    ['GET', /^\/api\/runs\/([\w-]+)\/replays\/(\d+)$/, (req, url, [, id, index]) => {
        const file = path.join(RUNS, id, `${Number(index)}.json`);
        return fs.existsSync(file) ? [200, fs.readFileSync(file, 'utf8')] : [404, { error: 'No replay' }];
    }],
    ['GET', /^\/api\/live$/, () => liveStatus()],
    ['POST', /^\/api\/live\/start$/, () => { startLive(); return liveStatus(); }],
    ['POST', /^\/api\/live\/stop$/, async () => { await stopLive(); return liveStatus(); }],
    ['POST', /^\/api\/live\/restart$/, async () => { await stopLive(); startLive(); return liveStatus(); }],
    ['GET', /^\/api\/recordings$/, () => listRecordings()],
    ['GET', /^\/api\/recordings\/([\w-]+)$/, (req, url, [, id]) => {
        const file = path.join(RECORDINGS, `${id}.jsonl`);
        return fs.existsSync(file) ? replayFromRecording(file) : [404, { error: 'Not found' }];
    }],
    ['GET', /^\/api\/shapes$/, () => Game.SHAPES]
];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
        if (url.pathname.startsWith('/api/')) {
            // Browsers can't send this header cross-site without a preflight, which we never approve.
            if (req.method !== 'GET' && req.headers['x-lack'] !== '1') return send(res, 403, { error: 'Missing header' });
            for (const [method, pattern, handler] of routes) {
                const match = req.method === method && url.pathname.match(pattern);
                if (!match) continue;
                const out = await handler(req, url, match);
                if (Array.isArray(out) && typeof out[0] === 'number') {
                    return send(res, out[0], out[1]);
                }
                return send(res, 200, out);
            }
            return send(res, 404, { error: 'Not found' });
        }
        const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
        if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found', 'text/plain');
        send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] ?? 'application/octet-stream');
    } catch (error) {
        send(res, 400, { error: error.message });
    }
});

server.listen(PORT, HOST, () => {
    console.log(`LACK dashboard on http://${HOST}:${PORT}`);
    if (liveSettings().autostart) {
        try { startLive(); } catch (error) { logLive(error.message); }
    }
});
for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
        for (const worker of workers.values()) worker.kill();
        await stopLive({ remember: false });
        process.exit(0);
    });
}
