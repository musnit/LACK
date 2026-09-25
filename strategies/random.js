// The kit's original starter: wanders randomly and occasionally speaks. Useful as a baseline opponent.
const Player = require('../game/Player');

class RandomWalker extends Player {
    round(width, height, targetShape) {
        // Retain this.width, this.height and this.targetShape for turn decisions.
        super.round(width, height, targetShape);
        // Reset any round-specific strategy memory here.
    }

    async turn(state, remainingMs) {
        const commands = [];
        for (const unit of state.ownUnits) {
            const command = this.#act(unit.handle);
            if (command) commands.push(command);
        }
        return commands;
    }

    roundEnd(outcomes) {
        // Each entry: { handle, won, energyBefore, energyAfter, eliminated }.
        // Newly eliminated units are included. Optional debugging:
        // console.log('Round outcomes:', outcomes);
    }

    finish(result) {
        // { name, totalEnergy, survivorCount, rank, winner }, or null after an abnormal ending.
        // Release game-specific resources here. Optional debugging:
        // console.log('Game result:', result);
    }

    #act(handle) {
        if (Math.random() < 0.1) {
            const phrases = ['what is going on?', 'where am I?', 'what is this?', 'who are you?', 'wow!'];
            return Player.commands.say(handle, phrases[Math.floor(Math.random() * phrases.length)]);
        }
        // One additional random outcome retains the chance of doing nothing.
        const directions = Object.values(Player.DIRECTIONS);
        const direction = directions[Math.floor(Math.random() * (directions.length + 1))];
        if (direction !== undefined) return Player.commands.move(handle, direction);
    }
}

module.exports = RandomWalker;
