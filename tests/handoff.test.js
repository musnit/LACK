const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const Player = require('../game/Player');
const Game = require('../game/Game');
const Dummy = require('../player');

const plain = value => JSON.parse(JSON.stringify(value));
const observation = (count = 1) => ({
    units: Array.from({ length: count }, (_, x) => ({ x, y: 0, blush: null })),
    ownUnits: Array.from({ length: count }, (_, x) => ({ handle: String(x), x, y: 0, energy: 2, blush: null })),
    messages: []
});
const fixture = Type => {
    const sent = [], errors = [], instances = [];
    let socket;
    class Tracked extends Type {
        constructor() { super(); instances.push(this); }
    }
    class Socket {
        static OPEN = 1;
        readyState = 1;
        constructor(endpoint) { this.endpoint = endpoint; socket = this; }
        send(encoded) { sent.push(JSON.parse(encoded)); }
        close() { this.readyState = 3; }
    }
    vm.runInNewContext(readFileSync(join(__dirname, '../client.js'), 'utf8'), {
        require: name => { assert.equal(name, './player'); return Tracked; },
        process: { argv: ['node', 'client.js', 'fixture-token'] },
        WebSocket: Socket, Buffer,
        console: { log() {}, error(message) { errors.push(message); } }
    });
    const event = message => socket.onmessage({ data: JSON.stringify({ version: 1, ...message }) });
    const reply = async result => {
        await event({ type: 'response', requestId: sent.at(-1).requestId, result });
    };
    const joinGame = async gameId => {
        const joining = event({ type: 'player-join', gameId, attemptId: 1,
            config: { width: 64, height: 64 }, count: 2 });
        assert.equal(sent.at(-1).type, 'player-joined');
        assert.deepEqual(sent.at(-1).units, [{ handle: '0' }, { handle: '1' }]);
        await reply({ success: true });
        await joining;
    };
    return { sent, errors, instances, socket, event, reply, joinGame };
};

test('starter imports independently and emits valid commands for owned units', async () => {
    const player = new Dummy();
    assert(player instanceof Player);
    player.round(64, 64, { cells: [[0, 0]], width: 1, height: 1 });
    const state = observation(32);
    for (let turn = 0; turn < 5; turn++) {
        const commands = await player.turn(state, 500);
        assert.equal(new Set(commands.map(command => command.handle)).size, commands.length);
        for (const command of commands) {
            assert(state.ownUnits.some(unit => unit.handle === command.handle));
            assert(Game.validCommand(command.commandName, command.params));
        }
    }
});

test('copied engine preserves private observations, elimination and tied results', () => {
    const game = new Game(Array.from({ length: 4 }, (_, index) => ({
        unitId: `internal-${index}`, playerId: index < 2 ? 'a' : 'b',
        handle: String(index % 2), energy: 1
    })), { width: 4, height: 4, shapes: [{ cells: [[0, 0], [1, 0], [2, 0], [3, 0]] }] }, () => 0);
    game.round(game.viableShapes[0]);
    assert.deepEqual(Object.keys(game.observe('a').units[0]).sort(), ['blush', 'x', 'y']);
    assert.equal(game.observe('a').ownUnits.length, 2);
    game.turn({ 'internal-0': { commandName: 'move', params: ['down'] } });
    const outcomes = game.match();
    assert(outcomes.every(outcome => outcome.eliminated));
    assert.equal(game.outcomesFor('a', outcomes).length, 2);
    game.finish('no-viable-shape');
    assert(game.view.results.every(result => result.rank === 1 && !result.winner && result.totalEnergy === 0));
});

test('transport authenticates and lets later games/turns pass an unresolved decision', async () => {
    let resolveFirst;
    class Strategy extends Player {
        async turn(state) {
            assert(Object.isFrozen(state.ownUnits[0]));
            if (!resolveFirst) return await new Promise(resolve => { resolveFirst = resolve; });
            return [Player.commands.move(state.ownUnits[0].handle, 'right')];
        }
        roundEnd(outcomes) { this.outcomes = outcomes; }
        finish(result) { this.result = result; }
    }
    const f = fixture(Strategy);
    const authenticating = f.event({ type: 'ready' });
    assert.equal(f.socket.endpoint, 'wss://latticeanimals.com/ws');
    assert.equal(f.sent[0].token, 'fixture-token');
    await f.reply({ userName: 'Test' });
    await authenticating;
    await f.joinGame('a');
    await f.joinGame('b');
    const shape = { cells: [[0, 0]], width: 1, height: 1 };
    await f.event({ type: 'player-round', gameId: 'a', targetShape: shape, state: observation() });
    assert.equal(f.instances[0].width, 64);
    await f.event({ type: 'player-turn', gameId: 'a', turnId: 1, remainingMs: 500, state: observation() });
    await f.event({ type: 'player-turn', gameId: 'b', turnId: 7, remainingMs: 500, state: observation() });
    assert.equal(f.sent.at(-1).gameId, 'b');
    await f.reply({ accepted: [true] });
    resolveFirst([Player.commands.say('0', 'late')]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.sent.at(-1).gameId, 'a');
    assert.equal(f.sent.at(-1).turnId, 1); // must not relabel a late decision
    await f.reply({ accepted: [false] });
    await f.event({ type: 'player-round-end', gameId: 'a', outcomes: [{ handle: '0', eliminated: true }] });
    assert.equal(f.instances[0].outcomes[0].eliminated, true);
    await f.event({ type: 'player-finished', gameId: 'a', result: { winner: false } });
    assert.deepEqual(plain(f.instances[0].result), { winner: false });
    await f.event({ type: 'player-resume', game: { gameId: 'b', status: 'playing',
        config: { width: 64, height: 64 }, targetShape: shape, state: observation(), turnId: null } });
    assert.equal(f.instances.length, 3);
    assert.equal(f.instances[2].width, 64);
    f.socket.onclose({ code: 1000 });
    assert.equal(f.instances[2].result, undefined); // disconnect does not finish games
    assert.deepEqual(f.errors, []);
});

test('top-level errors are reported without consuming pending requests or closing the socket', async () => {
    const f = fixture(Player);
    const authenticating = f.event({ type: 'ready' });
    await f.event({ type: 'error', code: 'invalid_message', message: 'Binary messages are not supported.' });
    assert.deepEqual(f.errors, ['invalid_message: Binary messages are not supported.']);
    assert.equal(f.socket.readyState, 1);
    await f.reply({ userName: 'Test' });
    await authenticating;
    assert.equal(f.errors.length, 1);
    assert.equal(f.socket.readyState, 1);
});

test('transport splits Unicode speech within message and command bounds', async () => {
    class Talker extends Player {
        async turn(state) {
            return state.ownUnits.map(unit => Player.commands.say(unit.handle, '👋'.repeat(256)));
        }
    }
    const f = fixture(Talker);
    await f.joinGame('g');
    await f.event({ type: 'player-turn', gameId: 'g', turnId: 1, remainingMs: 500, state: observation(128) });
    const batches = f.sent.filter(message => message.type === 'player-commands');
    assert(batches.length > 1);
    assert.equal(batches.flatMap(message => message.commands).length, 128);
    assert(batches.every(message => message.commands.length <= 128 && Buffer.byteLength(JSON.stringify(message)) < 16384));
    assert.deepEqual(f.errors, []);
});
