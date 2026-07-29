// GF(256) arithmetic used by QR's Reed-Solomon error correction, with the
// primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D) specified by
// ISO/IEC 18004.

const EXP = new Array(512);
const LOG = new Array(256);

(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

export function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

export function gfDiv(a, b) {
  if (a === 0) return 0;
  if (b === 0) throw new Error('division by zero in GF(256)');
  return EXP[(LOG[a] - LOG[b] + 255) % 255];
}

export function gfExp(n) {
  return EXP[((n % 255) + 255) % 255];
}

export function gfLog(n) {
  if (n === 0) throw new Error('log(0) undefined in GF(256)');
  return LOG[n];
}

// Multiplies two polynomials over GF(256). Coefficients are ordered
// highest-degree-first, matching how QR codeword arrays are treated.
export function polyMulGF(p1, p2) {
  const result = new Array(p1.length + p2.length - 1).fill(0);
  for (let i = 0; i < p1.length; i++) {
    if (p1[i] === 0) continue;
    for (let j = 0; j < p2.length; j++) {
      result[i + j] ^= gfMul(p1[i], p2[j]);
    }
  }
  return result;
}

// Evaluates a polynomial (highest-degree-first coefficients) at x via
// Horner's method in GF(256).
export function polyEvalGF(poly, x) {
  let y = poly[0];
  for (let i = 1; i < poly.length; i++) {
    y = gfMul(y, x) ^ poly[i];
  }
  return y;
}
