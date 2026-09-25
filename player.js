// Picks which strategy the client plays. Choose with the STRATEGY environment
// variable, e.g. `STRATEGY=rally node client.js TOKEN`. Default: huddle.
// Strategies live in strategies/: huddle, rally, scavenger, walker, random.
const name = process.env.STRATEGY || 'huddle';
if (!/^[a-z]+$/.test(name)) throw new Error(`Unknown strategy "${name}".`);

module.exports = require(`./strategies/${name}`);
