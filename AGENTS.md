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
