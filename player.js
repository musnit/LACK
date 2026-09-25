// A deliberately simple strategy:
//   1. On the first turn of a round, colour every unit pink so they are easy to spot,
//      and plan a tidy grid of target-shape copies near where our units already are.
//   2. Give each unit the closest free cell ("home") in that grid.
//   3. Every other turn, walk each unit one step toward its home.
// Units left over (fewer than one full shape) just stand still.
const Player = require('./game/Player');

const COLOR = '#ff33cc';

class Walker extends Player {
    round(width, height, targetShape) {
        super.round(width, height, targetShape);
        this.homes = null;     // handle -> { x, y }, planned on the first turn
        this.lastSeen = {};    // handle -> { x, y, stuck } to notice units that aren't moving
    }

    async turn(state) {
        if (!this.homes) {
            this.homes = this.#planHomes(state.ownUnits);
            return state.ownUnits.map(unit => Player.commands.blush(unit.handle, COLOR));
        }

        const occupied = new Set(state.units.map(unit => key(unit.x, unit.y)));
        const ownAt = new Map(state.ownUnits.map(unit => [key(unit.x, unit.y), unit]));
        const claimed = new Set();   // destinations already chosen this turn, so our units don't collide
        const commands = [];

        for (const unit of state.ownUnits) {
            const home = this.homes.get(unit.handle);
            const stuck = this.#updateStuck(unit);
            if (!home || (unit.x === home.x && unit.y === home.y)) continue;   // no job, or already home

            // Try the directions that get us closer, most useful first.
            const options = directionsToward(unit, home)
                .map(direction => ({ direction, cell: step(unit, direction) }))
                .filter(({ cell }) => !occupied.has(key(cell.x, cell.y)) && !claimed.has(key(cell.x, cell.y)));

            if (options.length) {
                claimed.add(key(options[0].cell.x, options[0].cell.y));
                commands.push(Player.commands.move(unit.handle, options[0].direction));
                continue;
            }

            // Blocked. If a teammate already sitting at its own home is in the way, swap jobs:
            // we take its spot and it moves on toward ours (this unjams shapes with an inner cell).
            const blocker = directionsToward(unit, home)
                .map(direction => ownAt.get(keyOf(step(unit, direction))))
                .find(other => other && isHome(other, this.homes.get(other.handle)));
            if (blocker) {
                this.homes.set(unit.handle, this.homes.get(blocker.handle));
                this.homes.set(blocker.handle, home);
                continue;
            }

            // Stuck behind someone else for a while: wiggle in a random direction.
            if (stuck >= 3) {
                const directions = Object.values(Player.DIRECTIONS);
                commands.push(Player.commands.move(unit.handle, directions[Math.floor(Math.random() * directions.length)]));
            }
        }
        return commands;
    }

    // Lay out as many whole copies of the shape as we can afford, in a rough square,
    // with a one-cell gap between copies so they never merge into each other.
    #planHomes(units) {
        const shape = this.targetShape;
        const copies = Math.floor(units.length / shape.cells.length);
        const homes = new Map();
        if (!copies) return homes;

        const columns = Math.ceil(Math.sqrt(copies));
        const rows = Math.ceil(copies / columns);
        const pitchX = shape.width + 1, pitchY = shape.height + 1;
        const blockWidth = columns * pitchX - 1, blockHeight = rows * pitchY - 1;

        // Centre the block on our units' average position, kept inside the board.
        const avgX = units.reduce((sum, unit) => sum + unit.x, 0) / units.length;
        const avgY = units.reduce((sum, unit) => sum + unit.y, 0) / units.length;
        const left = clamp(Math.round(avgX - blockWidth / 2), 0, this.width - blockWidth);
        const top = clamp(Math.round(avgY - blockHeight / 2), 0, this.height - blockHeight);

        const cells = [];
        for (let copy = 0; copy < copies; copy++) {
            const originX = left + (copy % columns) * pitchX;
            const originY = top + Math.floor(copy / columns) * pitchY;
            for (const [dx, dy] of shape.cells) cells.push({ x: originX + dx, y: originY + dy });
        }

        // Greedy matching: repeatedly pair the closest remaining unit and cell.
        const pairs = [];
        for (const unit of units) for (const cell of cells) pairs.push({ unit, cell, distance: distance(unit, cell) });
        pairs.sort((a, b) => a.distance - b.distance);
        const usedCells = new Set();
        for (const { unit, cell } of pairs) {
            if (homes.has(unit.handle) || usedCells.has(cell)) continue;
            homes.set(unit.handle, cell);
            usedCells.add(cell);
        }
        return homes;
    }

    // Count how many turns in a row a unit has stayed in the same cell.
    #updateStuck(unit) {
        const last = this.lastSeen[unit.handle];
        const stuck = last && last.x === unit.x && last.y === unit.y ? last.stuck + 1 : 0;
        this.lastSeen[unit.handle] = { x: unit.x, y: unit.y, stuck };
        return stuck;
    }
}

// Directions that reduce the distance to the target, bigger gap first.
function directionsToward(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const horizontal = dx > 0 ? 'right' : dx < 0 ? 'left' : null;
    const vertical = dy > 0 ? 'down' : dy < 0 ? 'up' : null;
    const ordered = Math.abs(dx) >= Math.abs(dy) ? [horizontal, vertical] : [vertical, horizontal];
    return ordered.filter(Boolean);
}

function step(unit, direction) {
    const [dx, dy] = Player.DELTAS[direction];
    return { x: unit.x + dx, y: unit.y + dy };
}

const key = (x, y) => `${x},${y}`;
const keyOf = cell => key(cell.x, cell.y);
const isHome = (unit, home) => home && unit.x === home.x && unit.y === home.y;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

module.exports = Walker;
