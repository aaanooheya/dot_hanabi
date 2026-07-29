// Packs a firework design into a compact binary "recipe" -- meant to be
// base64url-wrapped and embedded in a share URL, which is what actually
// gets put in the QR code (so a generic phone camera app can open it
// directly). Byte-oriented rather than text-safe, since it's wrapped in
// base64url immediately afterward rather than being typed/copied by hand.
//
// Layout:
//   [0]        format version (1)
//   [1]        grid size
//   [2]        color count
//   [3-4]      name length in UTF-8 bytes (u16 big-endian)
//   [...]      name, raw UTF-8 bytes
//   [...]      color count * 3 bytes (R,G,B per color)
//   [1]        pixel mode: 0 = RLE, 1 = sparse
//   [...]      pixel data (see rleEncode/sparseEncode)
//
// Pixel-data run-lengths/indices are 1 byte wide when the grid has 255
// cells or fewer (5x5, 15x15) and 2 bytes wide otherwise (30x30) -- this
// is derived from `size` alone, known before the pixel section is parsed,
// so no extra flag byte is needed for it.

const RLE_ESCAPE = 255;
const MAX_COLOR_INDEX = 254; // 255 is reserved as the RLE escape marker

function u16(n) {
  return [(n >> 8) & 0xff, n & 0xff];
}

function readU16(bytes, pos) {
  return (bytes[pos] << 8) | bytes[pos + 1];
}

function widthFor(totalCells) {
  return totalCells <= 255 ? 1 : 2;
}

function writeNum(n, width) {
  return width === 1 ? [n & 0xff] : u16(n);
}

function readNum(bytes, pos, width) {
  return width === 1 ? bytes[pos] : readU16(bytes, pos);
}

function rleEncode(cells, width) {
  const tokenCost = 2 + width; // escape byte + length + value byte
  const out = [];
  let i = 0;
  while (i < cells.length) {
    let j = i;
    while (j < cells.length && cells[j] === cells[i]) j++;
    const runLen = j - i;
    if (runLen >= tokenCost) {
      out.push(RLE_ESCAPE, ...writeNum(runLen, width), cells[i]);
    } else {
      for (let k = 0; k < runLen; k++) out.push(cells[i]);
    }
    i = j;
  }
  return out;
}

function rleDecode(bytes, startPos, totalLen, width) {
  const cells = [];
  let pos = startPos;
  while (cells.length < totalLen) {
    if (pos >= bytes.length) throw new Error('truncated RLE data');
    const b = bytes[pos++];
    if (b === RLE_ESCAPE) {
      if (pos + width + 1 > bytes.length) throw new Error('truncated RLE token');
      const len = readNum(bytes, pos, width);
      pos += width;
      const val = bytes[pos++];
      for (let k = 0; k < len; k++) cells.push(val);
    } else {
      cells.push(b);
    }
  }
  return { cells, pos };
}

function sparseEncode(cells, width) {
  const nonEmpty = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== 0) nonEmpty.push(i);
  }
  const out = [...writeNum(nonEmpty.length, width)];
  for (const i of nonEmpty) out.push(...writeNum(i, width), cells[i]);
  return out;
}

function sparseDecode(bytes, startPos, width) {
  let pos = startPos;
  if (pos + width > bytes.length) throw new Error('truncated sparse header');
  const count = readNum(bytes, pos, width);
  pos += width;
  const entries = [];
  for (let k = 0; k < count; k++) {
    if (pos + width + 1 > bytes.length) throw new Error('truncated sparse entry');
    const idx = readNum(bytes, pos, width);
    pos += width;
    const val = bytes[pos++];
    entries.push([idx, val]);
  }
  return { entries, pos };
}

export function encodeRecipe(fw) {
  const colors = [];
  const colorIndex = new Map();
  const cells = [];

  for (let y = 0; y < fw.size; y++) {
    for (let x = 0; x < fw.size; x++) {
      const c = fw.pixels[y][x];
      if (!c) {
        cells.push(0);
        continue;
      }
      let idx = colorIndex.get(c);
      if (idx === undefined) {
        colors.push(c);
        idx = colors.length;
        if (idx > MAX_COLOR_INDEX) {
          throw new Error('色数が多すぎてレシピを作成できません');
        }
        colorIndex.set(c, idx);
      }
      cells.push(idx);
    }
  }

  const width = widthFor(cells.length);
  const rle = rleEncode(cells, width);
  const sparse = sparseEncode(cells, width);
  const useSparse = sparse.length < rle.length;
  const pixelBytes = useSparse ? sparse : rle;

  const nameBytes = Array.from(new TextEncoder().encode(fw.name || ''));
  if (nameBytes.length > 0xffff) {
    throw new Error('花火の名前が長すぎてレシピを作成できません');
  }

  const colorBytes = [];
  for (const c of colors) {
    const hex = c.replace(/^#/, '');
    colorBytes.push(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16));
  }

  return [
    1,
    fw.size,
    colors.length,
    ...u16(nameBytes.length),
    ...nameBytes,
    ...colorBytes,
    useSparse ? 1 : 0,
    ...pixelBytes,
  ];
}

export function decodeRecipe(bytesInput) {
  const bytes = Array.from(bytesInput);
  let pos = 0;
  const take = (n) => {
    if (pos + n > bytes.length) throw new Error('レシピの形式が正しくありません');
    const slice = bytes.slice(pos, pos + n);
    pos += n;
    return slice;
  };

  try {
    const [formatVersion] = take(1);
    if (formatVersion !== 1) throw new Error('未対応のレシピ形式です');

    const [size] = take(1);
    if (!(size > 0 && size <= 100)) throw new Error('レシピの形式が正しくありません');

    const [colorCount] = take(1);
    const nameLen = readU16(take(2), 0);
    const nameBytes = take(nameLen);
    let name = '無題の花火';
    const decodedName = new TextDecoder().decode(Uint8Array.from(nameBytes));
    if (decodedName) name = decodedName;

    const colors = [];
    for (let i = 0; i < colorCount; i++) {
      const [r, g, b] = take(3);
      colors.push('#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''));
    }

    const [mode] = take(1);
    const totalCells = size * size;
    const width = widthFor(totalCells);
    const cells = new Array(totalCells).fill(0);

    if (mode === 1) {
      const { entries, pos: newPos } = sparseDecode(bytes, pos, width);
      for (const [idx, val] of entries) {
        if (idx >= 0 && idx < totalCells) cells[idx] = val;
      }
      pos = newPos;
    } else {
      const { cells: rleCells, pos: newPos } = rleDecode(bytes, pos, totalCells, width);
      for (let i = 0; i < totalCells; i++) cells[i] = rleCells[i];
      pos = newPos;
    }

    const pixels = [];
    for (let y = 0; y < size; y++) {
      const row = [];
      for (let x = 0; x < size; x++) {
        const v = cells[y * size + x];
        row.push(v === 0 ? null : colors[v - 1] ?? null);
      }
      pixels.push(row);
    }

    return { name, size, pixels };
  } catch (err) {
    throw new Error(err.message || 'レシピの形式が正しくありません');
  }
}
