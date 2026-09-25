// Child process that plays one gym run and reports back over IPC, so slow strategies
// never block the web server. Started by web/server.js with the run spec as JSON in argv.
const { resolve } = require('node:path');
const { runGame } = require('../gym/host');
const { replayFromGame } = require('./replay');

const spec = JSON.parse(process.argv[2]);
const root = resolve(__dirname, '..');
const MAX_REPLAYS = 10;

const entrants = spec.strategies.map((file, index) => ({
    name: `${file.replace(/^strategies\//, '').replace(/\.js$/, '')}${spec.strategies.indexOf(file) !== index ? `#${index + 1}` : ''}`,
    Strategy: require(resolve(root, file))
}));
if (spec.golem) entrants.push({ name: 'golem', Strategy: require(resolve(root, spec.golem)), competitive: false,
    units: spec.config.golemUnits || spec.config.unitsPerPlayer });

(async () => {
    process.send({ type: 'start', names: entrants.map(entrant => entrant.name) });
    for (let index = 0; index < spec.games; index++) {
        const keepReplay = index < MAX_REPLAYS;
        let game;
        const result = await runGame({
            config: spec.config, entrants, latencyMs: spec.latencyMs ?? 50,
            onEvent: event => { game = event.game; }
        });
        const replay = keepReplay ? replayFromGame(game, entrants.map(entrant => entrant.name), result) : null;
        process.send({ type: 'game', index, result, replay });
    }
    // Exit only once queued IPC messages have been delivered.
    process.send({ type: 'done' }, () => process.exit(0));
})().catch(error => {
    process.send({ type: 'error', message: String(error?.stack ?? error) }, () => process.exit(1));
});
