const Game = ((Board, Player) => class Game {
    static SHAPES = Board.SHAPES;
    static DEFAULTS = Object.freeze({ width: 64, height: 64,
        startingEnergy: 2, winEnergy: 0, lossEnergy: -1 });

    static configuration(options = {}) {
        const config = { ...Game.DEFAULTS, shapes: Game.SHAPES, ...options };
        for (const key of ['width', 'height']) {
            if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`${key} must be a positive whole number.`);
        }
        if (!Number.isSafeInteger(config.startingEnergy) || config.startingEnergy < 1 || config.startingEnergy > 3) throw new Error('Starting energy must be 1–3.');
        if (!Number.isSafeInteger(config.winEnergy) || config.winEnergy < 0) throw new Error('Winning energy adjustment must be a non-negative whole number.');
        if (!Number.isSafeInteger(config.lossEnergy) || config.lossEnergy > 0) throw new Error('Losing energy adjustment must be a non-positive whole number.');
        if (!Number.isSafeInteger(config.width * config.height)) {
            throw new Error('Game dimensions exceed supported integer limits.');
        }
        if (!Array.isArray(config.shapes) || !config.shapes.length) throw new Error('At least one target shape must be provided.');
        config.shapes = Object.freeze(config.shapes.map(shape => {
            if (!shape || !Array.isArray(shape.cells) || !shape.cells.length || shape.cells.some(cell =>
                !Array.isArray(cell) || cell.length !== 2 || cell.some(value => !Number.isSafeInteger(value) || value < 0)) ||
                new Set(shape.cells.map(cell => cell.join(','))).size !== shape.cells.length) throw new Error('Invalid target shape.');
            return Object.freeze({ name: shape.name || 'Target',
                width: Math.max(...shape.cells.map(cell => cell[0])) + 1,
                height: Math.max(...shape.cells.map(cell => cell[1])) + 1,
                cells: Object.freeze(shape.cells.map(cell => Object.freeze([...cell]))) });
        }));
        return Object.freeze(config);
    }

    #board;
    #startingEnergy;
    #round;
    #messages = Object.freeze([]);
    #random;
    #roster;
    #results = new Map();
    #observation = Object.freeze({ units: Object.freeze([]), messages: Object.freeze([]) });
    #view;

    get view() { return this.#view; }
    get observation() { return this.#observation; }

    get players() { return [...new Map(this.#roster.map(unit => [unit.playerId,
        { playerId: unit.playerId, name: unit.playerName }])).values()]; }

    observe(playerId) {
        const positions = new Map(this.state.units.map(unit => [unit.id, unit]));
        const ownUnits = this.units.filter(unit => unit.playerId === playerId && positions.has(unit.unitId))
            .map(unit => { const { x, y } = positions.get(unit.unitId);
                return Object.freeze({ handle: unit.handle, x, y, energy: unit.energy, blush: unit.blush }); });
        return Object.freeze({ ...this.#observation, ownUnits: Object.freeze(ownUnits) });
    }

    unitIdFor(playerId, handle) {
        return this.units.find(unit => unit.playerId === playerId && unit.handle === handle)?.unitId;
    }

    outcomesFor(playerId, outcomes) {
        const owned = new Map(this.#roster.filter(unit => unit.playerId === playerId).map(unit => [unit.unitId, unit.handle]));
        return Object.freeze(outcomes.filter(outcome => owned.has(outcome.unitId))
            .map(({ unitId, won, energyBefore, energyAfter, eliminated }) => Object.freeze({
                handle: owned.get(unitId), won, energyBefore, energyAfter, eliminated })));
    }

    resultFor(playerId) { return this.#results.get(playerId) ?? null; }

    static shuffle(items) {
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }
        return Object.freeze(items);
    }
    constructor(units, config = {}, random = Math.random) {
        this.config = Game.configuration(config);
        if (!Array.isArray(units) || units.some(unit => typeof unit.unitId !== 'string' || !unit.unitId
            || !Number.isSafeInteger(unit.energy) || unit.energy < 1 || unit.energy > 3)) throw new Error('Game requires participant records with an ID and starting energy.');
        if (new Set(units.map(unit => unit.unitId)).size !== units.length) throw new Error('Unit IDs must be unique.');
        if (units.length > Math.round(0.25 * this.config.width * this.config.height)) throw new Error('Roster exceeds grid capacity.');
        this.units = units.map(({ unitId, energy, playerId = unitId, handle = unitId, playerName = playerId, competitive = true }) => ({ unitId, energy, playerId, handle, playerName, competitive, blush: null }));
        const handles = new Set(), names = new Map(), competitive = new Map();
        for (const unit of this.units) {
            if ([unit.playerId, unit.handle, unit.playerName].some(value => typeof value !== 'string' || !value)) throw new Error('Player identity, name and handle must be nonempty strings.');
            const key = JSON.stringify([unit.playerId, unit.handle]);
            if (handles.has(key)) throw new Error('Handles must be unique within each player.');
            if (names.has(unit.playerId) && names.get(unit.playerId) !== unit.playerName) throw new Error('A player must have one name.');
            if (typeof unit.competitive !== 'boolean' || (competitive.has(unit.playerId) && competitive.get(unit.playerId) !== unit.competitive)) throw new Error('A player must have one competitive status.');
            handles.add(key); names.set(unit.playerId, unit.playerName); competitive.set(unit.playerId, unit.competitive);
        }
        this.#roster = [...this.units];
        this.#random = random;
        this.#view = { width: this.config.width, height: this.config.height, config: this.config, rounds: [], turns: [], diagnostics: [], endReason: null, results: [] };
        this.log = { width: this.config.width, height: this.config.height, config: this.config,
            roster: units.map(unit => ({ id: unit.unitId, energy: unit.energy })), rounds: [], turns: [], diagnostics: [], endReason: null };
    }

    recordDiagnostic({ unitId = null, roundIndex = null, turnIndex = null, phase = 'setup',
        level = 'error', code, message }) {
        if (!['error', 'warning', 'info'].includes(level) || typeof code !== 'string' || !code
            || typeof message !== 'string' || !message) throw new TypeError('Invalid diagnostic.');
        this.log.diagnostics.push(Object.freeze({ unitId, roundIndex, turnIndex, phase, level, code, message }));
    }

    static validCommand(commandName, params) {
        if (!Array.isArray(params) || params.length !== 1) return false;
        const value = params[0];
        if (commandName === 'blush') return typeof value === 'string' && value.length === 7 && /^#[0-9a-fA-F]{6}$/.test(value);
        if (commandName === 'move') return Object.values(Player.DIRECTIONS).includes(value);
        return commandName === 'say' && typeof value === 'string' && value.isWellFormed() && [...value].length <= Player.MAX_SPEECH_LENGTH;
    }

    get state() {
        return Object.freeze({ units: this.#board?.log.at(-1).units ?? Object.freeze([]), messages: this.#messages });
    }

    get viableShapes() {
        return this.config.shapes.filter(shape => shape.cells.length <= this.units.length &&
            shape.width <= this.config.width && shape.height <= this.config.height);
    }

    round(targetShape) {
        if (this.log.endReason) throw new Error('The game has ended.');
        if (this.#round && !this.#round.completed) throw new Error('Match the current round before starting another.');
        if (!this.viableShapes.includes(targetShape)) throw new Error('Choose a configured, viable target shape.');
        for (const unit of this.units) unit.blush = null;
        this.#board = new Board(this.units.map(unit => unit.unitId), this.config.width, this.config.height, Player.DELTAS, this.#random);
        this.#round = { index: this.log.rounds.length, targetShape, startTurn: this.log.turns.length,
            endTurn: null, completed: false, outcomes: [] };
        this.log.rounds.push(this.#round);
        this.#view.rounds.push({ index: this.#round.index, targetShape, startTurn: this.#round.startTurn, endTurn: null, completed: false, eliminatedCount: 0 });
        // Round placement invalidates old speech and self-reported coordinates.
        this.#messages = Object.freeze([]);
        this.#startingEnergy = new Map(this.units.map(unit => [unit.unitId, unit.energy]));
        this.#recordFrame(Object.freeze([]));
        return this.state;
    }

    #requireRound() {
        if (this.log.endReason) throw new Error('The game has ended.');
        if (!this.#round || this.#round.completed) throw new Error('Start a round before applying turns or matching.');
    }

    turn(commandsByUnitId = {}) {
        this.#requireRound();
        if (!commandsByUnitId || typeof commandsByUnitId !== 'object' || Array.isArray(commandsByUnitId)) {
            throw new Error('Commands must be an object keyed by unit ID.');
        }
        const ids = new Set(this.units.map(unit => unit.unitId));
        const entries = Object.entries(commandsByUnitId).map(([id, command]) => {
            if (!ids.has(id) || !command || !Game.validCommand(command.commandName, command.params)) {
                throw new Error(`Invalid command for unit: ${id}`);
            }
            return [id, { commandName: command.commandName, params: [...command.params] }];
        });
        // Validate the entire batch before changing board, messages, or history.
        const commands = Object.fromEntries(entries);
        this.#board.units.forEach(position => {
            const command = Object.hasOwn(commands, position.id) ? commands[position.id] : undefined;
            position.command = command?.commandName === 'move' ? command.params[0] : null;
        });
        this.#board.turn();
        this.log.turns.at(-1).commands = commands;
        this.#messages = Object.freeze(this.units.flatMap(unit => {
            const command = Object.hasOwn(commands, unit.unitId) ? commands[unit.unitId] : undefined;
            return command?.commandName === 'say' ? [Object.freeze({ unitId: unit.unitId, text: command.params[0] })] : [];
        }));
        for (const unit of this.units) {
            const command = Object.hasOwn(commands, unit.unitId) ? commands[unit.unitId] : undefined;
            if (command?.commandName === 'blush') unit.blush = command.params[0].toLowerCase();
        }
        this.#recordFrame(this.#messages);
        return this.state;
    }

    match() {
        this.#requireRound();
        const winners = new Set(this.#board.match(this.#round.targetShape).flat());
        this.#round.outcomes = this.units.map(unit => {
            const energyBefore = this.#startingEnergy.get(unit.unitId);
            const won = winners.has(unit.unitId);
            const energyAfter = energyBefore + (won ? this.config.winEnergy : this.config.lossEnergy);
            if (!Number.isSafeInteger(energyAfter)) throw new Error('Player energy exceeds supported integer limits.');
            return Object.freeze({ unitId: unit.unitId, won, energyBefore, energyAfter, eliminated: energyAfter <= 0 });
        });
        this.units.forEach((unit, index) => { unit.energy = this.#round.outcomes[index].energyAfter; });
        this.#round.completed = true;
        const energies = new Map(this.units.map(unit => [unit.unitId, unit.energy]));
        const final = this.log.turns.at(-1);
        this.log.turns[this.log.turns.length - 1] = { ...final,
            units: Object.freeze(final.units.map(unit => Object.freeze({ ...unit, energy: energies.get(unit.id) }))) };
        this.units = this.units.filter(unit => unit.energy > 0);
        Object.assign(this.#view.rounds.at(-1), { completed: true,
            eliminatedCount: this.#round.outcomes.filter(outcome => outcome.eliminated).length });
        return this.#round.outcomes;
    }

    finish(reason, error) {
        if (this.log.endReason) throw new Error('The game has ended.');
        if (!['round-limit', 'no-viable-shape', 'stopped', 'error'].includes(reason)) throw new Error('Unknown game end reason.');
        this.log.endReason = reason;
        this.#view.endReason = reason;
        if (['round-limit', 'no-viable-shape'].includes(reason)) {
            const eligible = new Set(this.#roster.filter(unit => unit.competitive).map(unit => unit.playerId));
            const groups = new Map(this.players.filter(player => eligible.has(player.playerId)).map(({ playerId, name }) => [playerId, { name, totalEnergy: 0, survivorCount: 0 }]));
            for (const unit of this.units) if (groups.has(unit.playerId)) {
                const group = groups.get(unit.playerId);
                group.totalEnergy += unit.energy;
                group.survivorCount++;
            }
            const results = [...groups].sort((a, b) => b[1].totalEnergy - a[1].totalEnergy || b[1].survivorCount - a[1].survivorCount);
            const tied = (a, b) => a.totalEnergy === b.totalEnergy && a.survivorCount === b.survivorCount;
            const uniqueLeader = results.length > 0 && (results.length === 1 || !tied(results[0][1], results[1][1]));
            let rank = 0;
            this.#view.results = results.map(([playerId, result], index) => {
                if (index === 0 || !tied(result, results[index - 1][1])) rank = index + 1;
                const outcome = Object.freeze({ ...result, rank, winner: rank === 1 && uniqueLeader });
                this.#results.set(playerId, outcome);
                return outcome;
            });
        }
        if (error && this.#round && !this.#round.completed) this.#round.error = error.message || String(error);
        return this.log;
    }

    #recordFrame(messages) {
        const energies = this.#startingEnergy;
        const blushes = new Map(this.units.map(unit => [unit.unitId, unit.blush]));
        this.log.turns.push({ roundIndex: this.#round.index, roundTurn: this.#board.log.length - 1,
            targetShape: this.#round.targetShape,
            units: Object.freeze(this.#board.log.at(-1).units.map(unit => Object.freeze({ ...unit, energy: energies.get(unit.id), blush: blushes.get(unit.id) }))),
            commands: {}, matches: this.#board.match(this.#round.targetShape), messages });
        this.#round.endTurn = this.log.turns.length - 1;
        const positions = this.#board.log.at(-1).units;
        const byId = new Map(positions.map(unit => [unit.id, unit]));
        const units = Game.shuffle(positions.map(({ id, x, y }) => Object.freeze({ x, y, blush: blushes.get(id) })));
        const speech = Game.shuffle(messages.map(({ text }) => Object.freeze({ text })));
        this.#observation = Object.freeze({ units, messages: speech });
        const frame = this.log.turns.at(-1);
        this.#view.turns.push(Object.freeze({ roundIndex: frame.roundIndex, roundTurn: frame.roundTurn,
            targetShape: frame.targetShape, units, messages: speech,
            matches: Object.freeze(frame.matches.map(match => Object.freeze(match.map(id => {
                const { x, y } = byId.get(id);
                return Object.freeze({ x, y });
            })))) }));
        this.#view.rounds.at(-1).endTurn = this.#round.endTurn;
    }
})(
    typeof module === 'object' && module.exports ? require('./Board') : Board,
    typeof module === 'object' && module.exports ? require('./Player') : Player
);

if (typeof module === 'object' && module.exports) module.exports = Game;
