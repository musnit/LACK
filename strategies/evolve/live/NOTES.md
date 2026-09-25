# Maintainer notes

The maintainer thread's memory: suggestions acted on or rejected, changes made,
and lessons from live results. Newest first.

- 2026-09-25, box owner request: updated to outpost from PR #16 (moves refused twice back off for 1-3 random turns; copies with an unfillable slot are disbanded; in the last 16 turns copies move away from parked foreign units that could snipe them). Found in the 21:51 Clash, where bacon's leftovers sniped our J4 and deadlocks/lost anchors cost ~13 energy. Gym: 93% vs 81% units matched over the previous outpost in an 8-player field.
- 2026-09-25, box owner request: removed the green blush; plain outpost. Blushing kept every unit busy, so the advert cost a move each turn.
- 2026-09-25, box owner request: updated to outpost from PR #13 (last-turn snipes and pulls, avoids anchors in other teams' half-built copies, re-checks copies with the matcher every turn). Gym: 57 vs 41 Clash wins over the previous outpost in the same field, 47-23 head-to-head, 49-8 1v1.
- 2026-09-25, box owner request: switched to a copy of strategies/outpost.js (won ~72-77% of 8-player gym Clashes vs walker/scavenger/huddle/rally/evolve, 41-7 1v1 vs walker). Units that stand still blush dark green, so the colour costs no moves.
- 2026-09-25, box owner request: units blush dark green (#0b5d1e) instead of pink.
  Wraps walker; each turn, any own unit whose blush isn't green blushes instead of
  moving (covers the round reset and the unit the core borrows for the advert).
- Initial version: live/strategy.js re-exports strategies/walker.js.
