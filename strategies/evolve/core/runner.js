// Runs inside the sandbox (see sandbox.js): loads the live strategy and hosts one
// instance of it per game, driven by messages from the parent process.
// The live strategy sees the kit's normal Player API and nothing else.
const Player = require('../../../game/Player');

let Strategy;
try {
    Strategy = require(process.argv[2]);
    if (typeof Strategy !== 'function' || !(Strategy.prototype instanceof Player)) {
        throw new Error('live/strategy.js must export a class derived from game/Player.');
    }
} catch (error) {
    process.send({ type: 'load-error', message: String(error?.stack || error) }, () => process.exit(1));
    return;
}
process.send({ type: 'ready' });

const games = new Map();
const fail = (message, error) => process.send({ ...message, error: String(error?.message || error) });

process.on('message', async message => {
    const { type, game } = message;
    if (type === 'create') {
        try { games.set(game, new Strategy()); } catch (error) { games.set(game, null); fail({ type: 'error' }, error); }
        return;
    }
    const player = games.get(game);
    if (type === 'turn') {
        try {
            const commands = player ? await player.turn(message.state, message.remainingMs) : [];
            process.send({ type: 'result', id: message.id, commands: Array.isArray(commands) ? commands : [] });
        } catch (error) { fail({ type: 'result', id: message.id, commands: [] }, error); }
        return;
    }
    try {
        if (type === 'round') player?.round(message.width, message.height, message.targetShape);
        if (type === 'roundEnd') player?.roundEnd(message.outcomes);
        if (type === 'finish') { games.delete(game); player?.finish(message.result); }
        if (type === 'release') games.delete(game);   // the game moved to newer code
    } catch (error) { fail({ type: 'error' }, error); }
});

process.on('disconnect', () => process.exit(0));
