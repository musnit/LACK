// The evolving part of the evolve strategy. The owning T3 thread rewrites this
// file in response to update prompts; strategies/evolve.js reloads it at the
// start of the next game.
//
// Version 1, deliberately simple:
//   - Play exactly like strategies/walker.js (grid of shape copies near our
//     units, walk each unit to its cell).
//   - After every 10 finished live games, if we won fewer than half, ask the
//     thread for an improvement by filling the update prompt.
const Walker = require('../walker');
const memory = require('./memory');

const REVIEW_EVERY = 10;

class Brain extends Walker {
    finish(result) {
        if (!result) return;
        memory.record({ type: 'game', rank: result.rank, winner: result.winner, result });
        const games = memory.sinceLastUpdate().filter(entry => entry.type === 'game');
        const wins = games.filter(game => game.winner).length;
        if (games.length >= REVIEW_EVERY && wins < games.length / 2 && !memory.readPrompt()) {
            memory.requestUpdate(`Automatic review: the strategy won ${wins} of its last ${games.length} games. ` +
                'Read the journal, work out why it is losing, and improve brain.js.');
        }
    }
}

module.exports = Brain;
