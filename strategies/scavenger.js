// Scavenger: every turn, look at ALL units on the board (ours and theirs)
// and find spots where the target shape is already partly filled. Send our
// nearest free units to plug the gaps. Ownership doesn't matter for
// matching, so finishing someone else's half-built shape saves our units.
const Player = require('../game/Player');
const { key, distance, cellsAt, moveToward } = require('./lib');

const TURNS_PER_ROUND = 64; // server default; used to skip gaps we can't reach in time

class Scavenger extends Player {
    round(width, height, targetShape) {
        super.round(width, height, targetShape);
        this.turnsLeft = TURNS_PER_ROUND;
    }

    async turn(state) {
        const turnsLeft = this.turnsLeft--;
        const shape = this.targetShape;
        const occupied = new Set(state.units.map(u => key(u.x, u.y)));
        const ownAt = new Map(state.ownUnits.map(u => [key(u.x, u.y), u]));

        // Candidate placements: every position touching at least one of our units or near one.
        const candidates = [];
        for (let oy = 0; oy + shape.height <= this.height; oy++) {
            for (let ox = 0; ox + shape.width <= this.width; ox++) {
                const cells = cellsAt(shape, ox, oy);
                const filled = cells.filter(c => occupied.has(key(c.x, c.y)));
                if (!filled.length) continue;
                const missing = cells.filter(c => !occupied.has(key(c.x, c.y)));
                const mine = filled.map(c => ownAt.get(key(c.x, c.y))).filter(Boolean);
                // Rough cost: how far our nearest units are from each gap.
                const cost = missing.reduce((sum, c) =>
                    sum + Math.min(...state.ownUnits.map(u => distance(u, c))), 0);
                candidates.push({ cells, missing, mine, cost });
            }
        }
        // Nearly finished shapes first, then the ones cheapest to finish.
        candidates.sort((a, b) => a.missing.length - b.missing.length || a.cost - b.cost);

        const usedCells = new Set(), busy = new Set(), targets = new Map();
        for (const { cells, missing, mine } of candidates) {
            if (cells.some(c => usedCells.has(key(c.x, c.y)))) continue;
            if (mine.some(u => busy.has(u.handle))) continue;
            // Pick a free unit for each gap, nearest first, if it can arrive in time.
            const helpers = [];
            for (const gap of missing) {
                const helper = state.ownUnits
                    .filter(u => !busy.has(u.handle) && !mine.includes(u) && !helpers.some(h => h.unit === u))
                    .sort((a, b) => distance(a, gap) - distance(b, gap))[0];
                if (!helper || distance(helper, gap) > turnsLeft) break;
                helpers.push({ unit: helper, gap });
            }
            if (helpers.length < missing.length) continue;
            if (!mine.length && !helpers.length) continue; // not our business
            for (const c of cells) usedCells.add(key(c.x, c.y));
            for (const u of mine) { busy.add(u.handle); targets.set(u.handle, u); } // hold position
            for (const { unit, gap } of helpers) { busy.add(unit.handle); targets.set(unit.handle, gap); }
        }
        return moveToward(state, targets, this.width, this.height);
    }
}

module.exports = Scavenger;
