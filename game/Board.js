class Board {
    width = 0;
    height = 0;
    units = null;

    #deltas;
    #grid = null;
    #log = [];
    #targets = null;
    #startKeys = null;
    #moving = null;
    #startOccupants = null;
    #claims = null;
    constructor(unitIds, width, height, deltas, random = Math.random) {
        this.#deltas = deltas;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
            throw new Error('Grid width and height must be positive integers.');
        }
        if (!Array.isArray(unitIds)) {
            throw new Error('Player IDs must be an array.');
        }
        for (const id of unitIds) {
            if (typeof id !== 'string') throw new Error('Player IDs must be strings.');
        }
        if (new Set(unitIds).size !== unitIds.length) {
            throw new Error('Player IDs must be unique.');
        }
        const cellCount = width * height;
        const maxUnitCount = Math.round(0.25 * cellCount);
        if (unitIds.length > maxUnitCount) {
            throw new Error(`Too many units: ${ unitIds.length } for a ${ width }x${ height } grid. Maximum permitted is: ${ maxUnitCount }`);
        }
        const units = new Array(unitIds.length);
        const availablePositions = new Uint32Array(cellCount);
        for (let i = 0; i < cellCount; i++) {
            availablePositions[i] = i;
        }
        for (let i = 0; i < unitIds.length; i++) {
            const randomIndex = i + Math.floor(random() * (cellCount - i));
            const pos = availablePositions[randomIndex];
            availablePositions[randomIndex] = availablePositions[i];
            units[i] = {
                id: unitIds[i],
                x: pos % width,
                y: (pos / width) | 0,
                command: null
            };
        }

        this.width = width;
        this.height = height;
        this.units = units;
        this.#grid = new Array(cellCount);
        this.#targets = new Array(units.length);
        this.#startKeys = new Array(units.length);
        this.#moving = new Array(units.length);
        this.#startOccupants = new Array(cellCount);
        this.#claims = new Array(cellCount);
        this.#log.push(this.#createFrame());
    }
    get log() {
        return this.#log;
    }
    #snapshotUnits() {
        return Object.freeze(this.units.map(unit => Object.freeze({
            id: unit.id, x: unit.x, y: unit.y
        })));
    }
    #createFrame() {
        return {
            units: this.#snapshotUnits(),
            commands: {}
        };
    }
    positionUnit(id, x, y) {
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.width || y >= this.height) {
            throw new Error(`Target position (${ x }, ${ y }) is out of bounds.`);
        }
        const unit = this.units.find(p => p.id === id);
        if (!unit) {
            throw new Error(`Player with ID "${ id }" not found.`);
        }
        const isOccupied = this.units.some(p => p.id !== id && p.x === x && p.y === y);
        if (isOccupied) {
            throw new Error(`Position (${ x }, ${ y }) is already occupied by another unit.`);
        }
        unit.x = x;
        unit.y = y;
    }
    turn() {
        const turnLog = this.#log.at(-1);
        const boardUnchanged = turnLog.units.length === this.units.length && this.units.every((unit, index) => {
            const recorded = turnLog.units[index];
            return unit.id === recorded.id && unit.x === recorded.x && unit.y === recorded.y;
        });
        const startingUnits = boardUnchanged ? turnLog.units : this.#snapshotUnits();
        const commands = Object.fromEntries(this.units.filter(unit => unit.command != null).map(unit => [unit.id, unit.command]));
        const cellCount = this.width * this.height;
        const targets = this.#targets;
        const startKeys = this.#startKeys;
        const moving = this.#moving;
        const startOccupants = this.#startOccupants;
        const claims = this.#claims;
        // Live units and dimensions are public; keep scratch storage in sync.
        targets.length = startKeys.length = moving.length = this.units.length;
        startOccupants.length = claims.length = cellCount;
        moving.fill(true);
        startOccupants.fill(-1);
        for (let i = 0; i < this.units.length; i++) {
            const unit = this.units[i];
            const startKey = unit.y * this.width + unit.x;
            startKeys[i] = startKey;
            startOccupants[startKey] = i;
            const delta = Object.hasOwn(this.#deltas, unit.command) ? this.#deltas[unit.command] : null;
            if (!delta) {
                targets[i] = startKey;
                moving[i] = false;
                continue;
            }
            const tx = unit.x + delta[0];
            const ty = unit.y + delta[1];
            if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) {
                targets[i] = startKey;
                moving[i] = false;
                continue;
            }
            targets[i] = ty * this.width + tx;
        }
        let changed = true;
        while (changed) {
            changed = false;
            claims.fill(-1);
            for (let i = 0; i < this.units.length; i++) {
                const tk = targets[i];
                if (claims[tk] === -1) {
                    claims[tk] = i;
                } else {
                    claims[tk] = -2;
                }
            }
            for (let i = 0; i < this.units.length; i++) {
                if (!moving[i]) {
                    continue;
                }
                const tk = targets[i];
                const occupier = startOccupants[tk];
                const swapsPositions = occupier >= 0 && targets[occupier] === startKeys[i];
                if (claims[tk] === -2 || swapsPositions) {
                    moving[i] = false;
                    targets[i] = startKeys[i];
                    changed = true;
                }
            }
        }
        for (let i = 0; i < this.units.length; i++) {
            this.units[i].x = targets[i] % this.width;
            this.units[i].y = (targets[i] / this.width) | 0;
            this.units[i].command = null;
        }
        turnLog.units = startingUnits;
        turnLog.commands = commands;
        this.#log.push(this.#createFrame());
    }
    match(shape) {
        this.#grid.fill(null);
        for (const unit of this.units) {
            this.#grid[unit.y * this.width + unit.x] = unit;
        }
        const claimedIds = new Set();
        const matches = [];
        for (let y = 0; y <= this.height - shape.height; y++) {
            for (let x = 0; x <= this.width - shape.width; x++) {
                const firstCell = shape.cells[0];
                const firstUnit = this.#grid[ (y + firstCell[1]) * this.width + (x + firstCell[0]) ];
                if (!firstUnit || claimedIds.has(firstUnit.id)) {
                    continue;
                }
                let isMatch = true;
                const members = [ firstUnit ];
                for (let i = 1; i < shape.cells.length; i++) {
                    const [ dx, dy ] = shape.cells[i];
                    const p = this.#grid[ (y + dy) * this.width + (x + dx) ];
                    if (!p || claimedIds.has(p.id)) {
                        isMatch = false;
                        break;
                    }
                    members.push(p);
                }
                if (isMatch) {
                    for (const unit of members) {
                        claimedIds.add(unit.id);
                    }
                    matches.push(members.map(p => p.id));
                }
            }
        }
        return matches;
    }
}
Board.SHAPES = [
    { name: 'I3', cells: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ] ] },
    { name: 'V3', cells: [ [ 0, 0 ], [ 0, 1 ], [ 1, 1 ] ] },
    { name: 'O4', cells: [ [ 0, 0 ], [ 1, 0 ], [ 0, 1 ], [ 1, 1 ] ] },
    { name: 'T4', cells: [ [ 0, 0 ], [ 1, 0 ], [ 2, 0 ], [ 1, 1 ] ] },
    { name: 'S4', cells: [ [ 1, 0 ], [ 2, 0 ], [ 0, 1 ], [ 1, 1 ] ] },
    { name: 'L4', cells: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 1, 2 ] ] },
    { name: 'Z4', cells: [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 2, 1 ] ] },
    { name: 'J4', cells: [ [ 1, 0 ], [ 1, 1 ], [ 1, 2 ], [ 0, 2 ] ] },
    { name: 'I3-horizontal', cells: [ [ 0, 0 ], [ 1, 0 ], [ 2, 0 ] ] },
    { name: 'T4-inverted', cells: [ [ 1, 0 ], [ 0, 1 ], [ 1, 1 ], [ 2, 1 ] ] },
    { name: 'P5', cells: [ [ 0, 0 ], [ 1, 0 ], [ 0, 1 ], [ 1, 1 ], [ 0, 2 ] ] },
    { name: 'U5', cells: [ [ 0, 0 ], [ 2, 0 ], [ 0, 1 ], [ 1, 1 ], [ 2, 1 ] ] },
    { name: 'X5', cells: [ [ 1, 0 ], [ 0, 1 ], [ 1, 1 ], [ 2, 1 ], [ 1, 2 ] ] },
    { name: 'Rectangle6', cells: [ [ 0, 0 ], [ 1, 0 ], [ 2, 0 ], [ 0, 1 ], [ 1, 1 ], [ 2, 1 ] ] },
    { name: 'L6', cells: [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ 0, 3 ], [ 1, 3 ], [ 2, 3 ] ] },
    { name: 'T6', cells: [ [ 0, 0 ], [ 1, 0 ], [ 2, 0 ], [ 1, 1 ], [ 1, 2 ], [ 1, 3 ] ] },
    { name: 'Stair6', cells: [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 2, 1 ], [ 2, 2 ], [ 3, 2 ] ] },
].map(shape => {
    let maxX = 0, maxY = 0;
    for (const [ x, y ] of shape.cells) {
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    return { ...shape, width: maxX + 1, height: maxY + 1 };
});

if (typeof module === 'object' && module.exports) module.exports = Board;
