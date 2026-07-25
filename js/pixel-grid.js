export const PALETTE = [
  '#ff3b3b', // red
  '#ff9d3b', // orange
  '#ffe93b', // yellow
  '#7dff3b', // green
  '#3bffe4', // cyan
  '#3b9dff', // blue
  '#b23bff', // purple
  '#ff3bd6', // pink
  '#ffffff', // white
  '#3bff8f', // mint
];

export function createEmptyGrid(size) {
  return Array.from({ length: size }, () => Array(size).fill(null));
}

export function drawGridToCanvas(canvas, grid, size, options = {}) {
  const ctx = canvas.getContext('2d');
  const cell = canvas.width / size;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = grid[y][x];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x * cell, y * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
  }
}
