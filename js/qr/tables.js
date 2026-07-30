// QR structural tables and small BCH/mask helpers, per ISO/IEC 18004.
// Versions 1-27 at error correction level H are supported (H gives the
// ~30% error tolerance needed to survive the embedded design thumbnail
// covering part of the code). Versions 1-10 were verified by hand;
// versions 11-27 are transcribed from Thonky's QR code tutorial
// (https://www.thonky.com/qr-code-tutorial/error-correction-table and
// .../alignment-pattern-locations) and cross-checked against the
// independently-known total-codewords-per-version sequence (every entry's
// data + EC codewords sums to the expected total for its version) -- but
// that's still a necessary-not-sufficient check, so treat versions above
// 10 as "should work" rather than "verified against a real scanner" until
// confirmed by an actual phone scan.
//
// Each entry: total codewords, EC codewords per block, and the two
// (possibly one) groups of [blockCount, dataCodewordsPerBlock].
export const VERSION_INFO_H = {
  1: { totalCw: 26, ecPerBlock: 17, groups: [[1, 9]] },
  2: { totalCw: 44, ecPerBlock: 28, groups: [[1, 16]] },
  3: { totalCw: 70, ecPerBlock: 22, groups: [[2, 13]] },
  4: { totalCw: 100, ecPerBlock: 16, groups: [[4, 9]] },
  5: { totalCw: 134, ecPerBlock: 22, groups: [[2, 11], [2, 12]] },
  6: { totalCw: 172, ecPerBlock: 28, groups: [[4, 15]] },
  7: { totalCw: 196, ecPerBlock: 26, groups: [[4, 13], [1, 14]] },
  8: { totalCw: 242, ecPerBlock: 26, groups: [[4, 14], [2, 15]] },
  9: { totalCw: 292, ecPerBlock: 24, groups: [[4, 12], [4, 13]] },
  10: { totalCw: 346, ecPerBlock: 28, groups: [[6, 15], [2, 16]] },
  11: { totalCw: 404, ecPerBlock: 24, groups: [[3, 12], [8, 13]] },
  12: { totalCw: 466, ecPerBlock: 28, groups: [[7, 14], [4, 15]] },
  13: { totalCw: 532, ecPerBlock: 22, groups: [[12, 11], [4, 12]] },
  14: { totalCw: 581, ecPerBlock: 24, groups: [[11, 12], [5, 13]] },
  15: { totalCw: 655, ecPerBlock: 24, groups: [[11, 12], [7, 13]] },
  16: { totalCw: 733, ecPerBlock: 30, groups: [[3, 15], [13, 16]] },
  17: { totalCw: 815, ecPerBlock: 28, groups: [[2, 14], [17, 15]] },
  18: { totalCw: 901, ecPerBlock: 28, groups: [[2, 14], [19, 15]] },
  19: { totalCw: 991, ecPerBlock: 26, groups: [[9, 13], [16, 14]] },
  20: { totalCw: 1085, ecPerBlock: 28, groups: [[15, 15], [10, 16]] },
  21: { totalCw: 1156, ecPerBlock: 30, groups: [[19, 16], [6, 17]] },
  22: { totalCw: 1258, ecPerBlock: 24, groups: [[34, 13]] },
  23: { totalCw: 1364, ecPerBlock: 30, groups: [[16, 15], [14, 16]] },
  24: { totalCw: 1474, ecPerBlock: 30, groups: [[30, 16], [2, 17]] },
  25: { totalCw: 1588, ecPerBlock: 30, groups: [[22, 15], [13, 16]] },
  26: { totalCw: 1706, ecPerBlock: 30, groups: [[33, 16], [4, 17]] },
  27: { totalCw: 1828, ecPerBlock: 30, groups: [[12, 15], [28, 16]] },
};

export const ALIGNMENT_COORDS = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
  11: [6, 30, 54],
  12: [6, 32, 58],
  13: [6, 34, 62],
  14: [6, 26, 46, 66],
  15: [6, 26, 48, 70],
  16: [6, 26, 50, 74],
  17: [6, 30, 54, 78],
  18: [6, 30, 56, 82],
  19: [6, 30, 58, 86],
  20: [6, 34, 62, 90],
  21: [6, 28, 50, 72, 94],
  22: [6, 26, 50, 74, 98],
  23: [6, 30, 54, 78, 102],
  24: [6, 28, 54, 80, 106],
  25: [6, 32, 58, 84, 110],
  26: [6, 30, 58, 86, 114],
  27: [6, 34, 62, 90, 118],
};

export function matrixSize(version) {
  return 17 + 4 * version;
}

export function dataCapacityBytes(version) {
  const info = VERSION_INFO_H[version];
  return info.groups.reduce((sum, [count, dataCw]) => sum + count * dataCw, 0);
}

// Largest byte-mode payload (in bytes) that fits in `version`, accounting
// for the byte-mode header: a 4-bit mode indicator plus an 8-bit (versions
// 1-9) or 16-bit (versions 10+) character count. The terminator is left
// out since encode.js's buildCodewords skips it whenever there's no room.
export function maxByteLength(version) {
  const countBits = version <= 9 ? 8 : 16;
  return Math.floor((dataCapacityBytes(version) * 8 - 4 - countBits) / 8);
}

// ---- Format info (error correction level + mask pattern), 15 bits ----
// BCH(15,5) generator 0x537, XOR mask 0x5412, error-correction-level bits
// for H = "10".
const FORMAT_GENERATOR = 0x537;
const FORMAT_MASK = 0x5412;
const EC_LEVEL_BITS_H = 0b10;

export function encodeFormatInfo(maskPattern) {
  const data = (EC_LEVEL_BITS_H << 3) | maskPattern; // 5 bits
  let bch = data << 10;
  for (let i = 14; i >= 10; i--) {
    if (bch & (1 << i)) bch ^= FORMAT_GENERATOR << (i - 10);
  }
  return ((data << 10) | bch) ^ FORMAT_MASK;
}

// Decodes a 15-bit format info value, correcting up to 3 bit errors by
// brute-force comparison against all 32 valid codewords (cheap and exact).
export function decodeFormatInfo(bits) {
  const raw = bits ^ FORMAT_MASK;
  let best = null;
  let bestDist = Infinity;
  for (let m = 0; m < 8; m++) {
    const candidate = encodeFormatInfo(m) ^ FORMAT_MASK; // pre-XOR raw form
    const dist = popcount(raw ^ candidate);
    if (dist < bestDist) {
      bestDist = dist;
      best = m;
    }
  }
  if (bestDist > 3) return null;
  return { maskPattern: best };
}

function popcount(n) {
  let c = 0;
  while (n) {
    c += n & 1;
    n >>>= 1;
  }
  return c;
}

// ---- Version info (versions 7+), 18 bits: 6 data + 12 BCH ----
const VERSION_GENERATOR = 0x1f25;

export function encodeVersionInfo(version) {
  let bch = version << 12;
  for (let i = 17; i >= 12; i--) {
    if (bch & (1 << i)) bch ^= VERSION_GENERATOR << (i - 12);
  }
  return (version << 12) | bch;
}

export function decodeVersionInfo(bits18) {
  let best = null;
  let bestDist = Infinity;
  for (let v = 7; v <= 27; v++) {
    const candidate = encodeVersionInfo(v);
    const dist = popcount(bits18 ^ candidate);
    if (dist < bestDist) {
      bestDist = dist;
      best = v;
    }
  }
  if (bestDist > 3) return null;
  return best;
}

// ---- Data masking patterns ----
export const MASK_FUNCTIONS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];
