// Play local games between strategy files and print a scoreboard.
//
//   node gym/run.js                                  player.js vs strategies/random.js, arena settings
//   node gym/run.js --games 50 player.js strategies/random.js
//   node gym/run.js --preset clash a.js b.js c.js d.js
//   node gym/run.js --config gym/recordings/latest-config.json player.js strategies/random.js
//   node gym/run.js --watch        draw the board at the end of every round
//   node gym/run.js --watch-turns  animate every turn (--delay ms between frames)
const { resolve, basename } = require('node:path');
const { parseArgs } = require('node:util');
const { runGame } = require('./host');
const { render } = require('./render');
const { PRESETS, loadRecordedConfig } = require('./presets');

const { values: options, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        preset: { type: 'string', default: 'arena' },
        config: { type: 'string' },
        games: { type: 'string', default: '1' },
        golem: { type: 'string' },
        watch: { type: 'boolean', default: false },
        'watch-turns': { type: 'boolean', default: false },
        delay: { type: 'string', default: '60' },
        latency: { type: 'string', default: '50' },
        'real-time': { type: 'boolean', default: false }
    }
});

const config = options.config ? loadRecordedConfig(options.config) : PRESETS[options.preset];
if (!config) throw new Error(`Unknown preset "${options.preset}". Use: ${Object.keys(PRESETS).join(', ')}`);

const files = positionals.length ? positionals : ['player.js', 'strategies/random.js'];
const entrants = files.map((file, index) => ({
    name: `${basename(file, '.js')}${files.indexOf(file) !== index ? `#${index + 1}` : ''}`,
    Strategy: require(resolve(file))
}));
// --golem FILE adds a noncompetitive team, like the optional Arena golem.
// Nobody knows how the live golem behaves; a random walker is a stand-in.
if (options.golem) {
    entrants.push({ name: 'golem', Strategy: require(resolve(options.golem)), competitive: false, units: config.golemUnits || config.unitsPerPlayer });
}

const games = Number(options.games);
const delay = Number(options.delay);
const sleep = ms => new Promise(done => setTimeout(done, ms));
const names = entrants.map(entrant => entrant.name);
const board = (event, title) => process.stdout.write('\x1b[H\x1b[2J' + render(event.game, names, { ...event, title }) + '\n');

const tally = new Map(entrants.filter(entrant => entrant.competitive !== false)
    .map(entrant => [entrant.name, { wins: 0, energy: 0, survivors: 0, errors: 0, late: 0 }]));
let draws = 0;

(async () => {
    for (let gameIndex = 0; gameIndex < games; gameIndex++) {
        const title = `Game ${gameIndex + 1}/${games} · `;
        const result = await runGame({
            config, entrants,
            latencyMs: Number(options.latency),
            realTime: options['real-time'],
            onEvent: async event => {
                if (options['watch-turns'] && event.type !== 'round-end') { board(event, title); await sleep(delay); }
                if (options.watch && event.type === 'round-end') { board(event, title); await sleep(delay * 10); }
            }
        });
        let winner = null;
        for (const player of result.players.filter(player => player.competitive)) {
            const row = tally.get(player.name);
            row.energy += player.result?.totalEnergy ?? 0;
            row.survivors += player.result?.survivorCount ?? 0;
            row.errors += player.errors;
            row.late += player.late;
            if (player.result?.winner) { row.wins++; winner = player.name; }
        }
        if (!winner) draws++;
        if (games > 1 && !options.watch && !options['watch-turns']) {
            process.stdout.write(`game ${gameIndex + 1}: ${winner ?? 'draw'} (${result.rounds} rounds)\n`);
        }
    }

    console.log(`\n${games} game(s), ${config.width}x${config.height}, ${config.unitsPerPlayer} units each, ${config.maxRounds} rounds of ${config.turnsPerRound} turns`);
    console.table(Object.fromEntries([...tally].map(([name, row]) => [name, {
        wins: row.wins,
        'win %': Math.round(100 * row.wins / games),
        'avg energy': +(row.energy / games).toFixed(1),
        'avg survivors': +(row.survivors / games).toFixed(1),
        errors: row.errors,
        'late turns': row.late
    }])));
    console.log(`draws: ${draws}`);
})();
