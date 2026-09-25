// Evolve: a self-updating strategy, maintained by a dedicated T3 thread.
//
// Two halves (see README.md):
//   live/  the strategy itself: an ordinary kit Player subclass that the
//          maintainer thread rewrites. It runs sandboxed (core/sandbox.js):
//          no file writes, no network, no child processes, no speech.
//   core/  this static scaffolding, which the thread may not edit. It reloads
//          live/ for each new game, owns all speech, and relays players'
//          suggestions to the thread (core/speech.js, core/relay.js).
// Every turn a random unit advertises: say "evolve: <idea>". The most recent
// suggestion heard goes to the thread every 15 seconds. Relaying only happens
// under the live client (client.js or gym/record.js) once core/setup.js has
// configured a thread; in the gym evolve plays the same but never relays.
// EVOLVE_RELAY=1 or 0 forces relaying on or off.
const path = require('node:path');
const Player = require('../../game/Player');
const { Sandbox } = require('./core/sandbox');
const speech = require('./core/speech');
const relay = require('./core/relay');
const data = require('./core/data');

const liveClient = /^(client|record)\.js$/.test(path.basename(require.main?.filename || ''));
const relaying = process.env.EVOLVE_RELAY ? process.env.EVOLVE_RELAY === '1' : liveClient;
if (relaying) {
    data.enableLog();
    const thread = process.env.EVOLVE_THREAD || data.config().thread;
    if (thread) relay.start(thread);
    else console.error('evolve: no maintainer thread configured (see strategies/evolve/README.md); playing without relaying.');
}

const sandbox = new Sandbox({
    entry: path.join(__dirname, 'live', 'strategy.js'),
    log: message => { console.error(`evolve: ${message}`); data.record('sandbox', { message }); }
});

class Evolve extends Player {
    #live = sandbox.open();

    round(width, height, targetShape) {
        super.round(width, height, targetShape);
        this.#live.round(width, height, targetShape);
    }

    async turn(state, remainingMs) {
        relay.hear(speech.suggestions(state.messages));
        const commands = speech.legalCommands(await this.#live.turn(state, remainingMs), state.ownUnits);
        return speech.advertise(commands, state.ownUnits);
    }

    roundEnd(outcomes) { this.#live.roundEnd(outcomes); }

    finish(result) {
        this.#live.finish(result);
        if (!result) return;
        relay.gameFinished(result);
        data.record('game', { rank: result.rank, winner: result.winner });
    }
}

module.exports = Evolve;
