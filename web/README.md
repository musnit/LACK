# Dashboard

```sh
node web/server.js                      # honours HOST and PORT (default 127.0.0.1:8080)
LACK_AUTOSTART=0 PORT=8081 node web/server.js   # test copy: never auto-starts the live bot
```

- **Gym**: start runs (2–8 players, preset or recorded live settings, optional golem), scoreboard, replays of up to 10 games per run. Runs play in a child process and are saved under `gym/runs/` (git-ignored).
- **Live bot**: start / stop / restart the live bot through `gym/record.js`, choose which `strategies/` file it plays (passed to `player.js` as `STRATEGY`, saved in `~/.config/lack/live.json`), and read its log. The token is read from `~/.config/lack/token` (never the repo). It restarts with the dashboard unless you stopped it (`~/.config/lack/live.json`).
- **Evolve**: `evolve` plays from its own worktree (`~/LACK-evolve`, or `LACK_EVOLVE_DIR`), where its maintainer thread edits it. The Live bot page then shows the thread and the suggestions it heard and relayed. See `strategies/evolve/README.md`.
- **Recordings**: replays of live games from `gym/recordings/` (and from evolve's worktree). Only our units are known; everyone else is one anonymous team.
- **Strategies**: read-only source of every `strategies/*.js` file (or folder `index.js`) that defines a `Player` subclass (so not `lib.js`).

Non-GET API calls require an `x-lack: 1` header, so other sites can't trigger them from a browser.
