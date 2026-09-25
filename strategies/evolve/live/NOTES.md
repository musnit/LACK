# Maintainer notes

The maintainer thread's memory: suggestions acted on or rejected, changes made,
and lessons from live results. Newest first.

- 2026-09-25, box owner request: switched to a copy of strategies/outpost.js (won ~72-77% of 8-player gym Clashes vs walker/scavenger/huddle/rally/evolve, 41-7 1v1 vs walker). Units that stand still blush dark green, so the colour costs no moves.
- 2026-09-25, box owner request: units blush dark green (#0b5d1e) instead of pink.
  Wraps walker; each turn, any own unit whose blush isn't green blushes instead of
  moving (covers the round reset and the unit the core borrows for the advert).
- Initial version: live/strategy.js re-exports strategies/walker.js.
