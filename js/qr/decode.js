import { rsDecode } from './reed-solomon.js';
import { VERSION_INFO_H, MASK_FUNCTIONS, decodeFormatInfo } from './tables.js';
import {
  buildFunctionPatterns,
  dataModuleOrder,
  readFormatInfoBitsTopLeft,
  readFormatInfoBitsOther,
} from './structure.js';

function deinterleaveBlocks(codewords, version) {
  const info = VERSION_INFO_H[version];
  const blockDataLens = [];
  for (const [count, dataLen] of info.groups) {
    for (let i = 0; i < count; i++) blockDataLens.push(dataLen);
  }
  const numBlocks = blockDataLens.length;
  const maxDataLen = Math.max(...blockDataLens);

  const blockData = blockDataLens.map(() => []);
  let pos = 0;
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < blockDataLens[b]) {
        blockData[b].push(codewords[pos]);
        pos++;
      }
    }
  }
  const blockEc = blockDataLens.map(() => []);
  for (let i = 0; i < info.ecPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) {
      blockEc[b].push(codewords[pos]);
      pos++;
    }
  }
  return blockDataLens.map((dataLen, b) => ({
    data: blockData[b],
    ec: blockEc[b],
    ecPerBlock: info.ecPerBlock,
  }));
}

function readBits(bytes, bitOffset, numBits) {
  let result = 0;
  for (let i = 0; i < numBits; i++) {
    const idx = bitOffset + i;
    const byteIndex = Math.floor(idx / 8);
    const bitIndexInByte = 7 - (idx % 8);
    const byte = byteIndex < bytes.length ? bytes[byteIndex] : 0;
    const bit = (byte >> bitIndexInByte) & 1;
    result = (result << 1) | bit;
  }
  return result;
}

function parseByteModeMessage(dataCodewords, version) {
  let offset = 0;
  const mode = readBits(dataCodewords, offset, 4);
  offset += 4;
  if (mode !== 0b0100) {
    throw new Error('未対応の形式のQRコードです');
  }
  const countBits = version <= 9 ? 8 : 16;
  const length = readBits(dataCodewords, offset, countBits);
  offset += countBits;
  const bytes = [];
  for (let i = 0; i < length; i++) {
    bytes.push(readBits(dataCodewords, offset, 8));
    offset += 8;
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

// Decodes a raw module grid (modules[r][c] === true for a dark module,
// `size` x `size`) back into the original text, correcting errors from
// the embedded design thumbnail (or other damage) via Reed-Solomon.
export function decodeMatrix(size, modules) {
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 27) {
    throw new Error('対応していないQRコードのサイズです');
  }

  const m = buildFunctionPatterns(size, version);

  let formatBits = readFormatInfoBitsTopLeft(modules, size);
  let format = decodeFormatInfo(formatBits);
  if (!format) {
    formatBits = readFormatInfoBitsOther(modules, size);
    format = decodeFormatInfo(formatBits);
  }
  if (!format) {
    throw new Error('QRコードの形式情報を読み取れませんでした');
  }

  const maskFn = MASK_FUNCTIONS[format.maskPattern];
  const unmasked = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) =>
      m.reserved[r][c] ? modules[r][c] : modules[r][c] !== maskFn(r, c)
    )
  );

  const order = dataModuleOrder(m);
  const bits = order.map(([r, c]) => (unmasked[r][c] ? 1 : 0));
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }

  const blocks = deinterleaveBlocks(codewords, version);
  const dataCodewords = [];
  for (const block of blocks) {
    const combined = block.data.concat(block.ec);
    const result = rsDecode(combined, block.ecPerBlock);
    if (!result.ok) {
      throw new Error('QRコードのデータを復元できませんでした（損傷が大きすぎます）');
    }
    dataCodewords.push(...result.corrected.slice(0, block.data.length));
  }

  return parseByteModeMessage(dataCodewords, version);
}
