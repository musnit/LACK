'use strict';
// LACK dashboard front end: plain JS, hash routes, one poll timer per page.

const view = document.getElementById('view');
const TEAM_COLORS = ['#ff4fa3', '#4f8cff', '#f5b942', '#3ecf8e', '#b58cff', '#ff7a45', '#2ec4d6', '#d4d86a'];
const GOLEM_COLOR = '#8a8f9c';
let pollTimer = null;
let cleanup = [];

// ---------- tiny helpers ----------
function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === false || value == null) continue;
        if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
        else if (key === 'class') el.className = value;
        else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
        else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat(Infinity)) {
        if (child == null || child === false) continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
}
// replaceChildren, but skipping null/false like h() does.
const set = (el, ...children) => el.replaceChildren(...children.flat(Infinity).filter(child => child != null && child !== false)
    .map(child => child instanceof Node ? child : document.createTextNode(String(child))));
async function api(path, options = {}) {
    const res = await fetch(`/api/${path}`, {
        ...options,
        headers: { 'content-type': 'application/json', 'x-lack': '1', ...options.headers },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (res.redirected || res.status === 401) { location.reload(); throw new Error('Signed out'); }
    const data = await res.json().catch(() => ({ error: `Unexpected response (${res.status})` }));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}
function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 3500);
}
const ago = time => {
    if (!time) return '—';
    const seconds = Math.round((Date.now() - time) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
    return new Date(time).toLocaleDateString();
};
const duration = ms => {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`;
};
const teamColor = (replay, team) => replay.teams[team]?.name === 'golem' ? GOLEM_COLOR : TEAM_COLORS[team % TEAM_COLORS.length];
const statusBadge = status => h('span', { class: `badge ${{ running: 'live', done: 'good', failed: 'bad', stopped: 'warn', interrupted: 'warn' }[status] ?? ''}` }, status);
function poll(fn, ms) {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (!document.hidden) fn().catch(() => {}); }, ms);
}
function shapeMini(shape, color = 'var(--accent)') {
    const grid = h('span', { class: 'shape-mini', style: { gridTemplateColumns: `repeat(${shape.width}, 10px)` }, 'aria-label': `shape ${shape.name}` });
    const cells = new Set(shape.cells.map(([x, y]) => `${x},${y}`));
    for (let y = 0; y < shape.height; y++) for (let x = 0; x < shape.width; x++) {
        grid.append(h('i', { style: { background: cells.has(`${x},${y}`) ? color : 'transparent' } }));
    }
    return grid;
}
function table(headers, rows, onRow) {
    return h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, headers.map(label => h('th', { scope: 'col' }, label)))),
        h('tbody', {}, rows.map(row => h('tr', onRow ? {
            class: 'clickable', tabindex: 0,
            onclick: () => onRow(row), onkeydown: event => { if (event.key === 'Enter') onRow(row); }
        } : {}, row.cells.map(cell => h('td', {}, cell)))))));
}

// ---------- routing ----------
const pages = { overview: Overview, gym: Gym, live: Live, recordings: Recordings, strategies: Strategies };
async function route() {
    clearInterval(pollTimer);
    cleanup.forEach(fn => fn());
    cleanup = [];
    const [page = 'overview', ...rest] = location.hash.replace(/^#/, '').split('/');
    const render = pages[page] ?? Overview;
    for (const link of document.querySelectorAll('.top nav a')) {
        link.toggleAttribute('aria-current', link.getAttribute('href') === `#${page}`);
        if (link.hasAttribute('aria-current')) link.setAttribute('aria-current', 'page');
    }
    set(view, h('p', { class: 'muted' }, 'Loading…'));
    try {
        await render(decodeURIComponent(rest.join('/')));
    } catch (error) {
        set(view, h('p', { class: 'error' }, error.message));
    }
    view.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);

// ---------- Overview ----------
async function Overview() {
    const draw = async () => {
        const [overview, recordings, runs] = await Promise.all([api('overview'), api('recordings'), api('runs')]);
        const finished = recordings.filter(recording => recording.finished?.ours);
        const wins = finished.filter(recording => recording.finished.ours.winner).length;
        const live = overview.live;
        set(view, 
            h('h1', {}, 'Overview'),
            h('div', { class: 'grid two' },
                h('section', { class: 'card' },
                    h('h2', {}, 'Live bot ', live.running ? h('span', { class: 'badge live' }, 'running') : h('span', { class: 'badge warn' }, 'stopped')),
                    h('p', { class: 'muted small' }, live.running ? `Up ${duration(Date.now() - live.startedAt)} · playing ${live.runningStrategy}` : 'Not connected to the server.'),
                    h('div', { class: 'stat-row' },
                        h('div', { class: 'stat' }, h('b', {}, overview.recordings.length), h('span', {}, 'games in progress')),
                        h('div', { class: 'stat' }, h('b', {}, `${wins}/${finished.length}`), h('span', {}, 'recorded games won'))),
                    h('p', {}, h('a', { href: '#live' }, 'Manage live bot →'))),
                h('section', { class: 'card' },
                    h('h2', {}, 'Gym runs in progress'),
                    overview.runs.length ? overview.runs.map(runProgress) : h('p', { class: 'muted' }, 'None running.'),
                    h('p', {}, h('a', { href: '#gym' }, 'Start a gym run →')))),
            h('section', { class: 'card' },
                h('h2', {}, 'Live games in progress'),
                overview.recordings.length
                    ? recordingTable(overview.recordings)
                    : h('p', { class: 'muted' }, 'No live games right now.')),
            h('section', { class: 'card' },
                h('h2', {}, 'Recent gym runs'),
                runs.length ? runTable(runs.slice(0, 5)) : h('p', { class: 'muted' }, 'No runs yet.')));
    };
    await draw();
    poll(draw, 3000);
}

function runProgress(run) {
    return h('div', { style: { marginBottom: '0.75rem' } },
        h('a', { href: `#gym/${run.id}` }, run.names.join(' vs ') || run.strategies.join(' vs ')),
        h('div', { class: 'muted small' }, `${run.results.length}/${run.games} games · ${run.preset}`),
        h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': run.games, 'aria-valuenow': run.results.length },
            h('i', { style: { width: `${100 * run.results.length / run.games}%` } })));
}

// ---------- Gym ----------
async function Gym(id) {
    if (id) return GymRun(id);
    const [strategies, presets, runs] = await Promise.all([api('strategies'), api('presets'), api('runs')]);
    const form = h('form', { class: 'card', onsubmit: async event => {
        event.preventDefault();
        const data = new FormData(form);
        const chosen = [];
        for (const entry of strategies) {
            const copies = Number(data.get(`count:${entry.file}`) || 0);
            for (let i = 0; i < copies; i++) chosen.push(entry.file);
        }
        try {
            const run = await api('runs', { method: 'POST', body: {
                strategies: chosen, preset: data.get('preset'), games: Number(data.get('games')), golem: data.get('golem') || null } });
            location.hash = `#gym/${run.id}`;
        } catch (error) { toast(error.message); }
    } },
        h('h2', {}, 'New run'),
        h('fieldset', {}, h('legend', {}, 'Players (2–8 total)'),
            h('p', { class: 'muted small', style: { margin: '0 0 0.5rem' } }, 'Choose how many copies of each strategy play in the same game.'),
            strategies.map(entry => h('label', { class: 'check' },
                h('input', { type: 'number', name: `count:${entry.file}`, min: 0, max: 8, value: entry.live || entry.file === 'strategies/random.js' ? 1 : 0,
                    style: { width: '4.5rem', minHeight: '40px', height: 'auto' }, 'aria-label': `Copies of ${entry.file}` }),
                h('span', {}, h('code', {}, entry.file), entry.live ? h('span', { class: 'badge live', style: { marginLeft: '0.4rem' } }, 'live') : null)))),
        h('div', { class: 'row-inputs' },
            h('label', { class: 'field' }, h('span', {}, 'Settings'),
                h('select', { name: 'preset' }, presets.map(preset => h('option', { value: preset.id }, preset.label)))),
            h('label', { class: 'field' }, h('span', {}, 'Games'), h('input', { type: 'number', name: 'games', min: 1, max: 200, value: 10 })),
            h('label', { class: 'field' }, h('span', {}, 'Golem (noncompetitive team)'),
                h('select', { name: 'golem' }, h('option', { value: '' }, 'none'), strategies.map(entry => h('option', { value: entry.file }, entry.file))))),
        h('button', { class: 'primary', type: 'submit' }, 'Start run'));

    const list = h('section', { class: 'card' }, h('h2', {}, 'Runs'), runs.length ? runTable(runs) : h('p', { class: 'empty' }, 'No runs yet. Start one above.'));
    set(view, h('h1', {}, 'Gym'), h('p', { class: 'muted' }, 'Plays strategies locally with the reference engine. Up to 10 games per run keep a full replay.'), form, list);
    if (runs.some(run => run.status === 'running')) poll(async () => {
        const fresh = await api('runs');
        set(list, h('h2', {}, 'Runs'), runTable(fresh));
    }, 2000);
}

function scoreboard(run) {
    const rows = new Map();
    let draws = 0;
    for (const game of run.results) {
        let winner = false;
        for (const player of game.players.filter(player => player.competitive)) {
            const row = rows.get(player.name) ?? { name: player.name, wins: 0, energy: 0, survivors: 0, errors: 0, late: 0 };
            row.wins += player.result?.winner ? 1 : 0;
            row.energy += player.result?.totalEnergy ?? 0;
            row.survivors += player.result?.survivorCount ?? 0;
            row.errors += player.errors;
            row.late += player.late;
            winner ||= !!player.result?.winner;
            rows.set(player.name, row);
        }
        if (!winner) draws++;
    }
    return { rows: [...rows.values()].sort((a, b) => b.wins - a.wins || b.energy - a.energy), draws, games: run.results.length };
}

function runTable(runs) {
    return table(['Started', 'Players', 'Settings', 'Progress', 'Status', 'Leader'], runs.map(run => {
        const board = scoreboard(run);
        const leader = board.rows[0];
        return { run, cells: [ago(run.startedAt), run.names.join(' vs ') || run.strategies.join(' vs '), run.preset,
            `${run.results.length}/${run.games}`, statusBadge(run.status),
            leader ? `${leader.name} (${leader.wins} wins)` : '—'] };
    }), row => { location.hash = `#gym/${row.run.id}`; });
}

async function GymRun(id) {
    let run = await api(`runs/${id}`);
    let selected = null;
    const replayHost = h('div');
    const draw = () => {
        const board = scoreboard(run);
        set(view, 
            h('p', {}, h('a', { href: '#gym' }, '← All runs')),
            h('h1', {}, run.names.join(' vs ') || run.strategies.join(' vs ')),
            h('section', { class: 'card' },
                h('div', { class: 'buttons', style: { justifyContent: 'space-between', alignItems: 'center' } },
                    h('div', {}, statusBadge(run.status), ' ', h('span', { class: 'muted' },
                        `${run.results.length}/${run.games} games · ${run.preset} · ${run.config.width}×${run.config.height}, ${run.config.unitsPerPlayer} units each, ${run.config.maxRounds}×${run.config.turnsPerRound} turns`)),
                    h('div', { class: 'buttons' },
                        run.status === 'running' ? h('button', { class: 'danger', onclick: async () => { await api(`runs/${id}/stop`, { method: 'POST' }); toast('Stopping run'); } }, 'Stop') : null,
                        h('button', { onclick: async () => {
                            const again = await api('runs', { method: 'POST', body: { strategies: run.strategies, preset: run.preset, games: run.games, golem: run.golem } });
                            location.hash = `#gym/${again.id}`;
                        } }, 'Run again'),
                        run.status !== 'running' ? h('button', { class: 'danger', onclick: async () => {
                            if (!confirm('Delete this run and its replays?')) return;
                            await api(`runs/${id}`, { method: 'DELETE' });
                            location.hash = '#gym';
                        } }, 'Delete') : null)),
                run.status === 'running' ? h('div', { class: 'bar', style: { marginTop: '0.75rem' } }, h('i', { style: { width: `${100 * run.results.length / run.games}%` } })) : null,
                run.error ? h('pre', { class: 'log error', style: { marginTop: '0.75rem' } }, run.error) : null),
            h('section', { class: 'card' },
                h('h2', {}, 'Scoreboard'),
                board.games ? table(['Strategy', 'Wins', 'Win %', 'Avg energy', 'Avg survivors', 'Errors', 'Late turns'], board.rows.map((row, index) => ({ cells: [
                    h('span', {}, h('span', { class: 'swatch', style: { display: 'inline-block', verticalAlign: 'middle', marginRight: '0.4rem', background: TEAM_COLORS[run.names.indexOf(row.name) % TEAM_COLORS.length] } }), row.name),
                    row.wins, `${Math.round(100 * row.wins / board.games)}%`, (row.energy / board.games).toFixed(1),
                    (row.survivors / board.games).toFixed(1), row.errors, row.late] }))) : h('p', { class: 'muted' }, 'Waiting for the first game…'),
                board.games ? h('p', { class: 'muted small' }, `Draws: ${board.draws}`) : null),
            h('section', { class: 'card' },
                h('h2', {}, 'Games'),
                run.results.length ? table(['#', 'Winner', 'Rounds', 'End', 'Replay'], run.results.map(game => {
                    const winner = game.players.find(player => player.result?.winner);
                    return { game, cells: [game.index + 1, winner?.name ?? 'draw', game.rounds, game.endReason,
                        run.replays.includes(game.index) ? h('span', { class: 'badge' }, selected === game.index ? 'showing' : 'watch') : '—'] };
                }), row => { if (run.replays.includes(row.game.index)) showReplay(row.game.index); }) : h('p', { class: 'muted' }, 'No games yet.')),
            replayHost);
    };
    const showReplay = async index => {
        selected = index;
        draw();
        set(replayHost, h('section', { class: 'card' }, h('p', { class: 'muted' }, 'Loading replay…')));
        const replay = await api(`runs/${id}/replays/${index}`);
        set(replayHost, h('section', { class: 'card' }, h('h2', {}, `Game ${index + 1} replay`), Viewer(replay)));
        replayHost.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    };
    draw();
    if (run.replays.length) showReplay(run.replays[0]);
    if (run.status === 'running') poll(async () => {
        const before = run.results.length;
        run = await api(`runs/${id}`);
        if (run.results.length !== before || run.status !== 'running') {
            draw();
            if (selected === null && run.replays.length) showReplay(run.replays[0]);
        }
        if (run.status !== 'running') clearInterval(pollTimer);
    }, 1500);
}

// ---------- Live bot ----------
async function Live() {
    const log = h('pre', { class: 'log mono', tabindex: 0, 'aria-label': 'Live bot log' });
    const status = h('div');
    const strategies = await api('strategies');
    // Built once so the 3-second refresh doesn't reset it while you're choosing.
    const picker = h('select', { id: 'live-strategy' }, strategies.map(entry => h('option', { value: entry.name }, entry.name)));
    const choose = h('form', { class: 'buttons', style: { alignItems: 'end', marginTop: '1rem' }, onsubmit: async event => {
        event.preventDefault();
        try { await api('live/strategy', { method: 'POST', body: { strategy: picker.value } }); toast(`Live bot will play ${picker.value}`); await refresh(); }
        catch (error) { toast(error.message); }
    } },
        h('label', { class: 'field', style: { marginBottom: 0 } }, h('span', {}, 'Strategy to play live'), picker),
        h('button', { type: 'submit' }, 'Use this strategy'));
    let pickerSynced = false;
    const act = async action => {
        try { await api(`live/${action}`, { method: 'POST' }); toast(`Live bot: ${action}`); await refresh(); }
        catch (error) { toast(error.message); }
    };
    const refresh = async () => {
        const live = await api('live');
        if (!pickerSynced) { picker.value = live.strategy; pickerSynced = true; }
        const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
        log.textContent = live.log.join('\n') || 'No output yet.';
        if (atBottom) log.scrollTop = log.scrollHeight;
        set(status, 
            h('p', {}, live.running ? h('span', { class: 'badge live' }, 'running') : h('span', { class: 'badge warn' }, 'stopped'), ' ',
                h('span', { class: 'muted' }, live.running ? `pid ${live.pid}, up ${duration(Date.now() - live.startedAt)}` :
                    live.exitedAt ? `exited ${ago(live.exitedAt)} (code ${live.exitCode})` : 'not started')),
            h('p', {}, live.running ? ['Playing ', h('a', { href: `#strategies/strategies/${live.runningStrategy}.js` }, h('code', {}, live.runningStrategy))] : ['Will play ', h('code', {}, live.strategy)],
                live.running && live.runningStrategy !== live.strategy ? h('span', { class: 'badge warn', style: { marginLeft: '0.5rem' } }, `restart to switch to ${live.strategy}`) : null),
            h('p', { class: 'muted small' }, 'Connects to ', h('code', {}, live.endpoint),
                ' through the recorder, so every game is saved under Recordings. Restart after editing a strategy. It starts again automatically when the dashboard restarts, unless you stop it.'),
            live.hasToken ? null : h('p', { class: 'error' }, `No player token found. Save it (only the token) to ${live.tokenFile}.`),
            h('div', { class: 'buttons' },
                h('button', { class: 'primary', disabled: live.running || !live.hasToken, onclick: () => act('start') }, 'Start'),
                h('button', { disabled: !live.hasToken, onclick: () => act('restart') }, 'Restart'),
                h('button', { class: 'danger', disabled: !live.running, onclick: () => act('stop') }, 'Stop')));
    };
    set(view, h('h1', {}, 'Live bot'),
        h('section', { class: 'card' }, status, choose),
        h('section', { class: 'card' }, h('h2', {}, 'Log'), log));
    await refresh();
    log.scrollTop = log.scrollHeight;
    poll(refresh, 3000);
}

// ---------- Recordings ----------
function recordingTable(recordings) {
    return table(['Updated', 'Mode', 'Status', 'Rounds', 'Our result', 'Winner'], recordings.map(recording => {
        const ours = recording.finished?.ours;
        const winner = recording.finished?.results?.find(result => result.winner);
        return { recording, cells: [ago(recording.updatedAt), recording.mode ?? '?',
            recording.inProgress ? h('span', { class: 'badge live' }, 'in progress') : recording.finished ? h('span', { class: 'badge' }, 'finished') : h('span', { class: 'badge warn' }, 'partial'),
            recording.rounds,
            ours ? h('span', { class: `badge ${ours.winner ? 'good' : 'bad'}` }, `#${ours.rank} · ${ours.totalEnergy} energy`) : '—',
            recording.finished ? (winner?.name ?? 'draw') : '—'] };
    }), row => { location.hash = `#recordings/${row.recording.id}`; });
}

async function Recordings(id) {
    if (id) return Recording(id);
    const recordings = await api('recordings');
    set(view, h('h1', {}, 'Recordings'),
        h('p', { class: 'muted' }, 'Live games saved by the recorder. Only our units are known; everyone else shows as one anonymous team.'),
        h('section', { class: 'card' }, recordings.length ? recordingTable(recordings) : h('p', { class: 'empty' }, 'Nothing recorded yet. Start the live bot.')));
    poll(async () => {
        const fresh = await api('recordings');
        view.querySelector('.card').replaceChildren(fresh.length ? recordingTable(fresh) : h('p', { class: 'empty' }, 'Nothing recorded yet.'));
    }, 5000);
}

async function Recording(id) {
    const replay = await api(`recordings/${id}`);
    const results = replay.results;
    set(view, 
        h('p', {}, h('a', { href: '#recordings' }, '← All recordings')),
        h('h1', {}, `Live ${replay.mode ?? 'game'} `, h('span', { class: 'muted small mono' }, id.slice(0, 8))),
        results ? h('section', { class: 'card' }, h('h2', {}, `Result (${replay.endReason})`),
            table(['Rank', 'Player', 'Energy', 'Survivors', ''], results.map(result => ({ cells: [result.rank, result.name, result.totalEnergy, result.survivorCount,
                result.winner ? h('span', { class: 'badge good' }, 'winner') : result.name === replay.ours?.name ? h('span', { class: 'badge live' }, 'us') : ''] }))))
            : h('section', { class: 'card' }, h('p', { class: 'muted' }, 'Not finished (or recording started mid-game). ', h('button', { onclick: route }, 'Refresh'))),
        replay.rounds.length ? h('section', { class: 'card' }, h('h2', {}, 'Replay'), Viewer(replay)) : h('p', { class: 'empty' }, 'No turns recorded.'));
}

// ---------- Strategies ----------
async function Strategies(file) {
    if (file) {
        const { source } = await api(`strategy?file=${encodeURIComponent(file)}`);
        set(view, h('p', {}, h('a', { href: '#strategies' }, '← All strategies')),
            h('h1', {}, h('code', {}, file)),
            h('div', { class: 'buttons', style: { marginBottom: '1rem' } }, quickRun(file)),
            h('pre', { class: 'source mono', tabindex: 0 }, source));
        return;
    }
    const strategies = await api('strategies');
    set(view, h('h1', {}, 'Strategies'),
        h('p', { class: 'muted' }, 'One strategy per file in ', h('code', {}, 'strategies/'), '. The one marked live is what the live bot plays; change it on the ', h('a', { href: '#live' }, 'Live bot'), ' page. Edit code in the repo; this page is read-only.'),
        h('div', { class: 'grid two' }, strategies.map(entry => h('section', { class: 'card' },
            h('h2', {}, h('a', { href: `#strategies/${entry.file}` }, h('code', {}, entry.file)), entry.live ? h('span', { class: 'badge live', style: { marginLeft: '0.5rem' } }, 'live') : null),
            h('p', { class: 'muted small' }, entry.summary || 'No description.'),
            h('p', { class: 'muted small' }, `${entry.lines} lines`),
            h('div', { class: 'buttons' }, quickRun(entry.file))))));
}

function quickRun(file) {
    const opponent = file === 'strategies/random.js' ? 'strategies/walker.js' : 'strategies/random.js';
    return h('button', { onclick: async () => {
        const run = await api('runs', { method: 'POST', body: { strategies: [file, opponent], preset: 'arena', games: 10 } });
        location.hash = `#gym/${run.id}`;
    } }, `Gym: 10 games vs ${opponent.replace('strategies/', '')}`);
}

// ---------- Replay viewer ----------
function Viewer(replay) {
    const frames = [];
    replay.rounds.forEach((round, roundIndex) => round.frames.forEach((frame, turn) => frames.push({ roundIndex, turn, frame })));
    let index = 0, playing = false, timer = null, speed = 8;
    const size = 640;
    const canvas = h('canvas', { width: size, height: size, role: 'img', 'aria-label': 'Game board' });
    const ctx = canvas.getContext('2d');
    const label = h('span', { class: 'frame-label muted small' });
    const slider = h('input', { type: 'range', min: 0, max: Math.max(0, frames.length - 1), value: 0, 'aria-label': 'Turn' });
    const playButton = h('button', { class: 'primary' }, 'Play');
    const info = h('div');
    const speech = h('div', { class: 'speech' });

    const draw = () => {
        const { roundIndex, turn, frame } = frames[index];
        const round = replay.rounds[roundIndex];
        const cell = size / Math.max(replay.width, replay.height);
        ctx.fillStyle = '#0b0d11';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = '#161a22';
        ctx.lineWidth = 1;
        for (let i = 0; i <= replay.width; i += 8) {
            ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, size); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(size, i * cell); ctx.stroke();
        }
        const counts = replay.teams.map(() => ({ units: 0, matched: 0 }));
        const u = frame.u;
        for (let i = 0; i < u.length; i += 5) {
            const [x, y, team, matched, blush] = [u[i], u[i + 1], u[i + 2], u[i + 3], u[i + 4]];
            counts[team].units++;
            if (matched) counts[team].matched++;
            ctx.globalAlpha = matched ? 1 : 0.45;
            ctx.fillStyle = teamColor(replay, team);
            const pad = matched ? 0.5 : 1.5;
            ctx.fillRect(x * cell + pad, y * cell + pad, cell - 2 * pad, cell - 2 * pad);
            if (blush) {
                ctx.globalAlpha = 1;
                ctx.fillStyle = blush;
                ctx.fillRect(x * cell + cell * 0.3, y * cell + cell * 0.3, cell * 0.4, cell * 0.4);
            }
        }
        ctx.globalAlpha = 1;
        label.textContent = `Round ${roundIndex + 1}/${replay.rounds.length} · turn ${turn}/${round.frames.length - 1}`;
        slider.value = index;
        set(info, 
            h('h3', {}, 'Target: ', round.shape.name, ' ', shapeMini(round.shape)),
            round.partial ? h('p', { class: 'muted small' }, 'Recording started mid-round.') : null,
            h('div', { class: 'legend' }, replay.teams.map((team, t) => h('div', {},
                h('span', { class: 'swatch', style: { background: teamColor(replay, t) } }),
                h('span', {}, h('b', {}, team.name), ` ${counts[t].units} units, ${counts[t].matched} in shape`)))),
            h('p', { class: 'muted small' }, 'Bright squares complete a target shape at this moment; faded ones don\'t. A small inner square shows a unit\'s blush colour.'),
            round.outcome && turn === round.frames.length - 1 ? h('p', { class: 'small' },
                `Round result for us: ${round.outcome.won}/${round.outcome.units} kept energy, ${round.outcome.eliminated} eliminated.`) : null);
        set(speech, (frame.m.length ? frame.m.map(([team, text]) => h('p', {},
            team >= 0 ? h('b', { style: { color: teamColor(replay, team) } }, `${replay.teams[team].name}: `) : '💬 ', text))
            : [h('p', { class: 'muted' }, 'No speech this turn.')]));
    };
    const go = next => { index = Math.max(0, Math.min(frames.length - 1, next)); draw(); };
    const stop = () => { playing = false; clearInterval(timer); playButton.textContent = 'Play'; };
    const play = () => {
        if (index >= frames.length - 1) index = 0;
        playing = true;
        playButton.textContent = 'Pause';
        clearInterval(timer);
        timer = setInterval(() => { if (index >= frames.length - 1) stop(); else go(index + 1); }, 1000 / speed);
    };
    const roundStart = roundIndex => frames.findIndex(entry => entry.roundIndex === roundIndex);
    const jumpRound = delta => {
        const target = Math.max(0, Math.min(replay.rounds.length - 1, frames[index].roundIndex + delta));
        go(roundStart(target));
    };
    const roundEnd = () => {
        const current = frames[index].roundIndex;
        go(frames.findLastIndex(entry => entry.roundIndex === current));
    };
    playButton.addEventListener('click', () => playing ? stop() : play());
    slider.addEventListener('input', () => { stop(); go(Number(slider.value)); });
    const speedSelect = h('select', { 'aria-label': 'Speed', onchange: event => { speed = Number(event.target.value); if (playing) play(); } },
        [4, 8, 16, 32, 64].map(value => h('option', { value, selected: value === speed }, `${value} turns/s`)));

    const root = h('div', { class: 'viewer', tabindex: 0, onkeydown: event => {
        if (event.target.tagName === 'SELECT') return;
        if (event.key === ' ') { event.preventDefault(); playing ? stop() : play(); }
        if (event.key === 'ArrowRight') { event.preventDefault(); stop(); go(index + 1); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); stop(); go(index - 1); }
        if (event.key === 'PageDown') { event.preventDefault(); stop(); jumpRound(1); }
        if (event.key === 'PageUp') { event.preventDefault(); stop(); jumpRound(-1); }
    } },
        h('div', {},
            h('div', { class: 'board-wrap' }, canvas),
            h('div', { class: 'controls' },
                h('button', { 'aria-label': 'Previous round', onclick: () => { stop(); jumpRound(-1); } }, '◀◀'),
                h('button', { 'aria-label': 'Previous turn', onclick: () => { stop(); go(index - 1); } }, '◀'),
                playButton,
                h('button', { 'aria-label': 'Next turn', onclick: () => { stop(); go(index + 1); } }, '▶'),
                h('button', { onclick: () => { stop(); roundEnd(); } }, 'Round end'),
                h('button', { 'aria-label': 'Next round', onclick: () => { stop(); jumpRound(1); } }, '▶▶'),
                speedSelect),
            h('div', { class: 'controls' }, slider, label),
            h('p', { class: 'muted small' }, 'Keys: space play/pause, ← → step, PgUp/PgDn change round.')),
        h('div', {}, info, h('h3', { style: { marginTop: '1rem' } }, 'Speech'), speech));
    cleanup.push(stop);
    draw();
    return root;
}

route();
