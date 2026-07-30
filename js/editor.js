import { PALETTE, createEmptyGrid, drawGridToCanvas } from './pixel-grid.js';
import { getFireworks, getFirework, saveFirework, deleteFirework, generateId } from './storage.js';
import { Firework } from './firework.js';
import { unlockAudio, initMuteButton, playExplosionBoom } from './sound.js';
import { encodeRecipe, decodeRecipe } from './recipe.js';
import { bytesToBase64Url, base64UrlToBytes } from './base64url.js';
import { encodeQrMatrix } from './qr/encode.js';
import { renderQrToCanvas } from './qr/render.js';
import { readQrFromImage } from './qr/read-image.js';
import { renderDesignToCanvas } from './design-thumbnail.js';
import { dataCapacityBytes } from './qr/tables.js';

initMuteButton(document.getElementById('mute-btn'));
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

const GRID_RESOLUTION = 450; // internal canvas pixels (square)

let size = 15;
let grid = createEmptyGrid(size);
let symmetryPoint = true;
let symmetryLine = false;
let currentColor = PALETTE[0];
let tool = 'paint'; // 'paint' | 'erase' | 'eyedropper' | 'move'
let currentId = null;
let painting = false;

let undoStack = [];
let redoStack = [];
let moveStartSnapshot = null;
let moveStartCell = null;

// Blinks the save button whenever there's drawn content that hasn't been
// saved yet, so it's obvious you still need to press it.
const saveBtn = document.getElementById('save-btn');
let dirty = false;
function updateSaveBlink() {
  saveBtn.classList.toggle('blink', dirty && grid.flat().some(Boolean));
}

// Warns before leaving (closing the tab, reloading, or following a link
// like "戻る") while there's unsaved drawing. The browser shows its own
// generic confirmation text -- custom messages here are ignored by every
// modern browser, so returnValue is just set to trigger the prompt at all.
window.addEventListener('beforeunload', (e) => {
  if (dirty && grid.flat().some(Boolean)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Recipe QR capacity gauge: mirrors buildRecipeUrl()'s output length against
// the largest QR version we support (27), so a design that's grown too big
// to fit shows red *before* pressing "レシピ" and hitting the QR error.
const MAX_RECIPE_URL_BYTES = dataCapacityBytes(27) - 2;
const capacityFill = document.getElementById('capacity-gauge-fill');
const capacityText = document.getElementById('capacity-gauge-text');

function currentRecipeUrlByteLength() {
  const name = document.getElementById('name-input').value.trim() || '無題の花火';
  const recipeBytes = encodeRecipe({ name, size, pixels: grid });
  const code = bytesToBase64Url(recipeBytes);
  const dirPath = location.pathname.replace(/[^/]*$/, '');
  return new TextEncoder().encode(`${location.origin}${dirPath}#${code}`).length;
}

function updateCapacityGauge() {
  if (!grid.flat().some(Boolean)) {
    capacityFill.style.width = '0%';
    capacityFill.className = 'capacity-gauge-fill ok';
    capacityText.textContent = '0%';
    return;
  }
  let bytes;
  try {
    bytes = currentRecipeUrlByteLength();
  } catch (err) {
    capacityFill.style.width = '100%';
    capacityFill.className = 'capacity-gauge-fill danger';
    capacityText.textContent = err.message || '容量オーバー';
    return;
  }
  const rawPercent = (bytes / MAX_RECIPE_URL_BYTES) * 100;
  const over = rawPercent > 100;
  capacityFill.style.width = `${Math.min(100, rawPercent)}%`;
  capacityFill.className = 'capacity-gauge-fill' + (over ? ' danger' : rawPercent >= 80 ? ' warn' : ' ok');
  capacityText.textContent = over
    ? `容量オーバー (${bytes}/${MAX_RECIPE_URL_BYTES}バイト)`
    : `${Math.round(rawPercent)}% (${bytes}/${MAX_RECIPE_URL_BYTES}バイト)`;
}

const gridCanvas = document.getElementById('grid-canvas');
const gridCtx = gridCanvas.getContext('2d');
gridCanvas.width = GRID_RESOLUTION;
gridCanvas.height = GRID_RESOLUTION;

function renderGrid(sourceGrid = grid) {
  const cell = GRID_RESOLUTION / size;
  gridCtx.fillStyle = '#0b1230';
  gridCtx.fillRect(0, 0, GRID_RESOLUTION, GRID_RESOLUTION);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = sourceGrid[y][x];
      if (c) {
        gridCtx.fillStyle = c;
        gridCtx.fillRect(x * cell, y * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
  }

  if (cell >= 6) {
    gridCtx.strokeStyle = 'rgba(255,255,255,0.08)';
    gridCtx.lineWidth = 1;
    for (let i = 0; i <= size; i++) {
      gridCtx.beginPath();
      gridCtx.moveTo(i * cell, 0);
      gridCtx.lineTo(i * cell, GRID_RESOLUTION);
      gridCtx.stroke();
      gridCtx.beginPath();
      gridCtx.moveTo(0, i * cell);
      gridCtx.lineTo(GRID_RESOLUTION, i * cell);
      gridCtx.stroke();
    }
  }
}
renderGrid();

// Undo / redo history
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');

function snapshotGrid() {
  return grid.map((row) => row.slice());
}

function updateHistoryButtons() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

function pushHistory() {
  undoStack.push(snapshotGrid());
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}

function resetHistory() {
  undoStack = [];
  redoStack = [];
  updateHistoryButtons();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshotGrid());
  grid = undoStack.pop();
  updateHistoryButtons();
  dirty = true;
  updateSaveBlink();
  updateCapacityGauge();
  renderGrid();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshotGrid());
  grid = redoStack.pop();
  updateHistoryButtons();
  dirty = true;
  updateSaveBlink();
  updateCapacityGauge();
  renderGrid();
}

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

// Shifts every pixel by (dx, dy) grid cells; content pushed outside the
// grid is dropped rather than wrapped around.
function shiftGrid(source, gridSize, dx, dy) {
  const result = createEmptyGrid(gridSize);
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx >= 0 && sx < gridSize && sy >= 0 && sy < gridSize) {
        result[y][x] = source[sy][sx];
      }
    }
  }
  return result;
}

function setSize(newSize) {
  if (size === newSize) return;
  if (grid.flat().some(Boolean)) {
    if (!confirm('サイズを変更するとキャンバスがリセットされます。よろしいですか？')) return;
  }
  size = newSize;
  grid = createEmptyGrid(size);
  currentId = null;
  resetHistory();
  dirty = false;
  updateSaveBlink();
  updateCapacityGauge();
  document.getElementById('name-input').value = '';
  document.querySelectorAll('.size-btn').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.size) === size);
  });
  renderGrid();
}

document.querySelectorAll('.size-btn').forEach((btn) => {
  btn.addEventListener('click', () => setSize(Number(btn.dataset.size)));
});

function paintCell(gx, gy, color) {
  if (gx < 0 || gy < 0 || gx >= size || gy >= size) return;
  const mx = size - 1 - gx;
  const my = size - 1 - gy;

  const cells = new Set([[gx, gy]].map(String));
  if (symmetryPoint) {
    // Full four-way mirror (both axes plus the 180-degree point), matching
    // the original "点対称に描く" behavior.
    cells.add(String([mx, gy]));
    cells.add(String([gx, my]));
    cells.add(String([mx, my]));
  } else if (symmetryLine) {
    // Left-right mirror only.
    cells.add(String([mx, gy]));
  }

  for (const key of cells) {
    const [x, y] = key.split(',').map(Number);
    grid[y][x] = color;
  }
}

function cellFromEvent(e) {
  const rect = gridCanvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) * (GRID_RESOLUTION / rect.width);
  const cy = (e.clientY - rect.top) * (GRID_RESOLUTION / rect.height);
  const cell = GRID_RESOLUTION / size;
  return { gx: Math.floor(cx / cell), gy: Math.floor(cy / cell) };
}

function paintAt(e) {
  const { gx, gy } = cellFromEvent(e);
  paintCell(gx, gy, tool === 'erase' ? null : currentColor);
  dirty = true;
  updateSaveBlink();
  updateCapacityGauge();
  renderGrid();
}

function sampleColorAt(e) {
  const { gx, gy } = cellFromEvent(e);
  if (gx >= 0 && gy >= 0 && gx < size && gy < size) {
    const c = grid[gy][gx];
    if (c) {
      applyColorChange(c);
      return;
    }
  }
  tool = 'paint';
  setActiveTool(activeSwatchIndex !== null ? swatchButtons[activeSwatchIndex] : null);
}

gridCanvas.addEventListener('pointerdown', (e) => {
  gridCanvas.setPointerCapture(e.pointerId);

  if (tool === 'eyedropper') {
    sampleColorAt(e);
    return;
  }
  if (tool === 'move') {
    moveStartSnapshot = snapshotGrid();
    moveStartCell = cellFromEvent(e);
    painting = true;
    return;
  }
  painting = true;
  pushHistory();
  paintAt(e);
});

gridCanvas.addEventListener('pointermove', (e) => {
  if (!painting) return;
  if (tool === 'move' && moveStartSnapshot) {
    const cur = cellFromEvent(e);
    renderGrid(shiftGrid(moveStartSnapshot, size, cur.gx - moveStartCell.gx, cur.gy - moveStartCell.gy));
    return;
  }
  paintAt(e);
});

window.addEventListener('pointerup', (e) => {
  if (painting && tool === 'move' && moveStartSnapshot) {
    const cur = cellFromEvent(e);
    const dx = cur.gx - moveStartCell.gx;
    const dy = cur.gy - moveStartCell.gy;
    if (dx !== 0 || dy !== 0) {
      undoStack.push(moveStartSnapshot);
      redoStack.length = 0;
      updateHistoryButtons();
      grid = shiftGrid(moveStartSnapshot, size, dx, dy);
      dirty = true;
      updateSaveBlink();
      updateCapacityGauge();
    }
    renderGrid();
  }
  painting = false;
  moveStartSnapshot = null;
  moveStartCell = null;
});

// Palette
// A session-local working copy: recoloring a swatch (via the custom color
// picker or the eyedropper) only changes this in-memory copy, never the
// PALETTE constant, and is never persisted -- reloading or navigating away
// starts fresh from the original PALETTE again.
const workingPalette = PALETTE.slice();
let activeSwatchIndex = 0;

const paletteEl = document.getElementById('palette');
const eraseBtn = document.getElementById('erase-btn');
const eyedropperBtn = document.getElementById('eyedropper-btn');
const moveBtn = document.getElementById('move-btn');
const swatchButtons = [];

function setActiveTool(activeEl) {
  [...swatchButtons, eraseBtn, eyedropperBtn, moveBtn].forEach((b) => b.classList.remove('active'));
  if (activeEl) activeEl.classList.add('active');
}

workingPalette.forEach((color, i) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'swatch pixel-btn';
  btn.style.background = color;
  btn.title = color;
  if (i === 0) btn.classList.add('active');
  btn.addEventListener('click', () => {
    tool = 'paint';
    activeSwatchIndex = i;
    currentColor = workingPalette[i];
    customColorInput.value = workingPalette[i];
    setActiveTool(btn);
  });
  paletteEl.appendChild(btn);
  swatchButtons.push(btn);
});

eraseBtn.addEventListener('click', () => {
  tool = 'erase';
  setActiveTool(eraseBtn);
});

eyedropperBtn.addEventListener('click', () => {
  tool = 'eyedropper';
  setActiveTool(eyedropperBtn);
});

moveBtn.addEventListener('click', () => {
  tool = 'move';
  setActiveTool(moveBtn);
});

// Shared by the custom color picker and the eyedropper: whichever palette
// swatch is currently selected gets recolored to match, instead of the new
// color living outside the palette.
function applyColorChange(newColor) {
  tool = 'paint';
  currentColor = newColor;
  customColorInput.value = newColor;
  if (activeSwatchIndex !== null) {
    workingPalette[activeSwatchIndex] = newColor;
    const btn = swatchButtons[activeSwatchIndex];
    btn.style.background = newColor;
    btn.title = newColor;
    setActiveTool(btn);
  } else {
    setActiveTool(null);
  }
}

const customColorInput = document.getElementById('custom-color');
customColorInput.addEventListener('input', (e) => {
  applyColorChange(e.target.value);
});

document.getElementById('symmetry-point').addEventListener('change', (e) => {
  symmetryPoint = e.target.checked;
});
document.getElementById('symmetry-line').addEventListener('change', (e) => {
  symmetryLine = e.target.checked;
});

document.getElementById('name-input').addEventListener('input', updateCapacityGauge);

document.getElementById('clear-btn').addEventListener('click', () => {
  if (!grid.flat().some(Boolean)) return;
  if (!confirm('キャンバスをクリアしますか？')) return;
  pushHistory();
  grid = createEmptyGrid(size);
  // Clearing means "start a new design" -- otherwise the next save would
  // overwrite whatever was previously loaded/saved in this session instead
  // of creating a separate entry.
  currentId = null;
  document.getElementById('name-input').value = '';
  dirty = false;
  updateSaveBlink();
  updateCapacityGauge();
  renderGrid();
});

// Preview
const previewCanvas = document.getElementById('preview-canvas');
const previewCtx = previewCanvas.getContext('2d');
let previewFw = null;
let previewLast = 0;
let previewRAF = null;

function runPreview() {
  unlockAudio();
  if (!grid.flat().some(Boolean)) {
    alert('何も描かれていません。');
    return;
  }
  if (previewRAF) cancelAnimationFrame(previewRAF);
  previewCanvas.width = previewCanvas.clientWidth;
  previewCanvas.height = previewCanvas.clientHeight;

  previewFw = new Firework({
    design: { size, pixels: grid },
    x: previewCanvas.width / 2,
    y: previewCanvas.height / 2,
    startY: previewCanvas.height / 2,
    scale: 1.15,
  });
  previewFw.phase = 'explode';
  previewFw.buildParticles();
  playExplosionBoom(1.15);
  previewLast = performance.now();
  previewRAF = requestAnimationFrame(previewLoop);
}

function previewLoop(now) {
  const dt = Math.min((now - previewLast) / 1000, 0.05);
  previewLast = now;
  previewCtx.fillStyle = '#060a1a';
  previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewFw.update(dt);
  previewFw.draw(previewCtx);
  if (!previewFw.done) {
    previewRAF = requestAnimationFrame(previewLoop);
  }
}

document.getElementById('preview-btn').addEventListener('click', runPreview);

// Save
document.getElementById('save-btn').addEventListener('click', () => {
  if (!grid.flat().some(Boolean)) {
    alert('何も描かれていません。');
    return;
  }
  const nameInput = document.getElementById('name-input');
  const name = nameInput.value.trim() || '無題の花火';
  const existing = currentId ? getFirework(currentId) : null;
  const fw = {
    id: currentId || generateId(),
    name,
    size,
    pixels: grid,
    enabled: existing ? existing.enabled !== false : true,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
  };
  saveFirework(fw);
  currentId = fw.id;
  nameInput.value = name;
  dirty = false;
  updateSaveBlink();
  renderGallery();
});

// Gallery
function renderGallery() {
  const list = getFireworks();
  const galleryEl = document.getElementById('gallery');
  galleryEl.innerHTML = '';
  if (!list.length) {
    galleryEl.innerHTML = '<p class="empty">まだ保存された花火はありません。</p>';
    return;
  }
  list
    .slice()
    .reverse()
    .forEach((fw) => {
      const card = document.createElement('div');
      card.className = 'card';

      const thumb = document.createElement('canvas');
      thumb.width = 100;
      thumb.height = 100;
      drawGridToCanvas(thumb, fw.pixels, fw.size, { background: '#0b1230' });

      const title = document.createElement('div');
      title.className = 'card-title';
      title.textContent = fw.name;

      const meta = document.createElement('div');
      meta.className = 'card-meta';
      meta.textContent = `${fw.size}×${fw.size}`;

      const launchToggle = document.createElement('label');
      launchToggle.className = 'launch-toggle';
      const launchCheckbox = document.createElement('input');
      launchCheckbox.type = 'checkbox';
      launchCheckbox.checked = fw.enabled !== false;
      launchCheckbox.addEventListener('change', () => {
        fw.enabled = launchCheckbox.checked;
        saveFirework(fw);
      });
      launchToggle.append(launchCheckbox, document.createTextNode(' 夜空に打ち上げる'));

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      const editBtn = document.createElement('button');
      editBtn.textContent = '編集';
      editBtn.className = 'pixel-btn';
      editBtn.addEventListener('click', () => loadDesign(fw));

      const recipeBtn = document.createElement('button');
      recipeBtn.textContent = 'QR';
      recipeBtn.className = 'pixel-btn';
      recipeBtn.addEventListener('click', () => showRecipeModal(fw));

      const delBtn = document.createElement('button');
      delBtn.textContent = '削除';
      delBtn.className = 'danger pixel-btn';
      delBtn.addEventListener('click', () => {
        if (!confirm(`「${fw.name}」を削除しますか？`)) return;
        deleteFirework(fw.id);
        if (currentId === fw.id) currentId = null;
        renderGallery();
      });

      actions.append(editBtn, recipeBtn, delBtn);
      card.append(thumb, title, meta, launchToggle, actions);
      galleryEl.appendChild(card);
    });
}

function loadDesign(fw) {
  size = fw.size;
  grid = fw.pixels.map((row) => row.slice());
  currentId = fw.id;
  resetHistory();
  dirty = false;
  updateSaveBlink();
  updateCapacityGauge();
  document.getElementById('name-input').value = fw.name;
  document.querySelectorAll('.size-btn').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.size) === size);
  });
  renderGrid();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Recipe: a QR code that carries the design as a URL (?d= became a hash
// fragment to save a few bytes -- see recipe.js). Scanning it with a phone
// opens the site and imports automatically; the same image can be
// uploaded back into "QRを読み込む" on a PC.
function buildRecipeUrl(fw) {
  const recipeBytes = encodeRecipe(fw);
  const code = bytesToBase64Url(recipeBytes);
  const dirPath = location.pathname.replace(/[^/]*$/, '');
  return `${location.origin}${dirPath}#${code}`;
}

const recipeModal = document.getElementById('recipe-modal');
const recipeModalTitle = document.getElementById('recipe-modal-title');
const recipeQrCanvas = document.getElementById('recipe-qr-canvas');
let recipeDownloadName = 'hanabi';

function showRecipeModal(fw) {
  let url;
  try {
    url = buildRecipeUrl(fw);
    const matrix = encodeQrMatrix(url);
    const logo = renderDesignToCanvas(fw, 120);
    renderQrToCanvas(recipeQrCanvas, matrix, 300, logo, 0.28);
  } catch (err) {
    alert(err.message || 'QRコードを作成できませんでした');
    return;
  }
  recipeModalTitle.textContent = `「${fw.name}」のレシピ`;
  recipeDownloadName = (fw.name || 'hanabi').replace(/[\\/:*?"<>|]/g, '_').trim() || 'hanabi';
  recipeModal.hidden = false;
}

document.getElementById('recipe-close-btn').addEventListener('click', () => {
  recipeModal.hidden = true;
});

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

document.getElementById('recipe-download-btn').addEventListener('click', async () => {
  const filename = `${recipeDownloadName}-recipe.png`;

  // Mobile browsers -- iOS Safari in particular -- largely ignore the <a
  // download> attribute for a data: URL and silently do nothing. The Web
  // Share API opens the OS's native share sheet instead, which reliably
  // offers "Save Image" on phones; desktop browsers without file-sharing
  // support fall through to the classic anchor download below.
  if (navigator.canShare) {
    try {
      const blob = await canvasToBlob(recipeQrCanvas);
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (err) {
      if (err.name === 'AbortError') return; // user closed the share sheet
    }
  }

  const url = recipeQrCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

function saveImportedDesign(decoded) {
  const fw = {
    id: generateId(),
    name: decoded.name,
    size: decoded.size,
    pixels: decoded.pixels,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  saveFirework(fw);
  renderGallery();
  loadDesign(fw);
  alert(`「${fw.name}」を読み込んで保存しました。`);
}

function importFromRecipeCode(code) {
  let decoded;
  try {
    decoded = decodeRecipe(base64UrlToBytes(code));
  } catch (err) {
    alert(err.message || 'レシピの読み込みに失敗しました');
    return;
  }
  saveImportedDesign(decoded);
}

const importRecipeInput = document.getElementById('import-recipe-input');
document.getElementById('import-recipe-btn').addEventListener('click', () => {
  importRecipeInput.click();
});
importRecipeInput.addEventListener('change', async () => {
  const file = importRecipeInput.files[0];
  importRecipeInput.value = '';
  if (!file) return;
  try {
    const img = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const el = new Image();
      el.onload = () => {
        URL.revokeObjectURL(url);
        resolve(el);
      };
      el.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('画像を読み込めませんでした'));
      };
      el.src = url;
    });
    const url = readQrFromImage(img);
    const hashIndex = url.indexOf('#');
    if (hashIndex === -1) throw new Error('このQRコードにはレシピが含まれていません');
    importFromRecipeCode(url.slice(hashIndex + 1));
  } catch (err) {
    alert(err.message || 'QRコードを読み取れませんでした');
  }
});

// If this page was opened via a recipe QR (site root, hash = code),
// import it automatically and clear the hash so a later reload/share of
// this exact URL doesn't repeat it.
function tryAutoImportFromHash() {
  const code = location.hash.slice(1);
  if (!code) return;
  history.replaceState({}, '', location.pathname + location.search);
  importFromRecipeCode(code);
}

renderGallery();
tryAutoImportFromHash();
updateCapacityGauge();
