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
let eraseMode = false;
let currentId = null;
let painting = false;

const gridCanvas = document.getElementById('grid-canvas');
const gridCtx = gridCanvas.getContext('2d');
gridCanvas.width = GRID_RESOLUTION;
gridCanvas.height = GRID_RESOLUTION;

function renderGrid() {
  const cell = GRID_RESOLUTION / size;
  gridCtx.fillStyle = '#0b1230';
  gridCtx.fillRect(0, 0, GRID_RESOLUTION, GRID_RESOLUTION);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = grid[y][x];
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

function setSize(newSize) {
  if (size === newSize) return;
  if (grid.flat().some(Boolean)) {
    if (!confirm('サイズを変更するとキャンバスがリセットされます。よろしいですか？')) return;
  }
  size = newSize;
  grid = createEmptyGrid(size);
  currentId = null;
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
  paintCell(gx, gy, eraseMode ? null : currentColor);
  renderGrid();
}

gridCanvas.addEventListener('pointerdown', (e) => {
  painting = true;
  gridCanvas.setPointerCapture(e.pointerId);
  paintAt(e);
});
gridCanvas.addEventListener('pointermove', (e) => {
  if (painting) paintAt(e);
});
window.addEventListener('pointerup', () => {
  painting = false;
});

// Palette
const paletteEl = document.getElementById('palette');
const swatchButtons = [];
PALETTE.forEach((color, i) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'swatch pixel-btn';
  btn.style.background = color;
  btn.title = color;
  if (i === 0) btn.classList.add('active');
  btn.addEventListener('click', () => {
    currentColor = color;
    eraseMode = false;
    setActiveSwatch(btn);
  });
  paletteEl.appendChild(btn);
  swatchButtons.push(btn);
});

const eraseBtn = document.getElementById('erase-btn');
function setActiveSwatch(activeEl) {
  swatchButtons.forEach((s) => s.classList.remove('active'));
  eraseBtn.classList.remove('active');
  activeEl.classList.add('active');
}
eraseBtn.addEventListener('click', () => {
  eraseMode = true;
  swatchButtons.forEach((s) => s.classList.remove('active'));
  eraseBtn.classList.add('active');
});

const customColorInput = document.getElementById('custom-color');
customColorInput.addEventListener('input', (e) => {
  currentColor = e.target.value;
  eraseMode = false;
  swatchButtons.forEach((s) => s.classList.remove('active'));
  eraseBtn.classList.remove('active');
});

document.getElementById('symmetry-toggle').addEventListener('change', (e) => {
  symmetry = e.target.checked;
});

document.getElementById('clear-btn').addEventListener('click', () => {
  if (!grid.flat().some(Boolean)) return;
  if (!confirm('キャンバスをクリアしますか？')) return;
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
        try {
          await navigator.clipboard.writeText(code);
          alert(`「${fw.name}」の共有コードをコピーしました。貼り付けて相手に渡してください。`);
        } catch {
          prompt('コピーできませんでした。手動でコピーしてください:', code);
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
  document.getElementById('name-input').value = fw.name;
  document.querySelectorAll('.size-btn').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.size) === size);
  });
  renderGrid();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('import-btn').addEventListener('click', () => {
  const code = prompt('花火の共有コードを貼り付けてください:');
  if (!code || !code.trim()) return;

  let decoded;
  try {
    decoded = decodeShareCode(code.trim());
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
});

renderGallery();
