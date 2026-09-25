// Small helpers shared by the strategies in this folder.
const Player = require('../game/Player');

const key = (x, y) => `${x},${y}`;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// The absolute cells of `shape` when its top-left corner sits at (ox, oy).
const cellsAt = (shape, ox, oy) => shape.cells.map(([dx, dy]) => ({ x: ox + dx, y: oy + dy }));

// Greedy matching: repeatedly pair the closest remaining unit and slot.
// Returns Map(handle -> slot). Extra units or slots stay unpaired.
function assign(units, slots) {
    const pairs = [];
    for (const unit of units) for (const slot of slots) pairs.push({ unit, slot, d: distance(unit, slot) });
    pairs.sort((a, b) => a.d - b.d);
    const targets = new Map(), usedSlots = new Set();
    for (const { unit, slot } of pairs) {
        if (targets.has(unit.handle) || usedSlots.has(slot)) continue;
        targets.set(unit.handle, slot);
        usedSlots.add(slot);
    }
    return targets;
}

// One move per unit toward its target (Map handle -> {x, y}). Units try the
// directions that shorten the trip, skipping occupied or already-claimed cells.
// When one of our own units is in the way, the two swap targets ("pass the
// baton"), so the blocker walks deeper into the shape instead of walling it off.
// A stuck unit sometimes sidesteps so that jams clear up. Mutates `targets`.
function moveToward(state, targets, width, height) {
    const occupied = new Set(state.units.map(unit => key(unit.x, unit.y)));
    const ownAt = new Map(state.ownUnits.map(unit => [key(unit.x, unit.y), unit]));
    const swapped = new Set();
    const claimed = new Set();
    const commands = [];
    // Units farthest from their target move first; the cells they leave open up for others.
    const movers = state.ownUnits.filter(unit => targets.has(unit.handle))
        .sort((a, b) => distance(b, targets.get(b.handle)) - distance(a, targets.get(a.handle)));
    for (const unit of movers) {
        const target = targets.get(unit.handle);
        const here = distance(unit, target);
        if (here === 0 || swapped.has(unit.handle)) continue;
        const options = Object.entries(Player.DELTAS)
            .map(([direction, [dx, dy]]) => ({ direction, x: unit.x + dx, y: unit.y + dy }))
            .filter(step => step.x >= 0 && step.y >= 0 && step.x < width && step.y < height)
            .filter(step => !occupied.has(key(step.x, step.y)) && !claimed.has(key(step.x, step.y)))
            .map(step => ({ ...step, d: distance(step, target) }))
            .sort((a, b) => a.d - b.d || Math.random() - 0.5);
        const blocker = Object.values(Player.DELTAS)
            .map(([dx, dy]) => ownAt.get(key(unit.x + dx, unit.y + dy)))
            .find(other => other && targets.has(other.handle) && !swapped.has(other.handle)
                && distance(other, target) < here);
        if (blocker && !(options[0]?.d < here)) {
            const theirs = targets.get(blocker.handle);
            if (distance(blocker, target) + distance(unit, theirs) <= here + distance(blocker, theirs)) {
                targets.set(blocker.handle, target);
                targets.set(unit.handle, theirs);
                swapped.add(unit.handle).add(blocker.handle);
                continue;
            }
        }
        const step = options[0];
        if (!step || (step.d > here && Math.random() < 0.7)) continue;
        claimed.add(key(step.x, step.y));
        occupied.delete(key(unit.x, unit.y));
        commands.push(Player.commands.move(unit.handle, step.direction));
    }
    return commands;
}

module.exports = { key, distance, cellsAt, assign, moveToward };
