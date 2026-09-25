# Player wire protocol (version 1)

The supplied client implements this protocol. Alternative clients connect to the
site's `/ws` endpoint over WSS, using the player token obtained through the browser.
Native clients should omit Origin; a supplied Origin must be server-allowed.
Player sockets cannot perform browser login, account management or spectating.

## Envelopes and startup

All messages are JSON text with `version: 1`. Requests also have a unique positive
safe-integer `requestId`. Replies echo it:

```js
{ version: 1, type: 'response', requestId: 1, result: { /* operation result */ } }
{ version: 1, type: 'response', requestId: 1, error: { code: '...', message: '...' } }
```

Protocol errors can also arrive without a request ID:

```js
{ version: 1, type: 'error', code: 'invalid_message', message: '...' }
```

The client logs their code and message; they do not settle pending requests.
The server may close the connection, which rejects outstanding requests.

Wait for `{ version: 1, type: 'ready' }`, then immediately send:

```js
{ version: 1, requestId: 1, type: 'player-auth', token: 'YOUR_PLAYER_TOKEN' }
// result: { userName, userHue } — userHue is legacy metadata, not board identity
```

Authentication must complete within four seconds of connection. Prepare the token
before connecting. Invalid anonymous traffic or rejected credentials closes the
socket; retry with a fresh connection. Successful authentication precedes resume
and startup notifications. There is no strategy registration or manual join request.

On `player-join`, create a Player for that game and acknowledge the requested count:

```js
// Server (illustrative count):
{ version: 1, type: 'player-join', gameId: 'g', attemptId: 1,
  config: { /* match configuration */ }, count: 2 }
// Client:
{ version: 1, requestId: 2, type: 'player-joined', gameId: 'g', attemptId: 1,
  units: [{ handle: '0' }, { handle: '1' }] }
// result: { success: true }
```

Use the actual `count`, `gameId` and `attemptId`. Handles are unique within your
game: nonnegative safe integers (normalized to strings), or strings of 1–32 ASCII
letters, digits or underscores. Handles may repeat across games or accounts.
Acknowledge within ten seconds; failure cancels startup and suspends unready
clients until reconnect. No units join after play begins.

Config includes `width`, `height`, `startingEnergy`, `winEnergy`, `lossEnergy`,
`shapes`, `turnsPerRound`, `turnTimeMs`, and `maxRounds`. Read incoming configuration,
not the README's reference defaults. Shapes contain `name`, `width`, `height`,
and `cells: [[dx, dy], ...]`.

## Events

State and result fields are defined in [README](../README.md). Handle events per
game; clocks and game-local turn IDs are independent. Ignore unused extra fields.

| Type | Relevant fields / action |
| --- | --- |
| `player-resume` | `game`: summary (including `gameId`, `status`), `config`, `count`, owned `units`, `attemptId`, `ready`, `state`, `targetShape`, `turnId`, `remainingMs`. Reconstruct an instance. If playing, establish round context and respond to the current turn if present. For an unready startup, await `player-join`. |
| `player-round` | `gameId`, `roundIndex`, `targetShape`, `state`. Establish round context. |
| `player-turn` | `gameId`, `turnId`, `remainingMs`, `state`. Decide commands. |
| `player-round-end` | `gameId`, `state`, `outcomes` for your units, including newly eliminated ones. Notify the strategy. |
| `player-finished` | `gameId`, `endReason`, public `results`, your `result` (null for abnormal completion). Notify and discard the instance. |
| `player-released` | `gameId`. Discard an abandoned startup assignment. |

Resume units have handles only before play; playing entries additionally carry
coordinates, energy and blush. Empty owned state needs no commands. Reconnect
restores assignments, not private strategy memory. Normal end reasons are
`round-limit` and `no-viable-shape`; `stopped` and `error` are abnormal.

## Commands and limits

```js
{ version: 1, requestId: 3, type: 'player-commands', gameId: 'g', turnId: 7,
  commands: [{ handle: '0', commandName: 'move', params: ['up'] }] }
// result: { accepted: [true] }
```

Actions are `move` (up/down/left/right), `say` (0–256 well-formed Unicode code
points), and `blush` (`#RRGGBB`). `params` contains exactly one value. Use 1–128
entries per request. Send nothing for an empty decision. Several batches may
arrive in one turn. Each response boolean corresponds to its entry; false covers
invalid, foreign, eliminated, duplicate, stale or late commands. First valid
command per owned handle wins. Acceptance does not guarantee successful movement.

The server's monotonic deadline is authoritative. `remainingMs` is measured when
the event is sent; subtract time spent in transit and deciding. Keep the original
game/turn IDs with each decision, even when asynchronous work completes late.
There is no cancellation or replacement of an already accepted command.

- Incoming message maximum: 16 KiB, including envelope (UTF-8 bytes).
- Player request limit: 256/second per account, including replacement connections.
- The supplied client splits one completed return into at most 128 commands and
  a 12,000-byte command budget per message. Oversized entries are skipped with
  diagnostics. Non-array returns and serialization failures are reported.
- Server output queue bound: 512 KiB; slow clients can be disconnected (1013).
- Support standard WebSocket ping/pong (Node's built-in client handles it).

## Connection lifecycle

One connection controls an account. Same-token authentication replaces the old
socket (4001), preserving assignments. Normal disconnect holds pending startup
assignments for five seconds; active units remain indefinitely until normal game
termination, with missing commands treated as no-ops. Reconnecting with the same
token can recover active control. Token rotation closes the old socket (4003),
cancels pending matches and permanently detaches existing playing units; a new
token cannot recover them. Already accepted commands still resolve.

Browser logout does not invalidate the player token. Rotation or a ban does.
The supplied client logs errors and closes on request failures; it does not
retry or automatically reconnect. Turn exceptions are reported without blocking
future events. Disconnect clears instances without fabricating finish results.
