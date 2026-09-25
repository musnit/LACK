// Run the normal client (client.js + player.js) and also save what the live server sends.
//
//   node gym/record.js YOUR_PLAYER_TOKEN [ENDPOINT]
//
// Writes into gym/recordings/ (git-ignored):
//   latest-config.json   the most recent game's real settings, usable with `gym/run.js --config`
//   latest-arena.json / latest-clash.json   the same, per mode (when the server names the mode)
//   configs.jsonl        one line per game joined: mode, units each, competitors, settings
//   <gameId>.jsonl       every server event for that game plus the commands we sent, one JSON per line
//
// The token is only used by client.js; outgoing messages other than commands are never written.
const { mkdirSync, appendFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const folder = join(__dirname, 'recordings');
mkdirSync(folder, { recursive: true });
const save = (gameId, entry) => appendFileSync(join(folder, `${gameId}.jsonl`), JSON.stringify({ at: Date.now(), ...entry }) + '\n');

function saveConfig(message) {
    const game = message.game ?? message;
    if (!game.config) return;
    const count = game.count ?? message.count;
    // Join messages don't name the mode, but requiredUnits / count gives the number of competitors
    // (assuming no golem, which also takes board slots).
    const summary = { gameId: game.gameId, mode: game.mode ?? null, receivedAt: new Date().toISOString(),
        count, competitors: game.config.requiredUnits / count, config: game.config };
    writeFileSync(join(folder, 'latest-config.json'), JSON.stringify(summary, null, 2) + '\n');
    if (summary.mode) writeFileSync(join(folder, `latest-${summary.mode}.json`), JSON.stringify(summary, null, 2) + '\n');
    appendFileSync(join(folder, 'configs.jsonl'), JSON.stringify({ ...summary, config: { ...game.config, shapes: game.config.shapes.map(shape => shape.name) } }) + '\n');
}

// Wrap the global WebSocket so client.js runs unchanged while we listen in.
class RecordingSocket extends WebSocket {
    set onmessage(handler) {
        super.onmessage = event => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'player-join' || message.type === 'player-resume') saveConfig(message);
                const gameId = message.gameId ?? message.game?.gameId;
                if (gameId) save(gameId, { direction: 'in', message });
            } catch (error) {
                console.error('recorder:', error.message);
            }
            return handler(event);
        };
    }
    get onmessage() { return super.onmessage; }

    send(data) {
        try {
            const message = JSON.parse(data);
            if (message.type === 'player-commands') save(message.gameId, { direction: 'out', message });
        } catch {}
        return super.send(data);
    }
}
globalThis.WebSocket = RecordingSocket;
require('../client.js');
