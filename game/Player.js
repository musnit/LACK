class Player {
    static MAX_SPEECH_LENGTH = 256;
    static DELTAS = Object.freeze({
        up: Object.freeze([0, -1]),
        down: Object.freeze([0, 1]),
        left: Object.freeze([-1, 0]),
        right: Object.freeze([1, 0])
    });
    static DIRECTIONS = Object.freeze(Object.fromEntries(Object.keys(Player.DELTAS).map(direction => [direction, direction])));
    static commands = Object.freeze({
        move: (handle, direction) => ({ handle, commandName: 'move', params: [direction] }),
        blush: (handle, color) => ({ handle, commandName: 'blush', params: [color] }),
        say: (handle, text) => ({ handle, commandName: 'say', params: [text] })
    });

    static #types = Object.create(null);
    static get types() { return Player.#types; }

    static register(name, Type) {
        if (typeof name !== 'string' || !/^[A-Za-z0-9_]{4,32}$/.test(name)) throw new Error('Player names must use 4–32 letters, numbers, or underscores.');
        if (typeof Type !== 'function' || !(Type.prototype instanceof Player)) throw new Error('Register a class derived from Player.');
        if (Object.keys(Player.#types).some(key => key.toLowerCase() === name.toLowerCase())) throw new Error(`Player name "${name}" is already registered.`);
        Object.defineProperty(Player.#types, name, { value: Type, enumerable: true });
    }

    round(width, height, targetShape) {
        this.width = width;
        this.height = height;
        this.targetShape = targetShape;
    }

    async turn(state, remainingMs) {
        throw new Error('Player subclasses must implement turn(state, remainingMs).');
    }

    // Optional synchronous notifications; hosts call finish once when the game ends.
    roundEnd(outcomes) {}
    finish(result) {}
}

if (typeof module === 'object' && module.exports) module.exports = Player;
