// Rally: everyone marches to one meeting point (the median of our starting
// positions) and builds a tidy block of shape copies there, laid out on a
// grid with a one-cell gap between copies. Easy to spot when watching.
const Player = require('../game/Player');
const { cellsAt, assign, moveToward } = require('./lib');

class Rally extends Player {
    round(width, height, targetShape) {
        super.round(width, height, targetShape);
        this.targets = null;
    }

    async turn(state) {
        if (!this.targets) this.targets = this.#plan(state.ownUnits);
        return moveToward(state, this.targets, this.width, this.height);
    }

    #plan(ownUnits) {
        const shape = this.targetShape;
        const copies = Math.floor(ownUnits.length / shape.cells.length);
        const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
        const rx = median(ownUnits.map(u => u.x)), ry = median(ownUnits.map(u => u.y));
        // Every copy position on a (width+1) x (height+1) lattice, closest to the rally point first.
        const stepX = shape.width + 1, stepY = shape.height + 1, origins = [];
        for (let oy = 0; oy + shape.height <= this.height; oy += stepY) {
            for (let ox = 0; ox + shape.width <= this.width; ox += stepX) {
                const d = Math.abs(ox + shape.width / 2 - rx) + Math.abs(oy + shape.height / 2 - ry);
                origins.push({ x: ox, y: oy, d });
            }
        }
        origins.sort((a, b) => a.d - b.d);
        const slots = origins.slice(0, copies).flatMap(o => cellsAt(shape, o.x, o.y));
        return assign(ownUnits, slots);
    }
}

module.exports = Rally;
