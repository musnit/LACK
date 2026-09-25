# Evolve: a self-updating strategy

A dedicated T3 thread (the *maintainer*) rewrites this strategy while it plays.
Other players can steer it: every turn a random one of our units says

> I'm a self-evolving bot. Say "evolve: <idea>" and my AI maintainer may rewrite my strategy with it.

and anything said in the game that starts with `evolve:` becomes a suggestion
for the maintainer.

```
                 game server
                     │ turns, messages
┌────────────────────▼──────────── bot process (has the token) ───────┐
│ index.js + core/  (static; the maintainer may not edit it)          │
│   speech.js  owns all speech: advert every turn, picks suggestions, │
│              drops the live strategy's own `say` commands           │
│   relay.js   one-slot buffer → every 15 s → t3-threads send ────────┼──► Evolve maintainer
│   sandbox.js runs live/ in a locked-down child process, hot reload  │     thread (T3)
└────────────────────┬────────────────────────────────────────────────┘        │ edits live/,
                     │ IPC: round / turn / roundEnd / finish                    │ runs core/check.js
┌────────────────────▼──── child: node --permission, no network ──────┐        │
│ live/strategy.js  (dynamic; a normal kit Player subclass)  ◄────────┼────────┘
└─────────────────────────────────────────────────────────────────────┘
```

## Layout

| Path | Who changes it | What it is |
| --- | --- | --- |
| `index.js` | you, by pull request | The `Player` the kit loads (`STRATEGY=evolve`). Wires the parts below together. |
| `core/sandbox.js`, `core/runner.js` | you | Run live/ in a child process, one instance per game, switching running games to changed code at their next turn. |
| `core/speech.js` | you | The advert, suggestion filter and command filter. |
| `core/relay.js`, `core/charter.md` | you | Sends suggestions to the thread, wrapped in the charter (its standing rules). |
| `core/check.js` | you | The only command the thread may run: sandbox load, tests, smoke games, commit live/. |
| `core/setup.js` | you | One-time creation of the worktree, permissions and thread. |
| `live/strategy.js`, `live/NOTES.md` | the maintainer thread | The strategy, and the thread's memory. |
| `data/` (git-ignored) | the bot | `config.json` (thread id) and `log.jsonl` (games, suggestions heard/relayed, reload errors). |

## The live API

`live/strategy.js` exports a class derived from `game/Player`, exactly like any
kit strategy: `round`, `async turn`, `roundEnd`, `finish`. So anyone can try
their existing strategy on this setup by dropping it in. From `live/`, require
Player as `'../../../game/Player'` and shared helpers as `'../../lib'`. Two
differences from running it directly:

- Its `say` commands are dropped (only moves and blushes for our own units pass),
  and each turn one unit (a random idle one if any) says the advert instead of acting.
- It runs sandboxed (below). A new version takes effect about a second after it's saved: each
  game gets a fresh instance at its next turn, with the current round's context replayed,
  just like after a reconnect. Only in-memory state starts over.

## Relay

Each turn, heard messages starting with `evolve:` go into a single slot, which
keeps only the most recent one. Every 15 seconds a full slot is sent to the
thread and emptied. If the thread refuses (busy, or waiting for your approval),
the suggestion stays for the next tick unless a newer one replaces it. Repeating
the last text sent is ignored. Relaying runs only under the live client
(`client.js`, `gym/record.js`); gym games play identically but never relay.

## Safety layers

Suggestions come from anonymous players, so assume some will be prompt injections.

1. **Charter.** `core/charter.md` goes to the thread at kickoff and at the top
   of every relayed prompt. It lets the thread edit only `live/` and run only
   `core/check.js`, and tells it to treat the suggestion, JSON-quoted below the
   charter, as data.
2. **Permissions, enforced by Claude Code.** The thread runs in T3's
   "approval-required" mode. `setup.js` writes `.claude/settings.local.json` in
   its worktree. That file allows editing `strategies/evolve/live/**` and running
   `node strategies/evolve/core/check.js` and read-only `git status`/`git diff`/`git log`. It
   denies edits to core/, tests/, game/, .claude/, reads of `~/.config`, `~/.ssh`,
   `~/.t3`, `/run`, `/proc`, web access and T3's MCP tools. Anything else, such as
   another command, a read outside the worktree or an edit elsewhere, stops and
   waits for your approval in T3. While a thread waits, relayed prompts are refused.
3. **Sandboxed live code.** The code the thread writes runs in a child process
   under Node's permission model. It can read only `game/` and `strategies/`, so
   not the token (`~/.config/lack/token`, or the parent's command line via
   `/proc`). It can't write files, spawn processes or start workers. It gets an
   empty network namespace when `unshare` works (it does on this box) and an empty
   environment. A turn that overruns its deadline returns no commands, and three
   in a row restart the child. Code that fails to load is skipped.
4. **Speech stays in the core.** Live code can't talk, so it can't leak anything by chat.

Residual risks: the thread is an agent reading attacker-written text, so
layer 2 is what really bounds it. Keep an eye on its approval requests and
never approve one you don't understand. The live code can still misplay on
purpose (e.g. walk units off to lose). Without `unshare`, the live child could
use the network, although it has nothing secret to send.

## Set up and run

After this is merged, once:

```sh
node strategies/evolve/core/setup.js            # --dry-run to preview
```

That script:

1. Creates the worktree `~/LACK-evolve` on branch `evolve/live` from `origin/main`.
2. Writes the thread's permissions into that worktree.
3. Marks the worktree trusted in `~/.claude.json`, because Claude Code ignores
   project allow rules in untrusted folders. If the mark is lost, the thread just
   asks for approval more often.
4. Creates the "Evolve maintainer" thread, copying the model from a Claude
   thread in the project, and sends it the charter as a kickoff.

The kickoff asks the thread to run `core/check.js` once. If T3 asks you to
approve that, the allow rules weren't picked up.

Then run the bot from that worktree, so the thread's edits reach it:

```sh
cd ~/LACK-evolve && STRATEGY=evolve node gym/record.js "$(cat ~/.config/lack/token)"
```

The thread commits each accepted change to `live/` on `evolve/live`. That
branch is the strategy's history; merge from it (or reset it) as you like.
