// Runs one complete game between strategies, following docs/gym.md:
// each strategy sees only game.observe(), decisions race a shared deadline,
// and commands are filtered the way the server filters them.
const { performance } = require('node:perf_hooks');
const Game = require('../game/Game');

/**
 * @param {object} options
 * @param {object} options.config   a preset from gym/presets.js
 * @param {{ name: string, Strategy: Function, competitive?: boolean, units?: number }[]} options.entrants
 * @param {number} [options.latencyMs=50]  pretend network delay; replies later than turnTimeMs - latencyMs are dropped
 * @param {boolean} [options.realTime=false] wait out the whole turn clock even when every strategy has replied
 * @param {(event) => void} [options.onEvent] called with { type: 'round' | 'turn' | 'round-end', game, ... }
 */
async function runGame({ config, entrants, latencyMs = 50, realTime = false, onEvent = () => {} }) {
    const records = [];
    entrants.forEach((entrant, index) => {
        const playerId = String(index);
        const count = entrant.units ?? config.unitsPerPlayer;
        for (let handle = 0; handle < count; handle++) {
            records.push({ unitId: `${playerId}:${handle}`, playerId, playerName: entrant.name,
                handle: String(handle), energy: config.startingEnergy, competitive: entrant.competitive ?? true });
        }
    });
    const game = new Game(records, config);
    const players = entrants.map((entrant, index) => ({ ...entrant, playerId: String(index), strategy: new entrant.Strategy(), errors: 0, late: 0 }));
    const alive = player => game.units.some(unit => unit.playerId === player.playerId);
    const guard = (player, fn) => { try { fn(); } catch (error) { player.errors++; } };

    let endReason = 'round-limit';
    for (let roundIndex = 0; roundIndex < config.maxRounds; roundIndex++) {
        const viable = game.viableShapes;
        if (!viable.length) { endReason = 'no-viable-shape'; break; }
        const shape = viable[Math.floor(Math.random() * viable.length)];
        game.round(shape);
        for (const player of players.filter(alive)) {
            guard(player, () => player.strategy.round(config.width, config.height, shape));
        }
        await onEvent({ type: 'round', game, roundIndex, shape });

        for (let turnIndex = 0; turnIndex < config.turnsPerRound; turnIndex++) {
            const decisions = await collectDecisions(game, players.filter(alive), config.turnTimeMs, latencyMs, realTime);
            game.turn(decisions);
            await onEvent({ type: 'turn', game, roundIndex, turnIndex, shape });
        }

        const outcomes = game.match();
        for (const player of players) {
            const own = game.outcomesFor(player.playerId, outcomes);
            if (own.length) guard(player, () => player.strategy.roundEnd(own));
        }
        await onEvent({ type: 'round-end', game, roundIndex, shape, outcomes });
    }

    game.finish(endReason);
    for (const player of players) guard(player, () => player.strategy.finish(game.resultFor(player.playerId)));
    return {
        endReason,
        rounds: game.log.rounds.length,
        players: players.map(({ name, playerId, competitive = true, errors, late }) => ({
            name, competitive, errors, late, result: game.resultFor(playerId)
        }))
    };
}

// Ask every living player for commands at once; keep only replies that beat the deadline.
async function collectDecisions(game, players, turnTimeMs, latencyMs, realTime) {
    const commands = {};
    const budget = turnTimeMs - latencyMs;
    let open = true;
    const pending = players.map(async player => {
        const started = performance.now();
        let reply;
        try {
            reply = await player.strategy.turn(game.observe(player.playerId), turnTimeMs - latencyMs / 2);
        } catch (error) {
            player.errors++;
            return;
        }
        // Slow synchronous work blocks the clock too, so measure elapsed time directly.
        if (!open || performance.now() - started > budget) { player.late++; return; }
        if (!Array.isArray(reply)) return;
        for (const command of reply) {
            if (!command || typeof command.handle !== 'string') continue;
            const unitId = game.unitIdFor(player.playerId, command.handle);
            if (!unitId || commands[unitId] || !Game.validCommand(command.commandName, command.params)) continue;
            commands[unitId] = { commandName: command.commandName, params: [...command.params] };
        }
    });
    let timer;
    const deadline = new Promise(resolve => { timer = setTimeout(resolve, budget); });
    await (realTime ? deadline : Promise.race([Promise.allSettled(pending), deadline]));
    clearTimeout(timer);
    open = false;
    return commands;
}

module.exports = { runGame };
