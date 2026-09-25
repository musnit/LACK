#!/usr/bin/env node
// The one command the maintainer thread may run (see charter.md):
//   node strategies/evolve/core/check.js
// 1. load live/strategy.js in the sandbox,
// 2. run the repo's offline tests,
// 3. play a few gym games against built-in strategies; any live error or late turn fails,
// 4. if all passed, commit strategies/evolve/live/ when it has changed.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Sandbox } = require('./sandbox');

const REPO = path.resolve(__dirname, '../../..');
const LIVE = 'strategies/evolve/live';

const run = (command, args, env = process.env) => spawnSync(command, args, { cwd: REPO, encoding: 'utf8', env });
const tail = text => text.trim().split('\n').slice(-15).join('\n');
function step(name, ok, detail = '') {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `\n${detail}` : ''}`);
    if (!ok) process.exit(1);
}

(async () => {
    const load = await new Sandbox({ entry: path.join(REPO, LIVE, 'strategy.js') }).probe();
    step('live/strategy.js loads in the sandbox', load.ok, load.error);

    const tests = fs.readdirSync(path.join(REPO, 'tests')).filter(file => file.endsWith('.test.js')).map(file => path.join('tests', file));
    const test = run(process.execPath, ['--test', ...tests]);
    step('offline tests', test.status === 0, test.status === 0 ? '' : tail(test.stdout + test.stderr));

    const gym = run(process.execPath, ['gym/run.js', 'strategies/evolve', 'strategies/walker.js', 'strategies/huddle.js', '--games', '3'],
        { ...process.env, EVOLVE_RELAY: '0' });
    const row = gym.stdout.split('\n').find(line => line.includes('│ evolve'))?.split('│').map(cell => cell.trim()).filter(Boolean);
    const [errors, late] = row ? row.slice(-2).map(Number) : [NaN, NaN];
    const liveErrors = gym.stderr.split('\n').filter(line => line.startsWith('evolve:'));
    console.log(tail(gym.stdout));
    step('smoke games', gym.status === 0 && errors === 0 && late === 0 && !liveErrors.length,
        [gym.status === 0 ? '' : tail(gym.stderr), ...liveErrors].filter(Boolean).join('\n'));

    if (!run('git', ['status', '--porcelain', '--', LIVE]).stdout.trim()) return console.log('live/ unchanged; nothing to commit');
    run('git', ['add', '--', LIVE]);
    const commit = run('git', ['commit', '-q', '-m', 'evolve: update live strategy', '--', LIVE]);
    step('commit live/', commit.status === 0, commit.status === 0 ? run('git', ['log', '--oneline', '-1']).stdout.trim() : tail(commit.stderr));
})();
