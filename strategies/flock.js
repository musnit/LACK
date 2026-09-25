// Flock: a cellular-automaton-style bot, mostly useful as a gym opponent.
// There is no team plan. Each unit wears the team colour and looks only at
// units near it: any unit wearing that colour counts as an ally, whoever
// really owns it. Each turn a unit picks the nearby placement of the target
// shape that already holds the most allies (itself included) and steps toward
// its closest empty cell, or stays put if it already sits in the placement.
// A unit with no ally nearby walks toward the closest unit wearing its colour.
const Player = require('../game/Player');

const RADIUS = 5;
const COLOURS = ['#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#9333ea', '#0891b2', '#db2777', '#65a30d'];

class Flock extends Player {
    constructor() {
        super();
        this.colour = COLOURS[Math.floor(Math.random() * COLOURS.length)];
    }

    async turn(state) {
        const shape = this.targetShape, key = (x, y) => `${x},${y}`;
        const occupied = new Set(state.units.map(u => key(u.x, u.y)));
        const allies = new Set(state.units.filter(u => u.blush === this.colour).map(u => key(u.x, u.y)));
        const claimed = new Set();
        const commands = [];
        for (const unit of state.ownUnits) {
            if (unit.blush !== this.colour) { commands.push(Player.commands.blush(unit.handle, this.colour)); continue; }
            let best = null;
            for (let oy = unit.y - RADIUS; oy <= unit.y + RADIUS; oy++) for (let ox = unit.x - RADIUS; ox <= unit.x + RADIUS; ox++) {
                if (ox < 0 || oy < 0 || ox + shape.width > this.width || oy + shape.height > this.height) continue;
                const cells = shape.cells.map(([dx, dy]) => ({ x: ox + dx, y: oy + dy }));
                const friends = cells.filter(c => allies.has(key(c.x, c.y))).length;
                const reach = Math.min(...cells.map(c => Math.abs(c.x - unit.x) + Math.abs(c.y - unit.y)));
                if (!best || friends > best.friends || (friends === best.friends && reach < best.reach)) best = { cells, friends, reach };
            }
            let goal;
            if (best && best.friends > 1) {
                if (best.cells.some(c => c.x === unit.x && c.y === unit.y)) continue;
                const open = best.cells.filter(c => !occupied.has(key(c.x, c.y)));
                if (!open.length) continue;
                goal = open.reduce((a, b) => (Math.abs(b.x - unit.x) + Math.abs(b.y - unit.y) < Math.abs(a.x - unit.x) + Math.abs(a.y - unit.y) ? b : a));
            } else {
                // Nobody friendly nearby: head for the closest unit wearing our colour.
                const others = state.units.filter(u => u.blush === this.colour && (u.x !== unit.x || u.y !== unit.y));
                if (!others.length) continue;
                goal = others.reduce((a, b) => (Math.abs(b.x - unit.x) + Math.abs(b.y - unit.y) < Math.abs(a.x - unit.x) + Math.abs(a.y - unit.y) ? b : a));
                if (Math.abs(goal.x - unit.x) + Math.abs(goal.y - unit.y) <= 1) continue;
            }
            const step = Object.entries(Player.DELTAS)
                .map(([direction, [dx, dy]]) => ({ direction, x: unit.x + dx, y: unit.y + dy }))
                .filter(s => !occupied.has(key(s.x, s.y)) && !claimed.has(key(s.x, s.y)))
                .sort((a, b) => (Math.abs(a.x - goal.x) + Math.abs(a.y - goal.y)) - (Math.abs(b.x - goal.x) + Math.abs(b.y - goal.y)))[0];
            if (!step || Math.abs(step.x - goal.x) + Math.abs(step.y - goal.y) >= Math.abs(unit.x - goal.x) + Math.abs(unit.y - goal.y)) continue;
            claimed.add(key(step.x, step.y));
            commands.push(Player.commands.move(unit.handle, step.direction));
        }
        return commands;
    }
}

module.exports = Flock;
