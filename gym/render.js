// Draws the board as text. Each competitor gets a letter (A, B, C…, golem = g).
// Units that currently complete a target shape are UPPERCASE, the rest lowercase.
function render(game, names, { type, roundIndex, turnIndex, shape, title = '' }) {
    const { width, height } = game.config;
    const frame = game.log.turns.at(-1);
    const matched = new Set(frame.matches.flat());
    const letters = new Map(names.map((name, index) => [String(index), name === 'golem' ? 'g' : String.fromCharCode(65 + index)]));
    const grid = Array.from({ length: height }, () => Array(width).fill('·'));
    for (const unit of frame.units) {
        const letter = letters.get(unit.id.split(':')[0]);
        grid[unit.y][unit.x] = matched.has(unit.id) ? letter.toUpperCase() : letter.toLowerCase();
    }

    const counts = names.map((name, index) => {
        const units = game.units.filter(unit => unit.playerId === String(index));
        const inShape = frame.units.filter(unit => unit.id.startsWith(`${index}:`) && matched.has(unit.id)).length;
        const energy = units.reduce((sum, unit) => sum + unit.energy, 0);
        return `${letters.get(String(index))}=${name}: ${units.length} units, ${energy} energy, ${inShape} in shape`;
    });
    const turn = type === 'round-end' ? 'end' : turnIndex === undefined ? 'start' : `turn ${turnIndex + 1}`;
    const shapePicture = drawShape(shape);
    return [
        `${title}Round ${roundIndex + 1}, ${turn}   target: ${shape.name}`,
        ...shapePicture,
        ...counts,
        '┌' + '─'.repeat(width) + '┐',
        ...grid.map(row => '│' + row.join('') + '│'),
        '└' + '─'.repeat(width) + '┘'
    ].join('\n');
}

function drawShape(shape) {
    const rows = Array.from({ length: shape.height }, () => Array(shape.width).fill(' '));
    for (const [dx, dy] of shape.cells) rows[dy][dx] = '█';
    return rows.map(row => '  ' + row.join(''));
}

module.exports = { render };
