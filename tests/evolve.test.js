const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { Sandbox } = require('../strategies/evolve/core/sandbox');
const speech = require('../strategies/evolve/core/speech');

const PLAYER = JSON.stringify(path.resolve(__dirname, '../game/Player'));

// Write a live strategy whose turn body is `body` into a fresh temp folder.
function liveStrategy(body) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-live-'));
    const entry = path.join(dir, 'strategy.js');
    fs.writeFileSync(entry, `const Player = require(${PLAYER});
module.exports = class extends Player { async turn(state) { ${body} } };`);
    return entry;
}

test('sandboxed live strategy cannot read outside game/ and strategies/', async () => {
    const secret = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-secret-')), 'token');
    fs.writeFileSync(secret, 'hunter2');
    const sandbox = new Sandbox({ entry: liveStrategy(`
        let read; try { read = require('node:fs').readFileSync(${JSON.stringify(secret)}, 'utf8'); } catch (error) { read = error.code; }
        return [Player.commands.say(state.ownUnits[0].handle, read)];`) });
    try {
        const game = sandbox.open();
        const [command] = await game.turn({ ownUnits: [{ handle: '0' }] }, 2000);
        assert.equal(command.params[0], 'ERR_ACCESS_DENIED');
    } finally { sandbox.stop(); }
});

test('a hanging live strategy costs a turn, not the bot', async () => {
    const sandbox = new Sandbox({ entry: liveStrategy('while (true) {}') });
    try {
        const game = sandbox.open();
        const started = Date.now();
        assert.deepEqual(await game.turn({ ownUnits: [] }, 300), []);
        assert(Date.now() - started < 1000);
    } finally { sandbox.stop(); }
});

test('broken live code is skipped and the last good version keeps playing', async () => {
    const entry = liveStrategy(`return [Player.commands.move(state.ownUnits[0].handle, 'up')];`);
    const sandbox = new Sandbox({ entry });
    try {
        assert.equal((await sandbox.open().turn({ ownUnits: [{ handle: '0' }] }, 2000))[0].params[0], 'up');
        fs.writeFileSync(entry, 'this is not javascript(');
        const later = new Date(Date.now() + 5000);
        fs.utimesSync(entry, later, later);
        sandbox.open();                                   // starts loading the broken version
        await new Promise(done => setTimeout(done, 500));
        assert.equal((await sandbox.open().turn({ ownUnits: [{ handle: '0' }] }, 2000))[0].params[0], 'up');
    } finally { sandbox.stop(); }
});

test('speech: suggestions need the trigger, and live commands cannot talk', () => {
    assert.deepEqual(speech.suggestions([{ text: 'hello' }, { text: ' Evolve:  build\u0007 faster ' }, { text: speech.ADVERT }]), ['build faster']);
    const own = [{ handle: '0' }, { handle: '1' }];
    assert.deepEqual(speech.legalCommands([
        { handle: '0', commandName: 'say', params: ['hi'] },
        { handle: '9', commandName: 'move', params: ['up'] },
        { handle: '1', commandName: 'move', params: ['up'] },
        { handle: '1', commandName: 'blush', params: ['#ffffff'] }
    ], own), [{ handle: '1', commandName: 'move', params: ['up'] }]);
    assert.equal(speech.advertise([{ handle: '1', commandName: 'move', params: ['up'] }], own, 0).at(-1).params[0], speech.ADVERT);
});
