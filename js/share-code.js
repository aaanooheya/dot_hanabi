// Packs a firework design into a short, copy-pasteable text code, and
// unpacks it back. No backend involved: the code itself carries the data.
//
// Layout (plain text, no outer wrapping -- every field already uses only
// pipe-safe characters, so wrapping the whole thing in base64 would just
// waste ~33% more space for no benefit):
//   H2|<size>|<hexcolor1,hexcolor2,...>|<base64url name>|<mode><pixel-data>
//
// Pixel data maps each cell to a single character: '0' for empty, or a
// letter/digit indexing into the color list (ALPHABET[1] = colors[0], ...).
// It's stored one of two ways, whichever comes out shorter for this
// particular design:
//   'R' + run-length-encoded full scan ("#<count>:<char>" for runs of 5+) --
//        wins for designs with big blocks of one color (or mostly empty).
//   'S' + a sparse coordinate list (count, then <2-char index><color> per
//        colored cell) -- wins for a few scattered pixels on a big canvas.
// The name is base64url of its raw UTF-8 bytes rather than percent-encoded
// -- percent-encoding costs 3 chars per byte, base64 costs ~1.37.

const FORMAT_TAG = 'H2';
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const RLE_MIN_RUN = 5;

function rleEncode(str) {
  let out = '';
  let i = 0;
  while (i < str.length) {
    let j = i;
    while (j < str.length && str[j] === str[i]) j++;
    const runLen = j - i;
    if (runLen >= RLE_MIN_RUN) {
      out += `#${runLen}:${str[i]}`;
    } else {
      out += str[i].repeat(runLen);
    }
    i = j;
  }
  return out;
}

function rleDecode(str) {
  let out = '';
  let i = 0;
  while (i < str.length) {
    if (str[i] === '#') {
      const sep = str.indexOf(':', i + 1);
      const count = Number(str.slice(i + 1, sep));
      const ch = str[sep + 1];
      out += ch.repeat(count);
      i = sep + 2;
    } else {
      out += str[i];
      i += 1;
    }
  }
  return out;
}

// Fixed 2-char base62 index, big enough for any grid up to 62*62=3844 cells
// (far past our largest 30x30 = 900 cell grid).
function encodeIndex(n) {
  return ALPHABET[Math.floor(n / 62)] + ALPHABET[n % 62];
}

function decodeIndex(pair) {
  return ALPHABET.indexOf(pair[0]) * 62 + ALPHABET.indexOf(pair[1]);
}

function sparseEncode(data) {
  const cells = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== '0') cells.push(i);
  }
  let out = encodeIndex(cells.length);
  for (const i of cells) out += encodeIndex(i) + data[i];
  return out;
}

function sparseDecode(str, totalLen) {
  const count = decodeIndex(str.slice(0, 2));
  const cells = new Array(totalLen).fill('0');
  let pos = 2;
  for (let k = 0; k < count; k++) {
    const i = decodeIndex(str.slice(pos, pos + 2));
    cells[i] = str[pos + 2];
    pos += 3;
  }
  return cells.join('');
}

function encodePixelField(data) {
  const rle = 'R' + rleEncode(data);
  const sparse = 'S' + sparseEncode(data);
  return sparse.length < rle.length ? sparse : rle;
}

function decodePixelField(field, totalLen) {
  const mode = field[0];
  const body = field.slice(1);
  return mode === 'S' ? sparseDecode(body, totalLen) : rleDecode(body);
}

function toBase64Url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code) {
  let b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return atob(b64);
}

function encodeName(name) {
  const bytes = new TextEncoder().encode(name || '');
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return toBase64Url(binary);
}

function decodeName(field) {
  if (!field) return '';
  const binary = fromBase64Url(field);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeFirework(fw) {
  const colors = [];
  const colorIndex = new Map();
  let data = '';

  for (let y = 0; y < fw.size; y++) {
    for (let x = 0; x < fw.size; x++) {
      const c = fw.pixels[y][x];
      if (!c) {
        data += '0';
        continue;
      }
      let idx = colorIndex.get(c);
      if (idx === undefined) {
        colors.push(c);
        idx = colors.length; // 1-based; ALPHABET[0] means empty
        if (idx >= ALPHABET.length) {
          throw new Error('色数が多すぎて共有コードを作成できません');
        }
        colorIndex.set(c, idx);
      }
      data += ALPHABET[idx];
    }
  }

  const colorField = colors.map((c) => c.replace(/^#/, '')).join(',');

  return [
    FORMAT_TAG,
    String(fw.size),
    colorField,
    encodeName(fw.name),
    encodePixelField(data),
  ].join('|');
}

export function decodeShareCode(code) {
  const parts = (code || '').trim().split('|');
  if (parts.length !== 5 || parts[0] !== FORMAT_TAG) {
    throw new Error('コードの形式が正しくありません');
  }
  const [, sizeStr, colorsStr, nameField, pixelField] = parts;

  const size = Number(sizeStr);
  if (!Number.isInteger(size) || size <= 0 || size > 100) {
    throw new Error('コードの形式が正しくありません');
  }

  const colors = colorsStr.length ? colorsStr.split(',').map((c) => `#${c}`) : [];
  const data = decodePixelField(pixelField, size * size);
  if (data.length !== size * size) {
    throw new Error('コードの形式が正しくありません');
  }

  const pixels = [];
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) {
      const ch = data[y * size + x];
      if (ch === '0') {
        row.push(null);
      } else {
        const idx = ALPHABET.indexOf(ch);
        row.push(idx > 0 ? colors[idx - 1] ?? null : null);
      }
    }
    pixels.push(row);
  }

  let name = '無題の花火';
  try {
    const decoded = decodeName(nameField);
    if (decoded) name = decoded;
  } catch {
    // keep default name if the field is somehow malformed
  }

  return { name, size, pixels };
}
