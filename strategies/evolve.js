// Evolve: a self-updating strategy owned by a T3 thread (evolve/owner.json).
//
// This file is the stable shell. The actual play lives in evolve/brain.js,
// which starts as simple code and gets rewritten by the owning thread:
//   1. Something fills evolve/update-prompt.md: you by hand, or the brain
//      itself (memory.requestUpdate), e.g. after a losing streak.
//   2. When a live game finishes, the shell runs evolve/send.js in the
//      background, which posts the prompt to the thread and empties the file.
//   3. The thread edits brain.js; each new game reloads it if it changed.
//      A brain that fails to load is skipped and the last good one keeps playing.
// Journaling and sending only happen under the live client (client.js /
// gym/record.js), not in gym runs. Set EVOLVE_SEND=1 or 0 to force it on or off.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Player = require('../game/Player');
const memory = require('./evolve/memory');

const BRAIN = path.join(__dirname, 'evolve', 'brain.js');
const SENDER = path.join(__dirname, 'evolve', 'send.js');
const live = /^(client|record)\.js$/.test(path.basename(require.main?.filename || ''));
const sending = process.env.EVOLVE_SEND ? process.env.EVOLVE_SEND === '1' : live;
memory.setLive(sending);

let Brain = null, loadedAt = 0;

function currentBrain() {
    const mtime = fs.statSync(BRAIN).mtimeMs;
    if (Brain && mtime === loadedAt) return Brain;
    const previous = require.cache[BRAIN];
    delete require.cache[BRAIN];
    try {
        Brain = require(BRAIN);
        if (Brain && loadedAt) console.error('evolve: loaded updated brain.js');
    } catch (error) {
        if (!Brain) throw error;
        console.error(`evolve: brain.js failed to load, keeping the previous one: ${error.message}`);
        if (previous) require.cache[BRAIN] = previous;
    }
    loadedAt = mtime;
    return Brain;
}

function sendUpdatePrompt() {
    const child = spawn(process.execPath, [SENDER], { stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('error', error => console.error(`evolve: could not run send.js: ${error.message}`));
}

class Evolve extends Player {
    #brain = new (currentBrain())();

    round(width, height, targetShape) {
        super.round(width, height, targetShape);
        this.#brain.round(width, height, targetShape);
    }

    turn(state, remainingMs) { return this.#brain.turn(state, remainingMs); }

    roundEnd(outcomes) { this.#brain.roundEnd(outcomes); }

    finish(result) {
        try { this.#brain.finish(result); }
        finally { if (sending) sendUpdatePrompt(); }
    }
}

module.exports = Evolve;
