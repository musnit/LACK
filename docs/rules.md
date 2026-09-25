# Rules

## Rounds and actions

Each round randomly places surviving units in distinct cells and selects a viable
configured target shape. A shape is viable when it fits the board and there are
enough surviving units across all players. Positions, speech and blush reset;
energy and your Player instance persist. There is no wrapping at board edges.

Each turn gives each unit at most one action: move one orthogonal cell, say text,
or set blush. An omitted, invalid or late action leaves it still. Speech is a
well-formed Unicode string of 0–256 code points, visible on the next turn only.
Blush is `#` plus six hex digits, normalized to lowercase; it persists until
changed or the next round, when it resets to `null`.

Movement resolves simultaneously:

- Out-of-bounds moves stay still.
- Multiple claims on one destination block the movers. A stationary occupant
  also blocks incoming movement; blocking propagates back through a chain.
- Two units cannot swap positions.
- Following a moving unit into its vacated cell is allowed if the chain succeeds.
  Cycles longer than two can rotate when no other collision blocks them.

## Formations and energy

Only the board at **round end** determines energy. All target cells must be
occupied; ownership does not matter, and extra neighboring units are allowed.
Use the target's exact offsets: translations match, implicit rotations and
reflections do not. Board.js contains the complete default shape catalogue.

The matcher scans candidate origins top-to-bottom, then left-to-right. It accepts
a match only if none of its units has already been used by an earlier match.
Thus overlapping candidates are resolved greedily, not by maximum coverage.

A matched unit receives the configured win adjustment once; every other unit
receives the loss adjustment. Defaults: start at 2, matched +0, unmatched −1.
Only positive-energy units survive. No action directly consumes energy, attacks,
creates units, or transfers energy. Rounds end after the configured turn count;
games end at their round limit or when no target is viable. One remaining
competitor does not itself end the game.

## Information and results

You know your surviving units' handles, positions and energy. All other occupied
positions are anonymous. Public arrays are independently shuffled each frame;
their indices are not identities. Speech has no sender attribution. Invented
identities, impersonation, copied blush, tracking by inference and external
coordination are allowed. The API is not a sandbox or an isolation guarantee.
The website may show aggregate energy and survivor counts by competitor;
individual foreign units remain anonymous in Player observations.

At normal completion, rank competitors by total surviving energy, then survivor
count, both descending. Eliminated units contribute zero. Equal values share
competition ranks (for example 1, 1, 3). Only a unique first place wins; a leading
tie, including mutual elimination, is a draw. Failed/cancelled games award no win.

## Arena and Clash

Connecting opts into both enabled modes; one process can play several games.
Arena orders eligible online competitors by accumulated Arena wins, then
case-insensitive username. Each non-top competitor can challenge the immediately
higher one, while also defending. Existing matches keep their original roles.
Capacity and duplicate-pair constraints can delay starts. An optional golem
interacts normally but receives no competitive result or account wins.

Clash runs one multiplayer game at a time, with equal units and no golem. The
roster freezes at admission; late arrivals wait. Overflow rotates fairly, followed
by a configured break between games. Arena and Clash record wins separately;
only unique winners of normally completed games gain a win. Displayed leaderboard
ranks depend on wins alone, with shared ties; zero-win users are unranked.
