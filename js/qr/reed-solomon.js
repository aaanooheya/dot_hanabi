// Reed-Solomon encode (for generating QR codes) and decode (for recovering
// data from a QR whose modules were partly overwritten by the embedded
// design thumbnail, or otherwise corrupted).

import { gfMul, gfDiv, gfExp, polyMulGF, polyEvalGF } from './galois.js';

// Generator polynomial with `degree` roots at alpha^0..alpha^(degree-1),
// highest-degree-first.
function generatorPoly(degree) {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    g = polyMulGF(g, [1, gfExp(i)]);
  }
  return g;
}

// data: array of byte values (data codewords). Returns the `ecCount` error
// correction codewords to append.
export function rsEncode(data, ecCount) {
  const generator = generatorPoly(ecCount);
  const result = data.concat(new Array(ecCount).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = result[i];
    if (coef !== 0) {
      for (let j = 0; j < generator.length; j++) {
        result[i + j] ^= gfMul(generator[j], coef);
      }
    }
  }
  return result.slice(data.length);
}

function calcSyndromes(codewords, ecCount) {
  const syndromes = new Array(ecCount).fill(0);
  let hasError = false;
  for (let i = 0; i < ecCount; i++) {
    const s = polyEvalGF(codewords, gfExp(i));
    syndromes[i] = s;
    if (s !== 0) hasError = true;
  }
  return { syndromes, hasError };
}

// Berlekamp-Massey: derives the error locator polynomial from the syndrome
// sequence. Returns coefficients low-degree-first (C[0] is always 1).
function berlekampMassey(syndromes) {
  let C = [1];
  let B = [1];
  let L = 0;
  let m = 1;
  let b = 1;

  for (let n = 0; n < syndromes.length; n++) {
    let delta = syndromes[n];
    for (let i = 1; i <= L; i++) {
      delta ^= gfMul(C[i] || 0, syndromes[n - i]);
    }
    if (delta === 0) {
      m += 1;
    } else {
      const coef = gfDiv(delta, b);
      const shifted = new Array(m).fill(0).concat(B.map((v) => gfMul(v, coef)));
      const newLen = Math.max(C.length, shifted.length);
      const newC = new Array(newLen).fill(0);
      for (let i = 0; i < C.length; i++) newC[i] ^= C[i];
      for (let i = 0; i < shifted.length; i++) newC[i] ^= shifted[i];
      if (2 * L <= n) {
        B = C;
        L = n + 1 - L;
        b = delta;
        m = 1;
      } else {
        m += 1;
      }
      C = newC;
    }
  }
  return { locatorLowFirst: C.slice(0, L + 1), errorCount: L };
}

// Chien search: finds the codeword positions (0-indexed from the start of
// the highest-degree-first array) where errors occurred, by testing which
// alpha powers are roots of the error locator polynomial.
function findErrorPositions(locatorLowFirst, codewordLen) {
  const positions = [];
  for (let j = 0; j < codewordLen; j++) {
    // Position j (from the start, high-degree-first) corresponds to the
    // term of degree (codewordLen - 1 - j), i.e. locator variable
    // X = alpha^(codewordLen - 1 - j). An error sits there iff
    // Lambda(X^-1) == 0, i.e. Lambda(alpha^-(codewordLen-1-j)) == 0.
    const exp = -(codewordLen - 1 - j);
    const xInv = gfExp(exp);
    let y = 0;
    for (let k = 0; k < locatorLowFirst.length; k++) {
      // Lambda(xInv) = sum locatorLowFirst[k] * xInv^k
      y ^= gfMul(locatorLowFirst[k], gfExp((k * ((exp % 255) + 255)) % 255));
    }
    if (y === 0) positions.push(j);
  }
  return positions;
}

// Forney algorithm: computes the magnitude (correction value) for each
// error position.
function findErrorMagnitudes(syndromes, locatorLowFirst, errorPositions, codewordLen) {
  // Error evaluator polynomial Omega(x) = S(x) * Lambda(x) mod x^ecCount,
  // both treated low-degree-first for this step.
  const sLowFirst = syndromes.slice(); // S(x) = S0 + S1 x + ...
  const omega = new Array(sLowFirst.length + locatorLowFirst.length - 1).fill(0);
  for (let i = 0; i < sLowFirst.length; i++) {
    if (sLowFirst[i] === 0) continue;
    for (let j = 0; j < locatorLowFirst.length; j++) {
      omega[i + j] ^= gfMul(sLowFirst[i], locatorLowFirst[j]);
    }
  }
  const omegaTrunc = omega.slice(0, sLowFirst.length);

  // Formal derivative of Lambda(x), low-degree-first: drops even-index
  // (in x^k, k even) terms, since d/dx x^k = k*x^(k-1) and k is mod 2 in
  // GF(2^m) arithmetic (even coefficients vanish).
  const lambdaDeriv = [];
  for (let k = 1; k < locatorLowFirst.length; k++) {
    if (k % 2 === 1) lambdaDeriv.push(locatorLowFirst[k]);
    else lambdaDeriv.push(0);
  }

  function evalLowFirst(poly, x) {
    let y = 0;
    let xPow = 1;
    for (let i = 0; i < poly.length; i++) {
      y ^= gfMul(poly[i], xPow);
      xPow = gfMul(xPow, x);
    }
    return y;
  }

  const magnitudes = [];
  for (const pos of errorPositions) {
    const exp = -(codewordLen - 1 - pos);
    const xInv = gfExp(exp);
    const xVal = gfExp(codewordLen - 1 - pos); // X_k = alpha^(degree)
    const omegaVal = evalLowFirst(omegaTrunc, xInv);
    const lambdaDerivVal = evalLowFirst(lambdaDeriv, xInv);
    if (lambdaDerivVal === 0) {
      magnitudes.push(null); // decoding failure
      continue;
    }
    // e_k = X_k * Omega(X_k^-1) / Lambda'(X_k^-1)  (Forney's formula)
    const mag = gfMul(xVal, gfDiv(omegaVal, lambdaDerivVal));
    magnitudes.push(mag);
  }
  return magnitudes;
}

// Attempts to correct `codewords` (highest-degree-first, length = data +
// ecCount) in place using its trailing `ecCount` error-correction bytes.
// Returns { ok, corrected, errorCount }. `ok` is false if errors were
// detected but could not be fully corrected.
export function rsDecode(codewords, ecCount) {
  const { syndromes, hasError } = calcSyndromes(codewords, ecCount);
  if (!hasError) {
    return { ok: true, corrected: codewords.slice(), errorCount: 0 };
  }

  const { locatorLowFirst, errorCount } = berlekampMassey(syndromes);
  if (errorCount === 0 || errorCount > ecCount / 2) {
    return { ok: false, corrected: null, errorCount };
  }

  const positions = findErrorPositions(locatorLowFirst, codewords.length);
  if (positions.length !== errorCount) {
    // Chien search didn't find as many roots as the locator degree implies
    // -- uncorrectable.
    return { ok: false, corrected: null, errorCount };
  }

  const magnitudes = findErrorMagnitudes(syndromes, locatorLowFirst, positions, codewords.length);
  if (magnitudes.some((m) => m === null)) {
    return { ok: false, corrected: null, errorCount };
  }

  const corrected = codewords.slice();
  positions.forEach((pos, i) => {
    corrected[pos] ^= magnitudes[i];
  });

  const check = calcSyndromes(corrected, ecCount);
  if (check.hasError) {
    return { ok: false, corrected: null, errorCount };
  }

  return { ok: true, corrected, errorCount };
}
