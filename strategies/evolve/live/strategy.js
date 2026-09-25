// Evolve's live strategy: the part the maintainer thread rewrites.
//
// It uses the kit's standard Player API (round, turn, roundEnd, finish), so any
// existing strategy can be dropped in here; from this folder, require Player as
// '../../../game/Player' and shared helpers as '../../lib'. It runs sandboxed: it
// can read game/ and strategies/, but can't write files, use the network or start
// processes, and its `say` commands are dropped (evolve's core owns speech).
//
// Current version: a copy of strategies/outpost.js (the best gym strategy so far),
// with units that stand still this turn blushing dark green (#0b5d1e), so the
// colour never costs a move.
//
// Outpost: build shape copies ("outposts") right where our units already are,
// then keep them alive while the board around them changes.
//
//   - Local first: the tightest clusters of our units each claim a nearby spot
//     that is clear of other teams (crowded spots get blocked or stolen).
//   - Real routing: every unit follows a shortest path around other units, and
//     teammates pass the baton when one of ours sits in the way.
//   - Repair every turn: a copy whose spot gets occupied shifts to a nearby
//     free spot; units that lost their job fill open slots or plan new copies.
//   - No idle leftovers: ownership doesn't matter for matching, so a foreign
//     unit that has parked can fill one of our cells ("anchor"). Leftover units
//     build copies around anchors, existing copies shift onto one to free a
//     teammate, and every few turns the whole team replans if that finds more
//     jobs. An anchor inside another team's copy is fair game when the matcher
//     would give it to us (it scans top-left first).
//   - Every candidate spot is checked with the real matcher, so a copy is
//     never placed where a neighbour would make it match wrongly.
const Player = require('../../../game/Player');

const TURNS_PER_ROUND = 64; // server default; the Player API doesn't tell us
const STILL = 3;            // a foreign unit parked this many turns counts as an anchor
const REACH = 16;           // how far we look for foreign units to build around
const DIRS = Object.entries(Player.DELTAS);
const EMPTY = 0, OWN = 1, FOREIGN = 2;

class Outpost extends Player {
    round(width, height, targetShape) {
        super.round(width, height, targetShape);
        this.turnIndex = 0;
        this.sites = [];                    // { cells: [idx], members: Map(idx -> handle), anchors: Set(idx) }
        this.still = new Int16Array(width * height);
        this.grid = null;
        this.stuck = new Map();             // handle -> turns spent unable to move toward its job
    }

    async turn(state) {
        const W = this.width, H = this.height, turnsLeft = TURNS_PER_ROUND - this.turnIndex++;
        const grid = new Int8Array(W * H);
        for (const u of state.units) grid[u.y * W + u.x] = FOREIGN;
        const units = new Map(), ownAt = new Map();
        for (const u of state.ownUnits) { const i = u.y * W + u.x; grid[i] = OWN; units.set(u.handle, i); ownAt.set(i, u.handle); }
        for (let i = 0; i < grid.length; i++) this.still[i] = grid[i] === FOREIGN && this.grid?.[i] === FOREIGN ? this.still[i] + 1 : 0;
        this.grid = grid;
        Object.assign(this, { units, ownAt, turnsLeft });

        this.#maintainSites();
        this.#fillOpenSlots(this.#free());
        this.#planSites(this.#free());
        if (this.#free().length) this.#convert(this.#free().length);
        this.#planSites(this.#free());
        // Once we can tell which foreign units have parked, see whether a fresh plan
        // that builds around them would give our leftovers a job too.
        if (this.#free().length && this.turnIndex % STILL === 1 && turnsLeft > 32) this.#replan();
        return this.#move(this.#free());
    }

    #free() { return [...this.units.keys()].filter(h => !this.#siteOf(h)); }

    #replan() {
        const before = this.sites, busy = () => this.units.size - this.#free().length;
        const kept = busy();
        this.sites = [];
        this.#planSites([...this.units.keys()]);
        if (busy() <= kept) this.sites = before;
    }

    // ---------- plan ----------

    // A parked foreign unit. It may belong to someone's finished copy: the matcher
    // check in #evaluate decides whether our copy would still win it.
    anchor(i) { return this.grid[i] === FOREIGN && this.still[i] >= STILL; }

    #siteOf(handle) { return this.sites.find(site => [...site.members.values()].includes(handle)); }

    #maintainSites() {
        for (const site of [...this.sites]) {
            for (const [cell, handle] of site.members) if (!this.units.has(handle)) site.members.delete(cell);
            for (const cell of site.anchors) if (this.grid[cell] !== FOREIGN) site.anchors.delete(cell);
            // A foreign unit parked on one of our cells: move the copy to a clean spot nearby,
            // or failing that, accept the visitor as part of the copy and free our unit.
            const parked = site.cells.filter(c => !site.anchors.has(c) && this.anchor(c));
            if (parked.length && !this.#relocate(site)) for (const c of parked) { site.anchors.add(c); site.members.delete(c); }
            // Give up on members that can no longer arrive in time.
            for (const [cell, handle] of site.members) if (dist(this.units.get(handle), cell, this.width) > this.turnsLeft) site.members.delete(cell);
            if (!site.members.size) this.sites.splice(this.sites.indexOf(site), 1);
        }
    }

    // Move a blocked copy to the closest valid spot, keeping its members.
    #relocate(site) {
        const others = this.sites.filter(s => s !== site);
        const members = [...site.members.values()];
        const [ox, oy] = xy(site.cells[0] , this.width).map((v, n) => v - this.targetShape.cells[0][n]);
        let best = null;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            const option = this.#evaluate(ox + dx, oy + dy, members, others);
            if (option && option.anchors.size === 0 && (!best || option.cost < best.cost)) best = option;
        }
        if (best) this.sites[this.sites.indexOf(site)] = best.site;
        return Boolean(best);
    }

    // Open slots in existing copies go to the nearest free unit that can make it.
    #fillOpenSlots(free) {
        for (const site of this.sites) for (const cell of site.cells) {
            if (site.members.has(cell) || site.anchors.has(cell) || !free.length) continue;
            const reach = free.map(h => ({ h, d: dist(this.units.get(h), cell, this.width) })).filter(o => o.d < this.turnsLeft);
            if (!reach.length) continue;
            const { h } = reach.reduce((a, b) => (b.d < a.d ? b : a));
            site.members.set(cell, h);
            free.splice(free.indexOf(h), 1);
        }
    }

    // New copies for free units: anchored spots that soak up leftovers, then local groups.
    #planSites(free) {
        const k = this.targetShape.cells.length;
        if (!free.length) return;
        if (free.length % k) {
            // Anchored copies need fewer of our units. Take the cheapest few, as many
            // as maximise how many of our units end up in some copy.
            const matched = (taken, left) => taken + k * Math.floor(left / k);
            const options = this.#anchoredOptions(free).sort((a, b) => a.cost - b.cost);
            const chosen = [], used = new Set();
            let best = { count: 0, score: matched(0, free.length) }, taken = 0;
            for (const option of options) {
                if (chosen.length >= k || option.need > free.length - taken) continue;
                if (chosen.some(site => this.#touchesSites(option.site.cells, [site]))) continue;
                option.site.members.clear();
                const members = this.#assign(free.filter(h => !used.has(h)), option.site);
                if (!members || this.#spread(option.site) > option.spread + 4) { option.site.members.clear(); continue; }
                members.forEach(h => used.add(h));
                chosen.push(option.site);
                taken += option.need;
                const score = matched(taken, free.length - taken);
                if (score > best.score) best = { count: chosen.length, score };
            }
            const keep = chosen.slice(0, best.count);
            this.sites.push(...keep);
            const busy = new Set(keep.flatMap(site => [...site.members.values()]));
            free = free.filter(h => !busy.has(h));
        }
        // Pure copies: repeatedly take the tightest local cluster of k free units.
        while (free.length >= k) {
            let best = null;
            for (const seed of free) {
                const group = [...free].sort((a, b) => this.#gap(seed, a) - this.#gap(seed, b)).slice(0, k);
                const spread = this.#gap(seed, group[k - 1]);
                if (!best || spread < best.spread) best = { group, spread };
            }
            const placed = this.#place(best.group);
            if (!placed) { free = free.filter(h => h !== best.group[0]); continue; }
            this.sites.push(placed.site);
            free = free.filter(h => !best.group.includes(h));
        }
    }

    // When leftovers remain, shift existing copies onto anchors to free teammates,
    // but only if that frees enough units to finish one more copy.
    #convert(leftover) {
        const k = this.targetShape.cells.length;
        if (this.turnsLeft < 24 || leftover >= k) return;
        const shifts = [];
        for (const site of this.sites) {
            const members = [...site.members.values()];
            const [ox, oy] = xy(site.cells[0], this.width).map((v, n) => v - this.targetShape.cells[0][n]);
            const others = this.sites.filter(s => s !== site);
            let best = null;
            for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
                const option = this.#evaluate(ox + dx, oy + dy, members, others, true);
                if (option && option.anchors.size > site.anchors.size && (!best || option.cost < best.cost)) best = option;
            }
            if (best) shifts.push({ site, best, frees: best.anchors.size - site.anchors.size });
        }
        shifts.sort((a, b) => a.best.cost - b.best.cost);
        let freed = 0; const chosen = [];
        for (const shift of shifts) {
            if (leftover + freed >= k) break;
            if (chosen.some(c => c.best.site.cells.some(cell => shift.best.site.cells.includes(cell)))) continue;
            chosen.push(shift); freed += shift.frees;
        }
        if (leftover + freed < k) return;
        for (const { site, best } of chosen) this.sites[this.sites.indexOf(site)] = best.site;
    }

    #anchoredOptions(free) {
        const { width: W, height: H } = this, shape = this.targetShape, out = [];
        for (let oy = 0; oy + shape.height <= H; oy++) for (let ox = 0; ox + shape.width <= W; ox++) {
            let anchors = 0, ok = true;
            for (const [dx, dy] of shape.cells) {
                const i = (oy + dy) * W + ox + dx;
                if (this.anchor(i)) anchors++;
                else if (this.grid[i] === FOREIGN) { ok = false; break; }
            }
            if (!ok || !anchors) continue;
            const origin = oy * W + ox;
            if (!free.some(h => dist(this.units.get(h), origin, W) <= REACH)) continue;
            const option = this.#evaluate(ox, oy, free, this.sites, true);
            if (option && option.anchors.size === anchors) out.push({ ...option, need: shape.cells.length - anchors });
        }
        return out;
    }

    // Choose the best spot near a group, judged by arrival time, distance and crowding.
    #place(group) {
        const [cx, cy] = [0, 1].map(n => Math.round(group.reduce((s, h) => s + xy(this.units.get(h), this.width)[n], 0) / group.length));
        let best = null;
        for (const radius of [4, 9]) {
            for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
                const option = this.#evaluate(cx + dx - (this.targetShape.width >> 1), cy + dy - (this.targetShape.height >> 1), group, this.sites);
                if (option && option.anchors.size === 0 && (!best || option.cost < best.cost)) best = option;
            }
            if (best) break;
        }
        return best;
    }

    // A candidate copy at origin (ox, oy) staffed from `handles`, or null if unusable.
    #evaluate(ox, oy, handles, others, allowAnchors = false) {
        const { width: W, height: H } = this, shape = this.targetShape;
        if (ox < 0 || oy < 0 || ox + shape.width > W || oy + shape.height > H) return null;
        const cells = shape.cells.map(([dx, dy]) => (oy + dy) * W + ox + dx);
        const anchors = new Set();
        for (const c of cells) {
            if (this.grid[c] !== FOREIGN) continue;
            if (!allowAnchors || !this.anchor(c)) return null;
            anchors.add(c);
        }
        if (this.#touchesSites(cells, others)) return null;
        const site = { cells, members: new Map(), anchors };
        const members = this.#assign(handles, site);
        if (!members) return null;
        // The real matcher must match every cell once the copy is complete.
        const trial = this.grid.slice();
        for (const [, h] of site.members) trial[this.units.get(h)] = EMPTY;
        for (const c of cells) trial[c] = OWN;
        const matched = new Set(matches(trial, W, H, shape, ox - shape.width, oy - shape.height, ox + shape.width + 1, oy + shape.height + 1).flat());
        if (!cells.every(c => matched.has(c))) return null;
        let total = 0, crowd = 0;
        const spread = this.#spread(site);
        for (const [c, h] of site.members) total += dist(this.units.get(h), c, W);
        if (spread > this.turnsLeft - 2) return null;
        for (const c of cells) {
            const [x, y] = xy(c, W);
            for (let ny = y - 2; ny <= y + 2; ny++) for (let nx = x - 2; nx <= x + 2; nx++) {
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                const n = ny * W + nx;
                if (this.grid[n] === FOREIGN && !cells.includes(n)) crowd++;
            }
        }
        return { site, anchors, spread, cost: spread + total / cells.length + crowd * 2 };
    }

    // Turns until the last member can arrive.
    #spread(site) {
        let spread = 0;
        for (const [c, h] of site.members) spread = Math.max(spread, dist(this.units.get(h), c, this.width));
        return spread;
    }

    // Greedy nearest pairing of units to the cells a site still needs.
    #assign(handles, site) {
        const needed = site.cells.filter(c => !site.anchors.has(c));
        if (handles.length < needed.length) return null;
        const pairs = [];
        for (const h of handles) for (const c of needed) pairs.push([dist(this.units.get(h), c, this.width), h, c]);
        pairs.sort((a, b) => a[0] - b[0]);
        const used = new Set();
        for (const [, h, c] of pairs) {
            if (used.has(h) || site.members.has(c)) continue;
            site.members.set(c, h); used.add(h);
        }
        return [...used];
    }

    // Copies keep a one-cell gap so they can never merge into each other.
    #touchesSites(cells, sites = this.sites) {
        const W = this.width;
        return sites.some(site => site.cells.some(a => cells.some(b => {
            const [ax, ay] = xy(a, W), [bx, by] = xy(b, W);
            return Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1;
        })));
    }

    #gap(a, b) { return dist(this.units.get(a), this.units.get(b), this.width); }

    // ---------- move ----------

    #move(idle) {
        const W = this.width, H = this.height, grid = this.grid;
        const target = new Map();                // handle -> cell
        for (const site of this.sites) for (const [cell, h] of site.members) target.set(h, cell);
        const siteCells = new Set(this.sites.flatMap(site => site.cells));
        // Idle units step off and away from our copies so they can't confuse the matcher.
        for (const h of idle) {
            const at = this.units.get(h);
            if (!nearAny(at, siteCells, W)) continue;
            const spot = nearestWhere(at, W, H, i => grid[i] === EMPTY && !nearAny(i, siteCells, W));
            if (spot !== null) target.set(h, spot);
        }

        const fields = new Map();
        const field = cell => fields.get(cell) ?? fields.set(cell, distanceField(cell, grid, W, H)).get(cell);
        const next = new Map();                  // handle -> cell it moves into this turn
        const claimed = new Set();
        const swapped = new Set();
        let pending = [...target].filter(([h, cell]) => this.units.get(h) !== cell).map(([h]) => h);
        for (let pass = 0; pass < 4 && pending.length; pass++) {
            const waiting = [];
            for (const h of pending) {
                const at = this.units.get(h), f = field(target.get(h));
                const steps = neighbours(at, W, H).filter(i => f[i] < f[at]).sort((a, b) => f[a] - f[b]);
                let decided = false;
                for (const i of steps) {
                    if (claimed.has(i) || grid[i] === FOREIGN) continue;
                    if (grid[i] === OWN) {
                        const other = this.ownAt.get(i);
                        if (next.has(other) && next.get(other) !== at) { claim(h, i); decided = true; break; }
                        if (target.get(other) === i && !swapped.has(other) && !swapped.has(h)) {
                            // Pass the baton: the teammate in our way goes deeper, we take its cell.
                            const mine = target.get(h);
                            this.#swapJobs(h, other, mine, i);
                            target.set(h, i); target.set(other, mine);
                            swapped.add(h).add(other);
                            waiting.push(other);
                            break;
                        }
                        continue;
                    }
                    claim(h, i); decided = true; break;
                }
                if (!decided) waiting.push(h);
            }
            pending = waiting.filter(h => !next.has(h) && this.units.get(h) !== target.get(h));
        }
        // Units stuck for a while sidestep at random so jams dissolve.
        for (const h of pending) {
            const at = this.units.get(h), stuck = this.stuck.get(h) ?? 0;
            if (stuck < 3 || Math.random() < 0.5) continue;
            const open = neighbours(at, W, H).filter(i => grid[i] === EMPTY && !claimed.has(i));
            if (open.length) claim(h, open[Math.floor(Math.random() * open.length)]);
        }
        for (const h of this.units.keys()) this.stuck.set(h, next.has(h) || !target.has(h) || this.units.get(h) === target.get(h) ? 0 : (this.stuck.get(h) ?? 0) + 1);
        function claim(h, i) { next.set(h, i); claimed.add(i); }

        const commands = [];
        for (const [h, i] of next) {
            const at = this.units.get(h);
            const [dir] = DIRS.find(([, [dx, dy]]) => at + dy * W + dx === i && Math.abs((at % W) - (i % W)) <= 1);
            commands.push(Player.commands.move(h, dir));
        }
        return commands;
    }

    #swapJobs(a, b, cellA, cellB) {
        const siteA = this.sites.find(s => s.members.get(cellA) === a), siteB = this.sites.find(s => s.members.get(cellB) === b);
        siteA?.members.set(cellA, b); siteB?.members.set(cellB, a);
    }
}

// ---------- grid helpers (cells are indices y * width + x) ----------

const xy = (i, W) => [i % W, Math.floor(i / W)];
const dist = (a, b, W) => Math.abs((a % W) - (b % W)) + Math.abs(Math.floor(a / W) - Math.floor(b / W));

function neighbours(i, W, H) {
    const [x, y] = xy(i, W), out = [];
    if (x > 0) out.push(i - 1);
    if (x < W - 1) out.push(i + 1);
    if (y > 0) out.push(i - W);
    if (y < H - 1) out.push(i + W);
    return out;
}

function nearAny(i, cells, W) {
    const [x, y] = xy(i, W);
    for (const c of cells) { const [cx, cy] = xy(c, W); if (Math.abs(cx - x) <= 1 && Math.abs(cy - y) <= 1) return true; }
    return false;
}

// Breadth-first search outward from `start` for the closest cell satisfying `ok`.
function nearestWhere(start, W, H, ok) {
    const seen = new Uint8Array(W * H), queue = [start];
    seen[start] = 1;
    for (let q = 0; q < queue.length && q < 400; q++) {
        const i = queue[q];
        if (i !== start && ok(i)) return i;
        for (const n of neighbours(i, W, H)) if (!seen[n]) { seen[n] = 1; queue.push(n); }
    }
    return null;
}

// Steps from every cell to `goal`, walking around other teams' units.
function distanceField(goal, grid, W, H) {
    const f = new Int32Array(W * H).fill(1e9), queue = [goal];
    f[goal] = 0;
    for (let q = 0; q < queue.length; q++) {
        const i = queue[q];
        for (const n of neighbours(i, W, H)) {
            if (f[n] <= f[i] + 1) continue;
            f[n] = f[i] + 1;
            if (grid[n] !== FOREIGN) queue.push(n);
        }
    }
    return f;
}

// The game's matcher over a window: scan origins top-to-bottom, left-to-right,
// never reusing a unit. Returns the matched copies as arrays of cells.
function matches(grid, W, H, shape, x0, y0, x1, y1) {
    const claimed = new Set(), found = [];
    for (let oy = Math.max(0, y0); oy <= Math.min(H - shape.height, y1); oy++) {
        for (let ox = Math.max(0, x0); ox <= Math.min(W - shape.width, x1); ox++) {
            const cells = shape.cells.map(([dx, dy]) => (oy + dy) * W + ox + dx);
            if (cells.every(c => grid[c] && !claimed.has(c))) { cells.forEach(c => claimed.add(c)); found.push(cells); }
        }
    }
    return found;
}

const GREEN = '#0b5d1e';

class Evolve extends Outpost {
    async turn(state) {
        const commands = await super.turn(state);
        const acting = new Set(commands.map(command => command.handle));
        for (const unit of state.ownUnits) {
            if (!acting.has(unit.handle) && unit.blush !== GREEN) commands.push(Player.commands.blush(unit.handle, GREEN));
        }
        return commands;
    }
}

module.exports = Evolve;
