# Gym

Play strategies against each other locally with the kit's reference engine (`game/`).

```sh
node gym/run.js                                   # player.js vs strategies/random.js, Arena settings
node gym/run.js --games 50 player.js strategies/random.js
node gym/run.js --preset clash a.js b.js c.js     # any number of strategy files
node gym/run.js --watch                           # draw the board at the end of each round
node gym/run.js --watch-turns --delay 80          # animate every turn
```

Board key: one letter per competitor (A = first file, B = second…, g = golem).
UPPERCASE units currently complete a target shape; lowercase ones don't.

| Option | Meaning |
| --- | --- |
| `--preset arena\|clash` | README defaults: 32 or 16 units each, 64×64, 16 rounds × 64 turns × 500 ms |
| `--config FILE` | Use settings recorded from the live server (see below) |
| `--golem FILE` | Add a noncompetitive team driven by FILE, like Arena's optional golem |
| `--games N` | Play N games and total wins, energy and survivors |
| `--latency MS` | Pretend network delay (default 50); replies later than `turnTimeMs − latency` are dropped |
| `--real-time` | Wait the full turn clock even when everyone has answered (default: move on early) |

Strategies are ordinary `player.js`-style files exporting a `Player` subclass.
`strategies/random.js` is the kit's original random starter, kept as a baseline.

## Matching the live server

Run the bot through the recorder instead of `client.js`. It behaves identically and
also saves what the server sends into `gym/recordings/` (git-ignored):

```sh
node gym/record.js YOUR_PLAYER_TOKEN wss://latticeanimals.com/ws
node gym/run.js --config gym/recordings/latest-config.json
```

- `latest-config.json`: the most recent game's real settings.
- `configs.jsonl`: one line per game: mode (when known), units each, competitor count, settings.
- `<gameId>.jsonl`: every observation, round, outcome and result for that game, plus the
  commands we sent, which is useful for studying opponents.

## What the gym can't reproduce

- **Opponents.** Live opponents may be much stronger than the random baseline or may bluff in chat.
  Recordings show what they did.
- **The golem's behaviour** is unknown. `--golem strategies/random.js` is only a stand-in.
- **Server details** beyond the engine: real network latency, matchmaking, disconnects.
  The engine in `game/` is a reference; the server's rules are authoritative.
