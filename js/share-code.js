// Packs a firework design into a short, copy-pasteable text code, and
// unpacks it back. No backend involved: the code itself carries the data.
//
// Layout (before base64url wrapping):
//   HAN1|<size>|<color1,color2,...>|<uriEncodedName>|<rle-pixel-data>
//
// Pixel data maps each cell to a single character: '0' for empty, or a
// letter/digit indexing into the color list (ALPHABET[1] = colors[0], ...).
// Runs of 5+ identical characters are RLE-compressed as "#<count>:<char>",
// which keeps typical sparse pixel art short.

const FORMAT_TAG = 'HAN1';
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

function toBase64Url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code) {
  let b64 = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return atob(b64);
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

  const raw = [
    FORMAT_TAG,
    String(fw.size),
    colors.join(','),
    encodeURIComponent(fw.name || ''),
    rleEncode(data),
  ].join('|');

  return toBase64Url(raw);
}

export function decodeShareCode(code) {
  let raw;
  try {
    raw = fromBase64Url(code);
  } catch {
    throw new Error('コードの形式が正しくありません');
  }

  const parts = raw.split('|');
  if (parts.length !== 5 || parts[0] !== FORMAT_TAG) {
    throw new Error('コードの形式が正しくありません');
  }
  const [, sizeStr, colorsStr, nameField, rle] = parts;

  const size = Number(sizeStr);
  if (!Number.isInteger(size) || size <= 0 || size > 100) {
    throw new Error('コードの形式が正しくありません');
  }

  const colors = colorsStr.length ? colorsStr.split(',') : [];
  const data = rleDecode(rle);
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
    name = decodeURIComponent(nameField) || name;
  } catch {
    // keep default name if the field is somehow malformed
  }

  return { name, size, pixels };
}
