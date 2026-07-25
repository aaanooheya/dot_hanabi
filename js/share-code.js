// Packs a firework design into a compact code, and unpacks it back. No
// backend involved: the code itself carries the data. It's meant to be
// embedded in a shareable URL (see index.html / editor.html's `?d=`
// handling) rather than typed by hand, so raw length isn't a hard limit --
// it just needs to be safe to put in a URL, hence alphanumeric-only.
//
// Layout -- every field is fixed-width or preceded by an explicit base62
// length, so the decoder can walk the string positionally with no
// delimiter characters at all:
//
//   "H5"                  format tag
//   <2>                   grid size (base62, fixed width)
//   <1>                   number of distinct colors used (base62 digit)
//   <6 * colorCount>      that many hex colors, 6 chars each, no '#'
//   <2>                   name length in UTF-8 bytes (base62, fixed width)
//   <ceil(bytes*8/log2(62))>  the name, base62 of its raw UTF-8 bytes
//   'R' or 'S' + rest     pixel data (see below)
//
// Pixel data is stored whichever of two ways comes out shorter:
//   'R' + a run-length scan: runs shorter than RLE_MIN_RUN are written as
//        literal repeated characters (cheap for high-entropy patterns like
//        stripes), longer runs become an escaped <2-char length><1-char
//        value> token. The last alphabet character ('Z') is reserved as
//        that escape marker, so colors are capped at 60 (still plenty) to
//        guarantee it never collides with a real color/empty code.
//   'S' + a sparse coordinate list: <2-char count>, then a <2-char index>
//        <1-char value> triple per colored cell -- wins for a handful of
//        scattered pixels on a big canvas.

const FORMAT_TAG = 'H5';
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const RLE_ESCAPE = ALPHABET[ALPHABET.length - 1]; // 'Z', reserved
const RLE_MIN_RUN = 5;
const BASE = 62n;
const BITS_PER_DIGIT = Math.log2(62);
const MAX_2CHAR = 62 * 62 - 1; // 3843

function enc2(n) {
  if (n < 0 || n > MAX_2CHAR) throw new Error('value out of range');
  return ALPHABET[Math.floor(n / 62)] + ALPHABET[n % 62];
}

function dec2(pair) {
  if (!pair || pair.length < 2) throw new Error('truncated');
  const hi = ALPHABET.indexOf(pair[0]);
  const lo = ALPHABET.indexOf(pair[1]);
  if (hi < 0 || lo < 0) throw new Error('bad digit');
  return hi * 62 + lo;
}

function enc1(n) {
  if (n < 0 || n > 61) throw new Error('value out of range');
  return ALPHABET[n];
}

function dec1(ch) {
  const v = ALPHABET.indexOf(ch);
  if (v < 0) throw new Error('bad digit');
  return v;
}

function bytesToBase62(bytes) {
  if (bytes.length === 0) return '';
  const width = Math.ceil((bytes.length * 8) / BITS_PER_DIGIT);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < width; i++) {
    out = ALPHABET[Number(n % BASE)] + out;
    n /= BASE;
  }
  return out;
}

function base62ToBytes(str, byteLength) {
  let n = 0n;
  for (const ch of str) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('bad digit');
    n = n * BASE + BigInt(v);
  }
  const bytes = new Uint8Array(byteLength);
  for (let i = byteLength - 1; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return bytes;
}

function rlePackedEncode(data) {
  let out = '';
  let i = 0;
  while (i < data.length) {
    let j = i;
    while (j < data.length && data[j] === data[i]) j++;
    const runLen = j - i;
    if (runLen >= RLE_MIN_RUN) {
      out += RLE_ESCAPE + enc2(runLen) + data[i];
    } else {
      out += data[i].repeat(runLen);
    }
    i = j;
  }
  return out;
}

function rlePackedDecode(str, totalLen) {
  let out = '';
  let i = 0;
  while (out.length < totalLen) {
    if (str[i] === RLE_ESCAPE) {
      const count = dec2(str.slice(i + 1, i + 3));
      const ch = str[i + 3];
      if (ch === undefined) throw new Error('truncated');
      out += ch.repeat(count);
      i += 4;
    } else {
      const ch = str[i];
      if (ch === undefined) throw new Error('truncated');
      out += ch;
      i += 1;
    }
  }
  return out;
}

function sparseEncode(data) {
  const cells = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== '0') cells.push(i);
  }
  let out = enc2(cells.length);
  for (const i of cells) out += enc2(i) + data[i];
  return out;
}

function sparseDecode(str, totalLen) {
  const count = dec2(str.slice(0, 2));
  const cells = new Array(totalLen).fill('0');
  let pos = 2;
  for (let k = 0; k < count; k++) {
    const i = dec2(str.slice(pos, pos + 2));
    const ch = str[pos + 2];
    if (ch === undefined) throw new Error('truncated');
    cells[i] = ch;
    pos += 3;
  }
  return cells.join('');
}

function encodePixelField(data) {
  const rle = 'R' + rlePackedEncode(data);
  const sparse = 'S' + sparseEncode(data);
  return sparse.length < rle.length ? sparse : rle;
}

function decodePixelField(field, totalLen) {
  const mode = field[0];
  const body = field.slice(1);
  return mode === 'S' ? sparseDecode(body, totalLen) : rlePackedDecode(body, totalLen);
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
        // ALPHABET.length - 1 ('Z') is reserved as the RLE escape marker.
        if (idx >= ALPHABET.length - 1) {
          throw new Error('色数が多すぎて共有コードを作成できません');
        }
        colorIndex.set(c, idx);
      }
      data += ALPHABET[idx];
    }
  }

  const nameBytes = new TextEncoder().encode(fw.name || '');
  if (nameBytes.length > MAX_2CHAR) {
    throw new Error('花火の名前が長すぎて共有コードを作成できません');
  }

  return (
    FORMAT_TAG +
    enc2(fw.size) +
    enc1(colors.length) +
    colors.map((c) => c.replace(/^#/, '')).join('') +
    enc2(nameBytes.length) +
    bytesToBase62(nameBytes) +
    encodePixelField(data)
  );
}

export function decodeShareCode(code) {
  const s = (code || '').trim();
  try {
    if (!/^[0-9a-zA-Z]+$/.test(s)) throw new Error('bad charset');

    let pos = 0;
    const take = (n) => {
      if (pos + n > s.length) throw new Error('truncated');
      const part = s.slice(pos, pos + n);
      pos += n;
      return part;
    };

    if (take(2) !== FORMAT_TAG) throw new Error('bad tag');

    const size = dec2(take(2));
    if (!Number.isInteger(size) || size <= 0 || size > 100) throw new Error('bad size');

    const colorCount = dec1(take(1));
    const colors = [];
    for (let i = 0; i < colorCount; i++) colors.push('#' + take(6));

    const nameByteLen = dec2(take(2));
    const nameWidth = nameByteLen === 0 ? 0 : Math.ceil((nameByteLen * 8) / BITS_PER_DIGIT);
    const nameField = take(nameWidth);

    const pixelField = s.slice(pos);
    const data = decodePixelField(pixelField, size * size);
    if (data.length !== size * size) throw new Error('bad pixel length');

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
    if (nameByteLen > 0) {
      const bytes = base62ToBytes(nameField, nameByteLen);
      const decoded = new TextDecoder().decode(bytes);
      if (decoded) name = decoded;
    }

    return { name, size, pixels };
  } catch {
    throw new Error('コードの形式が正しくありません');
  }
}
