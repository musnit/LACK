// Evolve's control of in-game speech. The live strategy never talks: anything
// but a legal move or blush for one of our own units is dropped. Instead, every
// turn the core has a random unit say an advert inviting players to suggest
// changes, and picks suggestions out of what it hears. Speech is anonymous, so a suggestion
// is simply any heard message that starts with TRIGGER.
const Player = require('../../../game/Player');

const TRIGGER = 'evolve:';
const ADVERT = `I'm a self-evolving bot. Say "${TRIGGER} <idea>" and my AI maintainer may rewrite my strategy with it.`;
const HEX = /^#[0-9a-f]{6}$/i;

// Suggestions in one turn's `messages`, with the trigger removed.
function suggestions(messages = []) {
    return messages
        .map(message => (typeof message?.text === 'string' ? message.text.trim() : ''))
        .filter(text => text.toLowerCase().startsWith(TRIGGER))
        .map(text => clean(text.slice(TRIGGER.length)))
        .filter(Boolean);
}

// Printable text only, whitespace collapsed, within the game's speech limit.
function clean(text) {
    return [...text.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, Player.MAX_SPEECH_LENGTH).join('');
}

// The live strategy's commands, keeping only one legal move or blush per own unit.
function legalCommands(commands, ownUnits) {
    const own = new Set(ownUnits.map(unit => String(unit.handle)));
    const used = new Set();
    const legal = [];
    for (const command of Array.isArray(commands) ? commands : []) {
        const handle = String(command?.handle);
        const [param] = Array.isArray(command?.params) ? command.params : [];
        const ok = (command?.commandName === 'move' && Object.hasOwn(Player.DELTAS, param))
            || (command?.commandName === 'blush' && typeof param === 'string' && HEX.test(param));
        if (!ok || !own.has(handle) || used.has(handle)) continue;
        used.add(handle);
        legal.push({ handle: command.handle, commandName: command.commandName, params: [param] });
    }
    return legal;
}

// `commands` plus the advert, said by a random idle unit, or by a random busy
// one (which then skips its move) when none is idle. No units: no advert.
function advertise(commands, ownUnits) {
    if (!ownUnits.length) return commands;
    const busy = new Set(commands.map(command => String(command.handle)));
    const idle = ownUnits.filter(unit => !busy.has(String(unit.handle)));
    const speaker = pick(idle.length ? idle : ownUnits);
    return [...commands.filter(command => String(command.handle) !== String(speaker.handle)), Player.commands.say(speaker.handle, ADVERT)];
}

const pick = list => list[Math.floor(Math.random() * list.length)];

module.exports = { TRIGGER, ADVERT, suggestions, clean, legalCommands, advertise };
