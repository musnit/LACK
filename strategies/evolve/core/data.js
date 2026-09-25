// Evolve's local state in strategies/evolve/data/ (git-ignored):
//   config.json  { "thread": "<T3 thread id>" }, written by setup.js
//   log.jsonl    what happened live: games, heard speech, relayed prompts, reloads
// Only the live client writes the log (see `live` in index.js); gym runs don't.
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'data');
const CONFIG = path.join(DIR, 'config.json');
const LOG = path.join(DIR, 'log.jsonl');

let logging = false;
const enableLog = () => { logging = true; };

function config() {
    try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; }
}

function record(type, fields = {}) {
    if (!logging) return;
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), type, ...fields }) + '\n');
}

module.exports = { DIR, CONFIG, LOG, config, record, enableLog };
