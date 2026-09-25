// Converts gym games and live recordings into one compact replay format for the browser:
// { width, height, teams: [{ name }], rounds: [{ shape, frames: [{ u, m }], outcome? }], results }
// Each frame's `u` is a flat list of units: x, y, team, matched (0/1), blush (string or 0).
// `m` lists speech shown that turn as [team or -1, text].
const { readFileSync } = require('node:fs');

function replayFromGame(game, names, result) {
    const teamOf = id => Number(id.split(':')[0]);
    const rounds = [];
    for (const frame of game.log.turns) {
        if (frame.roundTurn === 0) rounds.push({ shape: plainShape(frame.targetShape), frames: [] });
        const matched = new Set(frame.matches.flat());
        const units = [];
        for (const unit of frame.units) units.push(unit.x, unit.y, teamOf(unit.id), matched.has(unit.id) ? 1 : 0, unit.blush ?? 0);
        const speech = (frame.messages ?? []).map(message => [teamOf(message.unitId), message.text]);
        rounds.at(-1).frames.push({ u: units, m: speech });
    }
    return {
        source: 'gym', width: game.config.width, height: game.config.height,
        teams: names.map(name => ({ name })), rounds,
        results: result.players.map(player => ({ name: player.name, competitive: player.competitive, ...player.result }))
    };
}

// Live recordings only reveal which units are ours; everyone else is one anonymous team.
function replayFromRecording(path) {
    const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const replay = { source: 'live', width: 64, height: 64, teams: [{ name: 'us' }, { name: 'others' }], rounds: [], results: null, mode: null };
    let round = null;
    const push = state => {
        if (!round || !state) return;
        const own = new Set(state.ownUnits.map(unit => `${unit.x},${unit.y}`));
        const positions = state.units.map(unit => ({ ...unit, team: own.has(`${unit.x},${unit.y}`) ? 0 : 1 }));
        const matched = matchShape(positions, round.shape, replay.width, replay.height);
        const units = [];
        positions.forEach((unit, index) => units.push(unit.x, unit.y, unit.team, matched.has(index) ? 1 : 0, unit.blush ?? 0));
        round.frames.push({ u: units, m: (state.messages ?? []).map(message => [-1, message.text]) });
    };
    for (const { message } of lines) {
        const game = message.game;
        if (message.type === 'player-join' || message.type === 'player-resume') {
            const config = game?.config ?? message.config;
            if (config) Object.assign(replay, { width: config.width, height: config.height });
            if (game?.mode) replay.mode = game.mode;
            if (game?.targetShape && game.state) {
                round = { shape: plainShape(game.targetShape), frames: [], partial: true };
                replay.rounds.push(round);
                push(game.state);
            }
        } else if (message.type === 'player-round') {
            round = { shape: plainShape(message.targetShape), frames: [] };
            replay.rounds.push(round);
            push(message.state);
        } else if (message.type === 'player-turn') {
            push(message.state);
        } else if (message.type === 'player-round-end') {
            push(message.state);
            if (round) round.outcome = summarizeOutcomes(message.outcomes);
        } else if (message.type === 'player-finished') {
            replay.results = message.results;
            replay.ours = message.result;
            replay.endReason = message.endReason;
        }
    }
    replay.rounds = replay.rounds.filter(entry => entry.frames.length);
    return replay;
}

function summarizeOutcomes(outcomes = []) {
    return { units: outcomes.length, won: outcomes.filter(outcome => outcome.won).length,
        eliminated: outcomes.filter(outcome => outcome.eliminated).length };
}

const plainShape = shape => ({ name: shape.name, width: shape.width, height: shape.height, cells: shape.cells.map(cell => [...cell]) });

// Same greedy scan as game/Board.js: top-to-bottom, left-to-right, no unit used twice.
function matchShape(units, shape, width, height) {
    const grid = new Map(units.map((unit, index) => [unit.y * width + unit.x, index]));
    const used = new Set();
    for (let y = 0; y <= height - shape.height; y++) {
        for (let x = 0; x <= width - shape.width; x++) {
            const members = [];
            for (const [dx, dy] of shape.cells) {
                const index = grid.get((y + dy) * width + x + dx);
                if (index === undefined || used.has(index)) break;
                members.push(index);
            }
            if (members.length === shape.cells.length) members.forEach(index => used.add(index));
        }
    }
    return used;
}

module.exports = { replayFromGame, replayFromRecording };
