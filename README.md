# LatticeAnimals contestant kit

Control a group of units on a grid. Form the round's target shape to preserve
energy; finish with more surviving energy than your opponents.

## Start

1. Install **Node.js 24 or newer**. Check with `node --version`. No npm install is needed.
2. Open <https://latticeanimals.com>, select **Arena**, then **Register** with the
   organizer's invite code, or **Log in**. Usernames: 4–32 ASCII letters, digits,
   or underscores (case-insensitive). Passwords: 6–64 Unicode code points.
   Registration also logs you in.
3. In Arena or Clash, copy your **Client command line** and run it from this folder:

   ```sh
   node client.js YOUR_PLAYER_TOKEN wss://latticeanimals.com/ws
   ```

4. Look for `Authenticated at ...`, then `Joined game ...` in the terminal.
   Connecting automatically enters Arena and, when enabled, Clash. Leave the
   process running; watch games on the website. No source upload is needed.
5. Edit [player.js](player.js), stop the client with Ctrl-C, and run it again.

The organizer may supply another site/endpoint; use those together. Keep your
player token private and out of commits. The token controls your units; it is
separate from your browser login. Logging out of the website does not stop the client.

## Write your strategy

Export one class extending [Player](game/Player.js) from `player.js`.
The starter moves randomly and occasionally speaks. Each game gets a separate
instance controlling **all your units**, with memory retained between rounds.

| Hook | Contract |
| --- | --- |
| `round(width, height, targetShape)` | Synchronous. Call `super.round(...)` to store `this.width`, `this.height`, `this.targetShape`. Reset round-specific memory here. |
| `async turn(state, remainingMs)` | Return one complete command array. `[]` or `undefined` means no action. |
| `roundEnd(outcomes)` | Optional synchronous notification, including newly eliminated units. Entries: `{ handle, won, energyBefore, energyAfter, eliminated }`. |
| `finish(result)` | Optional synchronous notification: `{ name, totalEnergy, survivorCount, rank, winner }`, or `null` for an abnormal finish. |

`targetShape` is `{ name, width, height, cells: [[dx, dy], ...] }`.
Coordinates start at `(0, 0)` in the top-left; x increases right, y down.
Hook inputs are immutable. `state` contains:

- `ownUnits`: surviving owned `{ handle, x, y, energy, blush }` entries.
- `units`: **all** occupied `{ x, y, blush }` positions, including your own,
  shuffled without ownership or persistent public IDs.
- `messages`: shuffled `{ text }` speech from the previous turn, without sender attribution.

Replace the starter's turn body, for example:

```js
async turn(state, remainingMs) {
    return state.ownUnits.map(unit =>
        Player.commands.move(unit.handle, Player.DIRECTIONS.up)
    );
}
```

Available commands (one accepted action per unit per turn):

```js
Player.commands.move(handle, Player.DIRECTIONS.up) // up, down, left, right
Player.commands.say(handle, 'Hello')               // at most 256 Unicode code points
Player.commands.blush(handle, '#12abef')           // exactly six hexadecimal digits
```

Each returns `{ handle, commandName, params: [value] }`; helpers do not validate.
Use `Object.values(Player.DIRECTIONS)` to enumerate directions, `Player.DELTAS`
for offsets, and `Player.MAX_SPEECH_LENGTH` for the speech limit.
Omit a unit to stay still. Speech and blush also leave it still. Invalid entries
are ignored individually; the first valid command for each handle wins.

Return promptly: `remainingMs` is the server's remaining time **when sent**,
not an allowance for network latency. Late commands are ignored. There are no
partial returns or submission callbacks. Turns and games can overlap while an
async decision is pending; keep memory safe across awaits. Slow CPU work blocks
all games in this process. Bound expensive work and leave time to send the result.
Use `console.log` / `console.error` to debug. Returning commands does not guarantee
acceptance or successful movement.

## Settings and recovery

Shipped defaults below are a reference; the server's configuration for each game
is authoritative. The client receives it at startup/resume.

| Setting | Arena | Clash |
| --- | --- | --- |
| Board | 64 × 64 | 64 × 64 |
| Units per competitor | 32 | 16 |
| Competitors | 2 | 2–8 |
| Optional noncompetitive golem | 32 units | None |
| Turns per round / time per turn | 64 / 500 ms | 64 / 500 ms |
| Maximum rounds | 16 | 16 |
| Starting / win / loss energy | 2 / +0 / −1 | 2 / +0 / −1 |
| Break between games | Automatic matchmaking | 16 seconds |

- **Authenticated but waiting:** at least two eligible clients are needed.
  Arena capacity and Clash admission can also delay your next game.
- **Disconnected:** the example does not automatically reconnect. Restart it.
  Only one client controls an account; a new connection replaces the old one.
- **Restarting:** the same token can recover active units, but strategy memory
  is recreated. Units stay in the game without commands while disconnected.
  Disconnect does not call `finish`; the game may still be running.
- **Initialization failed/suspended:** fix the error and reconnect.
- **Token rejected:** copy the current token from Arena. Reset token only when
  needed: rotation permanently detaches control of existing games.
- **Registration failed:** check the invite/name with an organizer. If a response
  was lost, try logging in; the account may already exist.

## Reference

- [Rules](docs/rules.md): movement, formations, energy, scoring, matchmaking.
- [Protocol](docs/protocol.md): for alternative clients and languages.
- [Building a gym](docs/gym.md): engine API and host responsibilities.
- Run the offline checks: `node --test tests/*.test.js`.

