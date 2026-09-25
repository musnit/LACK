// Node 24+. Run: node client.js TOKEN [ENDPOINT]
const RemotePlayer = require('./player');
const TOKEN = '';
const [tokenArgument, endpointArgument, ...extra] = process.argv.slice(2);
if (extra.length || [tokenArgument, endpointArgument].some(value => value?.startsWith('--'))) {
    throw new Error('Usage: node client.js TOKEN [ENDPOINT]');
}
const token = tokenArgument || TOKEN;
const endpoint = endpointArgument || 'wss://latticeanimals.com/ws';
if (!token) throw new Error('Supply the player token shown in Arena.');
// Each game gets one instance of the class exported by player.js.
const createPlayer = () => new RemotePlayer();
const games = new Map();
const pending = new Map();
let requestId = 0;
const socket = new WebSocket(endpoint);
const request = (type, data = {}) => new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ version: 1, type, requestId: id, ...data }));
});
const report = ({ message }) => console.error(message);
// Preserve the Player observation contract without importing the game engine.
const freeze = value => {
    if (!value || typeof value !== 'object') return value;
    for (const child of Object.values(value)) freeze(child);
    return Object.freeze(value);
};
const restore = game => {
    const player = createPlayer();
    games.set(game.gameId, { config: game.config, player });
    if (game.targetShape && game.state?.ownUnits.length) player.round(game.config.width, game.config.height, game.targetShape);
};
const turn = async message => {
    const game = games.get(message.gameId);
    if (!message.state.ownUnits.length) return;
    const send = commands => {
        if (socket.readyState !== WebSocket.OPEN || commands === undefined) return;
        if (!Array.isArray(commands)) throw new Error('turn() must return an array of commands or undefined.');
        let batch = [], bytes = 0;
        const flush = () => {
            if (!batch.length) return;
            request('player-commands', { gameId: message.gameId, turnId: message.turnId, commands: batch })
                .catch(error => { console.error(error.message); socket.close(); process.exitCode = 1; });
            batch = []; bytes = 0;
        };
        for (const command of commands) {
            const encoded = JSON.stringify(command);
            const size = Buffer.byteLength(encoded ?? 'null') + 1;
            if (size > 12000) { report({ message: 'Command exceeds transport size limit.' }); continue; }
            if (batch.length === 128 || bytes + size > 12000) flush();
            batch.push(JSON.parse(encoded ?? 'null')); bytes += size;
        }
        flush();
    };
    try {
        send(await game.player.turn(message.state, message.remainingMs));
    } catch (error) { report({ message: String(error?.message ?? error) }); }
};
socket.onmessage = async ({ data }) => {
    try {
        const message = freeze(JSON.parse(data));
        switch (message.type) {
            case 'error':
                report({ message: `${message.code}: ${message.message}` });
                break;
            case 'response': {
                const response = pending.get(message.requestId);
                pending.delete(message.requestId);
                if (message.error) response.reject(new Error(message.error.message));
                else response.resolve(message.result);
                break;
            }
            case 'ready':
                await request('player-auth', { token });
                console.log(`Authenticated at ${endpoint}`);
                break;
            case 'player-join': {
                restore(message);
                const units = Array.from({ length: message.count }, (_, index) => ({ handle: String(index) }));
                await request('player-joined', { gameId: message.gameId, attemptId: message.attemptId, units });
                console.log('Joined game', message.gameId);
                break;
            }
            case 'player-resume':
                restore(message.game);
                if (message.game.status === 'playing' && message.game.turnId !== null) void turn(message.game);
                break;
            case 'player-round': {
                const { config, player } = games.get(message.gameId);
                if (message.state.ownUnits.length) player.round(config.width, config.height, message.targetShape);
                break;
            }
            case 'player-turn': void turn(message); break;
            case 'player-round-end':
                if (message.outcomes.length) games.get(message.gameId)?.player.roundEnd(message.outcomes);
                break;
            case 'player-finished':
                games.get(message.gameId)?.player.finish(message.result);
                games.delete(message.gameId);
                console.log('player-finished', message.gameId);
                break;
            case 'player-released':
                games.delete(message.gameId); break;
        }
    } catch (error) { console.error(error.message); socket.close(); process.exitCode = 1; }
};
socket.onclose = ({ code }) => {
    games.clear();
    for (const response of pending.values()) response.reject(new Error('Player connection closed'));
    pending.clear();
    console.log('Disconnected', code);
};
socket.onerror = () => { console.error('Player connection failed'); process.exitCode = 1; };
