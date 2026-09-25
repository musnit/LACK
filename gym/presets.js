// Match settings for local games.
//
// The built-in presets copy the README's reference defaults. The live server's
// settings are authoritative and can differ; `gym/record.js` saves the config the
// server actually sends, and `loadRecordedConfig` turns that file into a preset.
const { readFileSync } = require('node:fs');
const Game = require('../game/Game');

const shared = {
    width: 64, height: 64,
    startingEnergy: 2, winEnergy: 0, lossEnergy: -1,
    turnsPerRound: 64, turnTimeMs: 500, maxRounds: 16,
    shapes: Game.SHAPES
};

const PRESETS = {
    // 1v1, 32 units each. Live Arena can add a noncompetitive 32-unit golem (use --golem).
    arena: { ...shared, unitsPerPlayer: 32, golemUnits: 32 },
    // 2–8 players, 16 units each, no golem.
    clash: { ...shared, unitsPerPlayer: 16, golemUnits: 0 }
};

// A file written by gym/record.js: { mode, config, count, ... }.
function loadRecordedConfig(path) {
    const recorded = JSON.parse(readFileSync(path, 'utf8'));
    const base = PRESETS[recorded.mode] ?? PRESETS.arena;
    return { ...base, ...recorded.config, unitsPerPlayer: recorded.count ?? base.unitsPerPlayer };
}

module.exports = { PRESETS, loadRecordedConfig };
