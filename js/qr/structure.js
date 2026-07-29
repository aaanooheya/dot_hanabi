// Function-pattern placement shared by the encoder and decoder. Both need
// to agree exactly on which modules are finder/timing/alignment/format/
// version patterns (not part of the maskable data area) -- any mismatch
// between the two would silently corrupt every decode, so this lives in
// one place.
import { ALIGNMENT_COORDS } from './tables.js';

export function createEmptyMatrix(size) {
  return {
    dark: Array.from({ length: size }, () => new Array(size).fill(false)),
    reserved: Array.from({ length: size }, () => new Array(size).fill(false)),
    size,
  };
}

export function setModule(m, r, c, dark, reserve = true) {
  if (r < 0 || c < 0 || r >= m.size || c >= m.size) return;
  m.dark[r][c] = dark;
  if (reserve) m.reserved[r][c] = true;
}

function placeFinder(m, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.size || cc >= m.size) continue;
      const isBorder = r === -1 || r === 7 || c === -1 || c === 7;
      const isRing = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
      const isCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const dark = !isBorder && (isRing || isCore);
      setModule(m, rr, cc, dark);
    }
  }
}

function placeAlignmentPatterns(m, version) {
  const coords = ALIGNMENT_COORDS[version];
  if (!coords.length) return;
  for (const row of coords) {
    for (const col of coords) {
      const nearTopLeft = row <= 7 && col <= 7;
      const nearTopRight = row <= 7 && col >= m.size - 8;
      const nearBottomLeft = row >= m.size - 8 && col <= 7;
      if (nearTopLeft || nearTopRight || nearBottomLeft) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const ring = Math.max(Math.abs(r), Math.abs(c));
          setModule(m, row + r, col + c, ring !== 1);
        }
      }
    }
  }
}

function placeTiming(m) {
  for (let i = 8; i < m.size - 8; i++) {
    setModule(m, 6, i, i % 2 === 0);
    setModule(m, i, 6, i % 2 === 0);
  }
}

function reserveFormatAreas(m) {
  for (let i = 0; i < 9; i++) {
    setModule(m, 8, i, false);
    setModule(m, i, 8, false);
  }
  for (let i = m.size - 8; i < m.size; i++) {
    setModule(m, 8, i, false);
    setModule(m, i, 8, false);
  }
  setModule(m, m.size - 8, 8, true); // dark module
}

function reserveVersionAreas(m, version) {
  if (version < 7) return;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 3; c++) {
      setModule(m, r, m.size - 11 + c, false);
      setModule(m, m.size - 11 + c, r, false);
    }
  }
}

// Builds a matrix with every function pattern placed/reserved (finder,
// alignment, timing, dark module, and reserved-but-blank format/version
// areas). Data and format/version *values* still need to be written after
// this by the caller.
export function buildFunctionPatterns(size, version) {
  const m = createEmptyMatrix(size);
  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);
  placeAlignmentPatterns(m, version);
  placeTiming(m);
  reserveFormatAreas(m);
  reserveVersionAreas(m, version);
  return m;
}

export function placeFormatInfoBits(m, bits) {
  const get = (i) => ((bits >> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) setModule(m, i, 8, get(i));
  setModule(m, 7, 8, get(6));
  setModule(m, 8, 8, get(7));
  setModule(m, 8, 7, get(8));
  for (let i = 9; i <= 14; i++) setModule(m, 8, 14 - i, get(i));
  for (let i = 0; i <= 7; i++) setModule(m, 8, m.size - 1 - i, get(i));
  for (let i = 8; i <= 14; i++) setModule(m, m.size - 15 + i, 8, get(i));
}

export function placeVersionInfoBits(m, version, bits) {
  if (version < 7) return;
  for (let i = 0; i < 18; i++) {
    const bit = ((bits >> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const col = i % 3;
    setModule(m, row, m.size - 11 + col, bit);
    setModule(m, m.size - 11 + col, row, bit);
  }
}

// Reads the 15 format-info bits from the top-left copy (bit i as placed by
// placeFormatInfoBits) given a raw dark/light grid.
export function readFormatInfoBitsTopLeft(grid, size) {
  let bits = 0;
  const get = (r, c) => (grid[r][c] ? 1 : 0);
  for (let i = 0; i <= 5; i++) bits |= get(i, 8) << i;
  bits |= get(7, 8) << 6;
  bits |= get(8, 8) << 7;
  bits |= get(8, 7) << 8;
  for (let i = 9; i <= 14; i++) bits |= get(8, 14 - i) << i;
  return bits;
}

export function readFormatInfoBitsOther(grid, size) {
  let bits = 0;
  const get = (r, c) => (grid[r][c] ? 1 : 0);
  for (let i = 0; i <= 7; i++) bits |= get(8, size - 1 - i) << i;
  for (let i = 8; i <= 14; i++) bits |= get(size - 15 + i, 8) << i;
  return bits;
}

// Same traversal order the encoder's placeData uses, yielded as a flat
// list of {row, col} for every non-reserved module. Both placing data and
// reading it back walk this identical sequence.
export function dataModuleOrder(m) {
  const order = [];
  let upward = true;
  for (let right = m.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let i = 0; i < m.size; i++) {
      const row = upward ? m.size - 1 - i : i;
      for (const c of [right, right - 1]) {
        if (m.reserved[row][c]) continue;
        order.push([row, c]);
      }
    }
    upward = !upward;
  }
  return order;
}
