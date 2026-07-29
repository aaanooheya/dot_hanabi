// Draws a QR matrix (from encodeQrMatrix) onto a canvas, with an optional
// logo image composited in the center (kept to a safe fraction of the
// module grid so Reed-Solomon error correction can still recover the
// covered data).
export function renderQrToCanvas(canvas, matrix, targetPx, logoImage, logoFraction = 0.28) {
  const { size, modules } = matrix;
  const quiet = 4; // ISO/IEC 18004 minimum quiet zone, in modules
  const totalModules = size + quiet * 2;
  const scale = Math.max(1, Math.floor(targetPx / totalModules));
  const pixelSize = totalModules * scale;

  canvas.width = pixelSize;
  canvas.height = pixelSize;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pixelSize, pixelSize);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) {
        ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
  }

  if (logoImage) {
    const dataAreaPx = size * scale;
    const logoPx = Math.round(dataAreaPx * logoFraction);
    const pad = Math.round(logoPx * 0.12);
    const boxSize = logoPx + pad * 2;
    const boxPos = (pixelSize - boxSize) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(boxPos, boxPos, boxSize, boxSize);
    const logoPos = (pixelSize - logoPx) / 2;
    ctx.drawImage(logoImage, logoPos, logoPos, logoPx, logoPx);
  }

  return canvas;
}
