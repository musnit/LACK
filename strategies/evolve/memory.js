// The evolve strategy's memory on disk: the update prompt (what to ask the
// owning T3 thread next) and a journal of finished games. Both brain.js and the
// sender use these helpers. All writes are small synchronous appends.
const fs = require('node:fs');
const path = require('node:path');

const PROMPT_FILE = path.join(__dirname, 'update-prompt.md');
const JOURNAL_FILE = path.join(__dirname, 'journal.jsonl');
const HEADER = /<!--[\s\S]*?-->\s*/;

// Only live games write memory; evolve.js switches this on under the live client,
// so gym runs neither fill the journal nor queue update prompts.
let live = false;
const setLive = value => { live = Boolean(value); };

// The prompt text without the explanatory comment; '' means "nothing to ask".
function readPrompt(file = PROMPT_FILE) {
    try { return fs.readFileSync(file, 'utf8').replace(HEADER, '').trim(); }
    catch { return ''; }
}

// Add a request to the update prompt. Several requests simply pile up
// until the next send delivers them together.
function requestUpdate(text) {
    if (!live) return;
    fs.appendFileSync(PROMPT_FILE, `\n${String(text).trim()}\n`);
}

// Put the prompt file back to just its explanatory comment.
function clearPrompt() {
    const current = fs.existsSync(PROMPT_FILE) ? fs.readFileSync(PROMPT_FILE, 'utf8') : '';
    const header = current.match(HEADER);
    fs.writeFileSync(PROMPT_FILE, header ? header[0].trimEnd() + '\n' : '');
}

function record(entry) {
    if (!live) return;
    fs.appendFileSync(JOURNAL_FILE, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

// Journal entries written since the last update was sent to the thread.
function sinceLastUpdate() {
    let lines;
    try { lines = fs.readFileSync(JOURNAL_FILE, 'utf8').split('\n').filter(Boolean); }
    catch { return []; }
    const entries = lines.map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    const last = entries.findLastIndex(entry => entry.type === 'update-sent');
    return entries.slice(last + 1);
}

module.exports = { PROMPT_FILE, setLive, JOURNAL_FILE, readPrompt, requestUpdate, clearPrompt, record, sinceLastUpdate };
