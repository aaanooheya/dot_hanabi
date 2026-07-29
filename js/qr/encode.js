import { rsEncode } from './reed-solomon.js';
import {
  VERSION_INFO_H,
  matrixSize,
  dataCapacityBytes,
  encodeFormatInfo,
  encodeVersionInfo,
  MASK_FUNCTIONS,
} from './tables.js';
import { buildFunctionPatterns, placeFormatInfoBits, placeVersionInfoBits, dataModuleOrder } from './structure.js';

function pickVersion(byteLength) {
  for (let v = 1; v <= 27; v++) {
    // -2 bytes of headroom for the mode/length/terminator overhead below.
    if (dataCapacityBytes(v) - 2 >= byteLength) return v;
  }
  return null;
}

// ---- Bit buffer ----
class BitWriter {
  constructor() {
    this.bits = [];
  }
  push(value, length) {
    for (let i = length - 1; i >= 0; i--) {
      this.bits.push((value >> i) & 1);
    }
  }
  get length() {
    return this.bits.length;
  }
}

function buildCodewords(text, version) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const capacityBytes = dataCapacityBytes(version);
  const countBits = version <= 9 ? 8 : 16;

  const writer = new BitWriter();
  writer.push(0b0100, 4); // byte-mode indicator
  writer.push(bytes.length, countBits);
  for (const b of bytes) writer.push(b, 8);

  const capacityBits = capacityBytes * 8;
  const term = Math.min(4, capacityBits - writer.length);
  if (term > 0) writer.push(0, term);
  while (writer.length % 8 !== 0) writer.bits.push(0);

  const dataCodewords = [];
  for (let i = 0; i < writer.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | writer.bits[i + j];
    dataCodewords.push(byte);
  }

  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  while (dataCodewords.length < capacityBytes) {
    dataCodewords.push(padBytes[padIndex % 2]);
    padIndex++;
  }
  return dataCodewords;
}

function interleaveBlocks(dataCodewords, version) {
  const info = VERSION_INFO_H[version];
  const blocks = [];
  let offset = 0;
  for (const [count, dataLen] of info.groups) {
    for (let i = 0; i < count; i++) {
      const data = dataCodewords.slice(offset, offset + dataLen);
      offset += dataLen;
      const ec = rsEncode(data, info.ecPerBlock);
      blocks.push({ data, ec });
    }
  }

  const maxDataLen = Math.max(...blocks.map((b) => b.data.length));
  const result = [];
  for (let i = 0; i < maxDataLen; i++) {
    for (const b of blocks) {
      if (i < b.data.length) result.push(b.data[i]);
    }
  }
  for (let i = 0; i < info.ecPerBlock; i++) {
    for (const b of blocks) result.push(b.ec[i]);
  }
  return result;
}

function placeData(m, codewords) {
  const bits = [];
  for (const byte of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  const order = dataModuleOrder(m);
  order.forEach(([row, col], i) => {
    const bit = i < bits.length ? bits[i] : 0;
    m.dark[row][col] = bit === 1;
  });
}

function applyMask(m, maskFn) {
  const size = m.size;
  const out = Array.from({ length: size }, () => new Array(size).fill(false));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const v = m.dark[r][c];
      out[r][c] = m.reserved[r][c] ? v : v !== maskFn(r, c);
    }
  }
  return out;
}

function penaltyScore(grid) {
  const size = grid.length;
  let score = 0;

  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (grid[r][c] === grid[r][c - 1]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (grid[r][c] === grid[r - 1][c]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  }

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = grid[r][c];
      if (grid[r][c + 1] === v && grid[r + 1][c] === v && grid[r + 1][c + 1] === v) {
        score += 3;
      }
    }
  }

  const patternA = [true, false, true, true, true, false, true, false, false, false, false];
  const patternB = patternA.slice().reverse();
  const matchesAt = (arr, i, pattern) => {
    for (let k = 0; k < pattern.length; k++) {
      if (arr[i + k] !== pattern[k]) return false;
    }
    return true;
  };
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      if (matchesAt(grid[r], c, patternA) || matchesAt(grid[r], c, patternB)) score += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    const col = grid.map((row) => row[c]);
    for (let r = 0; r <= size - 11; r++) {
      if (matchesAt(col, r, patternA) || matchesAt(col, r, patternB)) score += 40;
    }
  }

  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r][c]) dark++;
  const percent = (dark * 100) / (size * size);
  const deviation = Math.abs(Math.floor(percent / 5) * 5 - 50) / 5;
  score += deviation * 10;

  return score;
}

// Returns { size, version, modules } where modules[r][c] is true for a
// dark module.
export function encodeQrMatrix(text) {
  const version = pickVersion(new TextEncoder().encode(text).length);
  if (!version) {
    throw new Error('データが大きすぎてQRコードを作成できません');
  }
  const size = matrixSize(version);
  const m = buildFunctionPatterns(size, version);
  placeVersionInfoBits(m, version, encodeVersionInfo(version));

  const dataCodewords = buildCodewords(text, version);
  const finalCodewords = interleaveBlocks(dataCodewords, version);
  placeData(m, finalCodewords);

  let bestGrid = null;
  let bestScore = Infinity;
  for (let maskPattern = 0; maskPattern < 8; maskPattern++) {
    const grid = applyMask(m, MASK_FUNCTIONS[maskPattern]);
    const withFormat = { size, dark: grid, reserved: m.reserved };
    placeFormatInfoBits(withFormat, encodeFormatInfo(maskPattern));
    placeVersionInfoBits(withFormat, version, encodeVersionInfo(version));
    const score = penaltyScore(withFormat.dark);
    if (score < bestScore) {
      bestScore = score;
      bestGrid = withFormat.dark;
    }
  }

  return { size, version, modules: bestGrid };
}
