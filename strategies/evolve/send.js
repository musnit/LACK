#!/usr/bin/env node
// Deliver the evolve strategy's update prompt to the T3 thread that owns it.
//
//   node strategies/evolve/send.js            send if update-prompt.md is filled
//   node strategies/evolve/send.js --dry-run  print the message instead
//
// Uses the box's `t3-threads` client, which borrows a short-lived T3 session
// and refuses busy threads. Then the prompt stays put and the next attempt
// (e.g. after the next live game) tries again. Exit 0 = sent or nothing to send.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const memory = require('./memory');

memory.setLive(true);

const LOCK = path.join(__dirname, 'send.sending');
const STALE_LOCK_MS = 10 * 60 * 1000;
const thread = process.env.EVOLVE_THREAD || require('./owner.json').thread;
const dryRun = process.argv.includes('--dry-run');

const text = memory.readPrompt();
if (!text) process.exit(0);

const games = memory.sinceLastUpdate().filter(entry => entry.type === 'game');
const wins = games.filter(game => game.winner).length;
const message = `Update request for the self-updating "evolve" strategy.

${text}

---
Context: you own strategies/evolve/brain.js in ${path.resolve(__dirname, '../..')}.
- Since the last update: ${games.length} finished live games, ${wins} wins. Per-game results are in strategies/evolve/journal.jsonl (git-ignored).
- Change brain.js (and new helper files under strategies/evolve/ if needed). Keep it a Player subclass with a short header comment describing the current version. strategies/evolve.js reloads it at the start of each new game, so a broken save only costs a reload attempt, but keep every save valid.
- Leave strategies/evolve.js, memory.js and send.js alone unless the request is about them.
- Before finishing: \`node --test tests/*.test.js\` and a smoke run such as \`node gym/run.js strategies/evolve.js strategies/huddle.js --games 5\`. Check it doesn't throw and turns stay well under 50 ms.
- Commit on the current branch with a message that summarises the change. Don't push or open a pull request unless asked.
- Reply briefly: what changed, and the smoke numbers.`;

if (dryRun) { console.log(`To thread ${thread}:\n\n${message}`); process.exit(0); }

// One sender at a time: overlapping games can finish together.
try { if (Date.now() - fs.statSync(LOCK).mtimeMs > STALE_LOCK_MS) fs.rmSync(LOCK); } catch {}
let lock;
try { lock = fs.openSync(LOCK, 'wx'); } catch { process.exit(0); }

try {
    const run = spawnSync('t3-threads', ['send', thread, '--file', '-', '--request-id', `evolve-${Date.now()}`],
        { input: message, encoding: 'utf8' });
    if (run.error || run.status !== 0) {
        console.error(`evolve: update prompt not sent (${run.error?.message || (run.stderr || '').trim().split('\n').pop()}); will retry later.`);
        process.exitCode = 1;
    } else {
        // Keep anything that was appended while we were sending.
        const rest = memory.readPrompt().replace(text, '').trim();
        memory.clearPrompt();
        if (rest) memory.requestUpdate(rest);
        let messageId = null;
        try { messageId = JSON.parse(run.stdout).messageId ?? null; } catch {}
        memory.record({ type: 'update-sent', thread, messageId, prompt: text });
        console.error(`evolve: update prompt sent to thread ${thread}.`);
    }
} finally {
    fs.closeSync(lock);
    fs.rmSync(LOCK, { force: true });
}
