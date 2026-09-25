# Building a local gym

The `game/` files are directly loadable CommonJS modules with no dependencies.
Game owns synchronous rules; a host supplies players, target selection, clocks,
turn/round limits and termination. A minimal engine example, run from this folder:

```sh
node - <<'JS'
const Game = require('./game/Game');
const game = new Game(Array.from({ length: 6 }, (_, index) => ({
    unitId: `internal-${index}`, playerId: index < 3 ? 'a' : 'b',
    playerName: index < 3 ? 'Alice' : 'Bob', handle: String(index % 3), energy: 2
})), { width: 8, height: 8 });
for (let round = 0; round < 2; round++) {
    if (!game.viableShapes.length) break;
    game.round(game.viableShapes[0]);
    for (let turn = 0; turn < 4; turn++) game.turn({}); // all units stay
    const outcomes = game.match();
    console.log(game.outcomesFor('a', outcomes));
}
game.finish(game.viableShapes.length ? 'round-limit' : 'no-viable-shape');
console.log(game.view.results);
JS
```

This demonstrates engine calls, not event pacing or a complete training host.
Choose from `game.viableShapes` itself: `round()` requires a configured shape
object, not a separately reconstructed equivalent. Production selects a random
viable target each round. Constructor records supply each unit's initial energy;
set it explicitly to match your chosen configuration.

To connect Player strategies to a gym:

1. Construct one strategy instance per competitor. At round start call
   `game.round(target)` and each surviving player's `round(width, height, target)`.
2. Give each strategy only `game.observe(playerId)`. Never give it `game.state`,
   `game.units` or `game.log`: those expose internal identity and other private data.
3. Start decisions independently with a shared deadline. Each async handler awaits
   its own complete array; a timer closes the window without awaiting unresolved
   decisions. Do not sequentially await players or block resolution on Promise.all.
4. Filter entries for validity, ownership and deadline. Resolve handles through
   `game.unitIdFor(playerId, handle)`, validate via
   `Game.validCommand(commandName, params)`, and keep the first valid command per
   unit. Copy parameters; ignore malformed entries and closed-turn results.
5. Once the window closes, call `game.turn(commandsByUnitId)`, with an object of
   internal IDs to `{ commandName, params }`. Missing IDs stay still. Unlike Arena,
   this low-level call rejects an invalid batch atomically; filtering belongs to you.
6. After the configured turns, call `game.match()` once and notify strategies with
   `game.outcomesFor(playerId, outcomes)`. Start another round or call
   `game.finish('round-limit')` / `game.finish('no-viable-shape')`. Deliver each
   `game.resultFor(playerId)` to `finish()`. Use `stopped` / `error` for abnormal ends.

Game enforces a roster capacity of `Math.round(width * height * 0.25)`.
Other server configuration bounds include 16,384 cells, 128 units, 256 rounds,
4,095 turns per round, 1–60,000 ms turns, 64 shapes of at most 128 cells, and replay
budgets of 4,096 frames / 262,144 frame-unit entries. A gym should use actual match
settings; a configuration accepted by Game alone need not fit server limits.

`new Game(records, config, random)` accepts a placement random function returning
values in [0, 1). Observation shuffles use Math.random independently, so injecting
that function alone does not make the entire simulation deterministic. Game
retains history; release completed games during long training runs. Engine and
host changes in your gym do not change the live rules.
