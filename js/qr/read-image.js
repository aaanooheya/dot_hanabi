// Reads a QR code back out of an image (a canvas ImageData). Scoped to a
// clean, axis-aligned, non-perspective-distorted image -- i.e. our own
// generated QR re-uploaded or pasted, not a photo taken at an angle. That
// keeps the image-processing side tractable; Reed-Solomon still does the
// heavy lifting of recovering the data the embedded logo covers.
import { decodeMatrix } from './decode.js';

function toBinary(imageData) {
  const { width, height, data } = imageData;
  const gray = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Otsu's method for a global black/white threshold.
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[Math.round(gray[i])]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    // >= (not >) so that on a perfectly bimodal image -- our own rendered
    // QR codes, pure black/white with nothing in between -- ties resolve
    // to the *last* candidate threshold rather than 0, which would
    // classify every pixel as light and detect nothing.
    if (varBetween >= maxVar) {
      maxVar = varBetween;
      threshold = t;
    }
  }

  const bin = new Uint8Array(width * height); // 1 = dark
  for (let i = 0; i < gray.length; i++) bin[i] = gray[i] < threshold ? 1 : 0;
  return { bin, width, height };
}

function rowRuns(bin, width, y) {
  const colors = [];
  const lens = [];
  let cur = bin[y * width];
  let len = 1;
  for (let x = 1; x < width; x++) {
    const v = bin[y * width + x];
    if (v === cur) {
      len++;
    } else {
      colors.push(cur);
      lens.push(len);
      cur = v;
      len = 1;
    }
  }
  colors.push(cur);
  lens.push(len);
  return { colors, lens };
}

function checkRatio(runs) {
  if (runs.some((r) => r <= 0)) return false;
  const unit = (runs[0] + runs[1] + runs[3] + runs[4] + runs[2] / 3) / 5;
  if (unit < 1) return false;
  const tol = unit * 0.6;
  return (
    Math.abs(runs[0] - unit) < tol &&
    Math.abs(runs[1] - unit) < tol &&
    Math.abs(runs[2] - 3 * unit) < tol * 1.8 &&
    Math.abs(runs[3] - unit) < tol &&
    Math.abs(runs[4] - unit) < tol
  );
}

// Scans every row (and, symmetrically, every column) for the finder
// pattern's 1:1:3:1:1 dark/light ratio, yielding one candidate center per
// match.
function findLineCandidates(bin, width, height, horizontal) {
  const candidates = [];
  const outer = horizontal ? height : width;
  const inner = horizontal ? width : height;
  const at = (line, pos) => (horizontal ? bin[line * width + pos] : bin[pos * width + line]);

  for (let line = 0; line < outer; line++) {
    const colors = [];
    const lens = [];
    let cur = at(line, 0);
    let len = 1;
    for (let p = 1; p < inner; p++) {
      const v = at(line, p);
      if (v === cur) {
        len++;
      } else {
        colors.push(cur);
        lens.push(len);
        cur = v;
        len = 1;
      }
    }
    colors.push(cur);
    lens.push(len);

    let pos = 0;
    const starts = [];
    for (let i = 0; i < lens.length; i++) {
      starts.push(pos);
      pos += lens[i];
    }
    for (let i = 0; i + 5 <= colors.length; i++) {
      if (colors[i] === 1 && colors[i + 1] === 0 && colors[i + 2] === 1 && colors[i + 3] === 0 && colors[i + 4] === 1) {
        const runs5 = lens.slice(i, i + 5);
        if (checkRatio(runs5)) {
          const center = starts[i + 2] + runs5[2] / 2;
          const moduleSize = (runs5[0] + runs5[1] + runs5[2] + runs5[3] + runs5[4]) / 7;
          candidates.push(horizontal ? { x: center, y: line, moduleSize } : { x: line, y: center, moduleSize });
        }
      }
    }
  }
  return candidates;
}

function clusterCandidates(candidates, distThreshold) {
  const clusters = [];
  for (const c of candidates) {
    let found = null;
    for (const cluster of clusters) {
      const cx = cluster.sumX / cluster.count;
      const cy = cluster.sumY / cluster.count;
      if (Math.abs(c.x - cx) < distThreshold && Math.abs(c.y - cy) < distThreshold) {
        found = cluster;
        break;
      }
    }
    if (found) {
      found.sumX += c.x;
      found.sumY += c.y;
      found.sumModule += c.moduleSize;
      found.count++;
    } else {
      clusters.push({ sumX: c.x, sumY: c.y, sumModule: c.moduleSize, count: 1 });
    }
  }
  return clusters.map((cl) => ({
    x: cl.sumX / cl.count,
    y: cl.sumY / cl.count,
    moduleSize: cl.sumModule / cl.count,
    votes: cl.count,
  }));
}

function nearestValidSize(estimate) {
  let best = 21;
  let bestDiff = Infinity;
  for (let v = 1; v <= 27; v++) {
    const sz = 17 + 4 * v;
    const diff = Math.abs(sz - estimate);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = sz;
    }
  }
  return best;
}

function sampleModules(bin, width, height, size, topLeft, topRight, bottomLeft) {
  const moduleWidthX = (topRight.x - topLeft.x) / (size - 7);
  const moduleWidthY = (bottomLeft.y - topLeft.y) / (size - 7);
  // topLeft is the finder's pixel *center*, which sits at module (3.5, 3.5)
  // measured from the outer edge of module (0,0) -- not (3, 3).
  const originX = topLeft.x - 3.5 * moduleWidthX;
  const originY = topLeft.y - 3.5 * moduleWidthY;

  const modules = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) {
      const px = Math.round(originX + (c + 0.5) * moduleWidthX);
      const py = Math.round(originY + (r + 0.5) * moduleWidthY);
      const cx = Math.min(width - 1, Math.max(0, px));
      const cy = Math.min(height - 1, Math.max(0, py));
      row.push(bin[cy * width + cx] === 1);
    }
    modules.push(row);
  }
  return modules;
}

function locateFinderPatterns(bin, width, height) {
  const horizontalHits = findLineCandidates(bin, width, height, true);
  const verticalHits = findLineCandidates(bin, width, height, false);
  const distThreshold = Math.max(width, height) * 0.02 + 4;
  const clustered = clusterCandidates([...horizontalHits, ...verticalHits], distThreshold);

  // A real finder pattern gets hit by ~7 rows and ~7 columns; require
  // decent support from both directions to reject stray matches.
  const strong = clustered.filter((c) => c.votes >= 6);
  if (strong.length < 3) {
    throw new Error('QRコードを検出できませんでした');
  }
  strong.sort((a, b) => b.votes - a.votes);
  const [A, B, C] = strong;

  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const dAB = dist(A, B);
  const dBC = dist(B, C);
  const dCA = dist(C, A);

  let topLeft;
  let others;
  if (dBC >= dAB && dBC >= dCA) {
    topLeft = A;
    others = [B, C];
  } else if (dCA >= dAB && dCA >= dBC) {
    topLeft = B;
    others = [A, C];
  } else {
    topLeft = C;
    others = [A, B];
  }

  let topRight;
  let bottomLeft;
  if (Math.abs(others[0].y - topLeft.y) < Math.abs(others[1].y - topLeft.y)) {
    topRight = others[0];
    bottomLeft = others[1];
  } else {
    topRight = others[1];
    bottomLeft = others[0];
  }

  return { topLeft, topRight, bottomLeft };
}

export function readQrFromImageData(imageData) {
  const { bin, width, height } = toBinary(imageData);
  const { topLeft, topRight, bottomLeft } = locateFinderPatterns(bin, width, height);

  const avgModuleSize = (topLeft.moduleSize + topRight.moduleSize + bottomLeft.moduleSize) / 3;
  const estSize = (topRight.x - topLeft.x) / avgModuleSize + 7;
  const size = nearestValidSize(estSize);

  const modules = sampleModules(bin, width, height, size, topLeft, topRight, bottomLeft);
  return decodeMatrix(size, modules);
}

export function readQrFromImage(imgEl) {
  const canvas = document.createElement('canvas');
  canvas.width = imgEl.naturalWidth || imgEl.width;
  canvas.height = imgEl.naturalHeight || imgEl.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return readQrFromImageData(imageData);
}
