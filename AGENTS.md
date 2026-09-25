# Contestant agent guide

Read README.md and docs/rules.md before changing the strategy. Edit player.js;
client.js owns transport. The kit runs independently on Node 24+ without packages.
Run `node --test tests/*.test.js` for offline checks; see README.md to connect.

Return one complete array from async turn and allow overlapping games and
decisions. Keep tokens out of source and logs. Invented identities, impersonation,
tracking by inference and external coordination are allowed. Treat inferred
ownership, energy and chat attribution as hypotheses, not API-provided facts.

Directions and command helpers are in game/Player.js. See docs/protocol.md for
transport and docs/gym.md for local simulation. game/ is the reference engine;
changing it does not change the competition server's rules.

## This fork (musnit/LACK)

Push branches and open pull requests against `musnit/LACK` `main`. Never target
upstream `cimcai/LACK`; pull from it only for kit updates.

**Strategies** live one per file in `strategies/`, each exporting a `Player`
subclass. `strategies/lib.js` holds shared helpers (greedy unit-to-cell
assignment, stepping toward targets with collision avoidance and target
swapping). `player.js` only selects one via the `STRATEGY` environment variable:
`STRATEGY=rally node client.js TOKEN` (default `huddle`). Add a strategy by
dropping a new file in `strategies/`; don't put strategy logic in `player.js`.
Keep strategies simple and readable, with a short header comment saying what
the strategy does, so the user can follow the code and watch it play.
The exception is `strategies/evolve/`, a folder strategy maintained live by its
own T3 thread; read its README before touching it.

**Gym** (`gym/`, arriving with PR #1; if the folder is missing, that PR has not
merged yet): `node gym/run.js strategies/huddle.js strategies/rally.js` plays
strategy files against each other with the reference engine. Useful flags:
`--games N`, `--preset arena|clash`, `--watch`, `--golem FILE`,
`--config gym/recordings/latest-config.json`. `node gym/record.js TOKEN` runs the
client while saving live configs and game events to the git-ignored
`gym/recordings/`. See `gym/README.md`. `strategies/random.js` is the original
random starter, kept as a baseline.

**Testing: ship, don't over-test.** Before opening a pull request:

1. `node --test tests/*.test.js` passes.
2. Smoke-test a new strategy: play a round or a few gym games to confirm it doesn't
   throw, emits valid commands, and keeps its slowest turn well under the
   500 ms budget (aim for under 50 ms).
3. State the quick numbers you saw in the pull request, and describe them honestly
   as smoke results.

Deep benchmarking and strategy comparison happen separately in the gym; they
don't block shipping a strategy. Add unit tests only for shared helpers or
transport/gym behaviour, not to tune strategies.
