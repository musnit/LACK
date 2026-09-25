const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runGame } = require('../gym/host');
const { PRESETS } = require('../gym/presets');
const Player = require('../game/Player');
const Walker = require('../strategies/walker');
const RandomWalker = require('../strategies/random');

const small = { ...PRESETS.arena, width: 16, height: 16, unitsPerPlayer: 8, maxRounds: 3, turnsPerRound: 20 };

test('gym plays a full game and ranks competitors', async () => {
    const result = await runGame({ config: small, entrants: [
        { name: 'walker', Strategy: Walker }, { name: 'random', Strategy: RandomWalker }] });
    assert.equal(result.rounds, 3);
    assert.equal(result.players.length, 2);
    for (const player of result.players) {
        assert.equal(player.errors, 0);
        assert(Number.isInteger(player.result.rank));
    }
});

test('gym drops late replies, foreign handles and invalid commands', async () => {
    class Cheater extends Player {
        async turn(state) {
            return [Player.commands.move('not-mine', 'up'), { handle: state.ownUnits[0].handle, commandName: 'fly', params: ['up'] }];
        }
    }
    class Sleeper extends Player {
        async turn(state) {
            await new Promise(done => setTimeout(done, 80));
            return state.ownUnits.map(unit => Player.commands.move(unit.handle, 'up'));
        }
    }
    const result = await runGame({ config: { ...small, maxRounds: 1, turnsPerRound: 2, turnTimeMs: 60 }, latencyMs: 0,
        entrants: [{ name: 'cheater', Strategy: Cheater }, { name: 'sleeper', Strategy: Sleeper }] });
    assert(result.players[1].late >= 1);
    assert.equal(result.players[0].errors, 0);
});
