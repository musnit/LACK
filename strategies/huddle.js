// Huddle: split our units into small local groups, one per copy of the
// target shape. Each group builds its copy near where its members start,
// so nobody has to walk far. Copies keep a one-cell gap between their
// bounding boxes, so neighbouring copies never confuse the matcher.
// Leftover units (fewer than one shape's worth) stay put.
const Player = require('../game/Player');
const { key, distance, cellsAt, assign, moveToward } = require('./lib');

class Huddle extends Player {
    round(width, height, targetShape) {
        super.round(width, height, targetShape);
        this.targets = null; // planned on the first turn, once we see positions
    }

    async turn(state) {
        if (!this.targets) this.targets = this.#plan(state.ownUnits);
        return moveToward(state, this.targets, this.width, this.height);
    }

    #plan(ownUnits) {
        const shape = this.targetShape, size = shape.cells.length;
        const reserved = new Set(); // cells claimed by earlier copies, plus their margin
        const targets = new Map();
        // Sweep top-left to bottom-right so each group is a compact local cluster.
        let free = [...ownUnits].sort((a, b) => a.y - b.y || a.x - b.x);
        while (free.length >= size) {
            const seed = free[0];
            const group = [...free].sort((a, b) => distance(seed, a) - distance(seed, b)).slice(0, size);
            const cx = group.reduce((sum, u) => sum + u.x, 0) / size;
            const cy = group.reduce((sum, u) => sum + u.y, 0) / size;
            const origin = this.#nearestFreeOrigin(cx - shape.width / 2, cy - shape.height / 2, reserved);
            if (!origin) break;
            for (let y = origin.y - 1; y <= origin.y + shape.height; y++) {
                for (let x = origin.x - 1; x <= origin.x + shape.width; x++) reserved.add(key(x, y));
            }
            for (const [handle, slot] of assign(group, cellsAt(shape, origin.x, origin.y))) targets.set(handle, slot);
            free = free.filter(unit => !group.includes(unit));
        }
        return targets;
    }

    // The in-bounds origin closest to (px, py) whose bounding box avoids reserved cells.
    #nearestFreeOrigin(px, py, reserved) {
        const { width: w, height: h } = this.targetShape;
        let best = null, bestD = Infinity;
        for (let oy = 0; oy + h <= this.height; oy++) {
            for (let ox = 0; ox + w <= this.width; ox++) {
                const d = Math.abs(ox - px) + Math.abs(oy - py);
                if (d >= bestD) continue;
                let clear = true;
                for (let y = oy; y < oy + h && clear; y++) for (let x = ox; x < ox + w && clear; x++) clear = !reserved.has(key(x, y));
                if (clear) { best = { x: ox, y: oy }; bestD = d; }
            }
        }
        return best;
    }
}

module.exports = Huddle;
