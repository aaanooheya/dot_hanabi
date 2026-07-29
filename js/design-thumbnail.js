// Renders a firework design to a small canvas for use as the logo
// composited into the center of its recipe QR code.
export function renderDesignToCanvas(design, pixelSize) {
  const canvas = document.createElement('canvas');
  canvas.width = pixelSize;
  canvas.height = pixelSize;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0b1230';
  ctx.fillRect(0, 0, pixelSize, pixelSize);

  const cell = pixelSize / design.size;
  for (let y = 0; y < design.size; y++) {
    for (let x = 0; x < design.size; x++) {
      const c = design.pixels[y][x];
      if (c) {
        ctx.fillStyle = c;
        ctx.fillRect(x * cell, y * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
  }
  return canvas;
}
