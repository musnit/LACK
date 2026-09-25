// Evolve's live strategy: the part the maintainer thread rewrites.
//
// It uses the kit's standard Player API (round, turn, roundEnd, finish), so any
// existing strategy can be dropped in here; from this folder, require Player as
// '../../../game/Player' and shared helpers as '../../lib'. It runs sandboxed: it
// can read game/ and strategies/, but can't write files, use the network or start
// processes, and its `say` commands are dropped (evolve's core owns speech).
//
// Current version: play exactly like strategies/walker.js.
module.exports = require('../../walker');
