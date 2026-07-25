import { PALETTE, createEmptyGrid, drawGridToCanvas } from './pixel-grid.js';
import { getFireworks, getFirework, saveFirework, deleteFirework, generateId } from './storage.js';
import { Firework } from './firework.js';
import { encodeFirework, decodeShareCode } from './share-code.js';
import { unlockAudio, initMuteButton, playExplosionBoom } from './sound.js';

initMuteButton(document.getElementById('mute-btn'));
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

const GRID_RESOLUTION = 450; // internal canvas pixels (square)

let size = 15;
let grid = createEmptyGrid(size);
let symmetry = true;
let currentColor = PALETTE[0];
let tool = 'paint'; // 'paint' | 'erase' | 'eyedropper' | 'move'
let currentId = null;
let painting = false;

let undoStack = [];
let redoStack = [];
let moveStartSnapshot = null;
let moveStartCell = null;

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
  renderGrid();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshotGrid());
  grid = redoStack.pop();
  updateHistoryButtons();
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
  grid[gy][gx] = color;
  if (symmetry) {
    const mx = size - 1 - gx;
    const my = size - 1 - gy;
    grid[gy][mx] = color;
    grid[my][gx] = color;
    grid[my][mx] = color;
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

document.getElementById('symmetry-toggle').addEventListener('change', (e) => {
  symmetry = e.target.checked;
});

document.getElementById('clear-btn').addEventListener('click', () => {
  if (!grid.flat().some(Boolean)) return;
  if (!confirm('キャンバスをクリアしますか？')) return;
  pushHistory();
  grid = createEmptyGrid(size);
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

      const shareBtn = document.createElement('button');
      shareBtn.textContent = '共有';
      shareBtn.className = 'pixel-btn';
      shareBtn.addEventListener('click', async () => {
        let code;
        try {
          code = encodeFirework(fw);
        } catch (err) {
          alert(err.message);
          return;
        }
        const url = `${location.origin}${location.pathname}?d=${code}`;
        try {
          await navigator.clipboard.writeText(url);
          alert(`「${fw.name}」の共有リンクをコピーしました。貼り付けて相手に渡してください。開くだけで読み込まれます。`);
        } catch {
          prompt('コピーできませんでした。手動でコピーしてください:', url);
        }
      });

      const delBtn = document.createElement('button');
      delBtn.textContent = '削除';
      delBtn.className = 'danger pixel-btn';
      delBtn.addEventListener('click', () => {
        if (!confirm(`「${fw.name}」を削除しますか？`)) return;
        deleteFirework(fw.id);
        if (currentId === fw.id) currentId = null;
        renderGallery();
      });

      actions.append(editBtn, shareBtn, delBtn);
      card.append(thumb, title, meta, launchToggle, actions);
      galleryEl.appendChild(card);
    });
}

function loadDesign(fw) {
  size = fw.size;
  grid = fw.pixels.map((row) => row.slice());
  currentId = fw.id;
  resetHistory();
  document.getElementById('name-input').value = fw.name;
  document.querySelectorAll('.size-btn').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.size) === size);
  });
  renderGrid();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Accepts either a bare share code or a full share link (extracts its `d`
// query param), so pasting either one works.
function extractShareCode(input) {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const d = url.searchParams.get('d');
    if (d) return d;
  } catch {
    // not a URL -- fall through and treat the whole input as a bare code
  }
  return trimmed;
}

function importFromCode(rawInput) {
  const code = extractShareCode(rawInput);
  if (!code) return;

  let decoded;
  try {
    decoded = decodeShareCode(code);
  } catch (err) {
    alert(err.message || 'コードの読み込みに失敗しました');
    return;
  }

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

document.getElementById('import-btn').addEventListener('click', () => {
  const input = prompt('花火の共有リンクまたはコードを貼り付けてください:');
  if (!input || !input.trim()) return;
  importFromCode(input);
});

// If this page was opened via a share link (?d=<code>), import it
// automatically and strip the param so a later reload doesn't repeat it.
function tryAutoImportFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('d');
  if (!code) return;
  window.history.replaceState({}, '', window.location.origin + window.location.pathname);
  importFromCode(code);
}

renderGallery();
tryAutoImportFromUrl();
