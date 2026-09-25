#!/usr/bin/env node
// One-time setup of evolve's dedicated maintainer thread:
//   node strategies/evolve/core/setup.js [--dir ~/LACK-evolve] [--branch evolve/live]
//                                        [--like CLAUDE_THREAD] [--project ID] [--dry-run]
// 1. Create a git worktree for the live bot and its thread (from origin/main).
// 2. Write .claude/settings.local.json there: the thread may edit only
//    strategies/evolve/live/ and run only core/check.js; everything else is
//    denied or needs your approval in T3.
// 3. Mark that worktree trusted in ~/.claude.json, which Claude Code requires
//    before it honours the allow rules. (If that mark is ever lost, everything
//    just asks for approval.)
// 4. Create the T3 thread in "approval-required" mode, save its id to
//    strategies/evolve/data/config.json, and send it the charter as a kickoff.
// Re-running reuses an existing worktree and thread.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs } = require('node:util');

const { values: options } = parseArgs({ options: {
    dir: { type: 'string', default: path.join(os.homedir(), 'LACK-evolve') },
    branch: { type: 'string', default: 'evolve/live' },
    like: { type: 'string' },
    project: { type: 'string' },
    'dry-run': { type: 'boolean', default: false }
} });
const REPO = path.resolve(__dirname, '../../..');
const DIR = path.resolve(options.dir.replace(/^~(?=\/|$)/, os.homedir()));
const DRY = options['dry-run'];

const PERMISSIONS = { permissions: {
    allow: [
        'Edit(/strategies/evolve/live/**)',
        'Bash(node strategies/evolve/core/check.js)',
        'Bash(git status)',
        'Bash(git diff)',
        'Bash(git log --oneline -20)'
    ],
    deny: [
        'Edit(/strategies/evolve/core/**)', 'Edit(/strategies/evolve/index.js)', 'Edit(/strategies/evolve/data/**)',
        'Edit(/.claude/**)', 'Edit(/game/**)', 'Edit(/tests/**)',
        'Read(~/.config/**)', 'Read(~/.ssh/**)', 'Read(~/.t3/**)', 'Read(~/.claude.json)', 'Read(//run/**)', 'Read(//proc/**)',
        'WebFetch', 'WebSearch', 'mcp__t3-code'
    ]
} };

const KICKOFF = `${fs.readFileSync(path.join(__dirname, 'charter.md'), 'utf8').trim()}

---

Kickoff from the box owner (not relayed speech): you are this strategy's dedicated
maintainer. Read strategies/evolve/README.md and the files in strategies/evolve/live/,
then run \`node strategies/evolve/core/check.js\` once to confirm your permissions
work. Make no changes yet. Reply with one line when ready.`;

function sh(command, args, input) {
    const result = spawnSync(command, args, { encoding: 'utf8', input });
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.error?.message || '').trim()}`);
    return result.stdout;
}
const act = (description, action) => { console.log(`${DRY ? '[dry run] ' : ''}${description}`); if (!DRY) return action(); };

if (DIR.startsWith(path.join(os.homedir(), '.t3') + path.sep)) throw new Error('Keep the worktree outside ~/.t3; the thread may not read there.');

// 1. worktree
if (fs.existsSync(path.join(DIR, '.git'))) console.log(`Using existing worktree ${DIR}`);
else act(`Create worktree ${DIR} on branch ${options.branch} from origin/main`, () => {
    sh('git', ['-C', REPO, 'fetch', '-q', 'origin']);
    const exists = spawnSync('git', ['-C', REPO, 'rev-parse', '--verify', '-q', `refs/heads/${options.branch}`]).status === 0;
    sh('git', ['-C', REPO, 'worktree', 'add', DIR, ...(exists ? [options.branch] : ['-b', options.branch, 'origin/main'])]);
});

// 2. permissions
act(`Write ${path.join(DIR, '.claude/settings.local.json')}`, () => {
    fs.mkdirSync(path.join(DIR, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(DIR, '.claude/settings.local.json'), JSON.stringify(PERMISSIONS, null, 2) + '\n');
});

// 3. trust
act(`Mark ${DIR} trusted in ~/.claude.json`, () => {
    const file = path.join(os.homedir(), '.claude.json');
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    settings.projects ??= {};
    settings.projects[DIR] = { ...settings.projects[DIR], hasTrustDialogAccepted: true };
    fs.writeFileSync(`${file}.evolve-tmp`, JSON.stringify(settings, null, 2));
    fs.renameSync(`${file}.evolve-tmp`, file);
});

// 4. thread
const configFile = path.join(DIR, 'strategies/evolve/data/config.json');
let thread = (() => { try { return JSON.parse(fs.readFileSync(configFile, 'utf8')).thread; } catch { return null; } })();
if (thread) console.log(`Using existing thread ${thread}`);
else {
    const mainCheckout = sh('git', ['-C', REPO, 'worktree', 'list', '--porcelain']).split('\n')[0].replace(/^worktree /, '');
    const project = options.project ?? JSON.parse(sh('t3-threads', ['projects'])).find(p => p.workspaceRoot === mainCheckout)?.id;
    if (!project) throw new Error(`No T3 project for ${mainCheckout}; pass --project ID.`);
    // The permission file above is Claude Code's, so copy the model from a Claude thread.
    const like = options.like ?? JSON.parse(sh('t3-threads', ['list', '--project', project]))
        .find(t => t.modelSelection?.instanceId === 'claudeAgent' && !t.archivedAt)?.id;
    if (!like) throw new Error('No Claude thread in the project to copy the model from; pass --like THREAD.');
    const args = ['create', '--project', project, '--like', like, '--title', 'Evolve maintainer',
        '--runtime-mode', 'approval-required', '--worktree', DIR, '--branch', options.branch];
    act(`t3-threads ${args.join(' ')}`, () => {
        thread = JSON.parse(sh('t3-threads', args)).thread.id;
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        fs.writeFileSync(configFile, JSON.stringify({ thread }, null, 2) + '\n');
        console.log(`Created thread ${thread}; saved to ${configFile}`);
    });
    act('Send the charter as the kickoff message', () => sh('t3-threads', ['send', thread, '--file', '-'], KICKOFF));
}

console.log(`
Next: watch the "Evolve maintainer" thread's kickoff. It should run check.js without asking you
for approval; if it asks, the allow rules weren't picked up. Then run the live bot from the worktree:
  cd ${DIR} && STRATEGY=evolve node gym/record.js "$(cat ~/.config/lack/token)"`);
