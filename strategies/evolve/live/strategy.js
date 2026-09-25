// Evolve's live strategy: the part the maintainer thread rewrites.
//
// It uses the kit's standard Player API (round, turn, roundEnd, finish), so any
// existing strategy can be dropped in here; from this folder, require Player as
// '../../../game/Player' and shared helpers as '../../lib'. It runs sandboxed: it
// can read game/ and strategies/, but can't write files, use the network or start
// processes, and its `say` commands are dropped (evolve's core owns speech).
//
// Current version: play like strategies/walker.js, but colour our units dark green
// (#0b5d1e) instead of pink. Any own unit that isn't green yet (e.g. the one the
// core borrowed for its advert on the first turn) blushes green instead of moving.
const Player = require('../../../game/Player');
const Walker = require('../../walker');

const GREEN = '#0b5d1e';

class Evolve extends Walker {
    async turn(state) {
        const commands = await super.turn(state);
        const notGreen = new Set(state.ownUnits
            .filter(unit => (unit.blush || '').toLowerCase() !== GREEN)
            .map(unit => unit.handle));
        const result = commands.filter(command => command.commandName !== 'blush' && !notGreen.has(command.handle));
        for (const handle of notGreen) result.push(Player.commands.blush(handle, GREEN));
        return result;
    }
}

module.exports = Evolve;
