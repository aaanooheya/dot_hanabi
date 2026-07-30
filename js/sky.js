import { getFireworks } from './storage.js';
import { Firework } from './firework.js';
import { unlockAudio, initMuteButton, playExplosionBoom } from './sound.js';

// A recipe QR points at the site root (to keep the URL short), so a scan
// lands here first; hand off to the editor, which knows how to import it.
if (location.hash.length > 1) {
  location.replace('editor.html' + location.hash);
}

const canvas = document.getElementById('sky');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const emptyMessage = document.getElementById('empty-message');

initMuteButton(document.getElementById('mute-btn'));
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// One-time announcements for newly added features, shown on first visit
// after each update and never again (tracked via a localStorage flag per
// announcement). Chained so a brand-new visitor sees them in order, one
// at a time, instead of all at once.
function initAnnouncement(key, modalId, okBtnId, onDismiss) {
  const modal = document.getElementById(modalId);
  document.getElementById(okBtnId).addEventListener('click', () => {
    localStorage.setItem(key, '1');
    modal.hidden = true;
    if (onDismiss) onDismiss();
  });
  return () => {
    if (localStorage.getItem(key)) return false;
    modal.hidden = false;
    return true;
  };
}

const showSymmetryAlertAnnounce = initAnnouncement(
  'hanabi_seen_announce_symmetry_alert',
  'announce-modal-2',
  'announce-ok-btn-2'
);
const showQrChromaAnnounce = initAnnouncement(
  'hanabi_seen_announce_qr_chroma',
  'announce-modal',
  'announce-ok-btn',
  showSymmetryAlertAnnounce
);

if (!showQrChromaAnnounce()) {
  showSymmetryAlertAnnounce();
}

const launchCountEl = document.getElementById('launch-count');
let launchCount = 0;
function bumpLaunchCount() {
  launchCount += 1;
  launchCountEl.textContent = `${launchCount} 発`;
}

// Chroma key mode: hides all UI, stars, and the moon, leaving just a flat
// background color behind the fireworks (for keying out in a video editor).
// Tapping anywhere on the sky while active turns it back off.
const chromaBtn = document.getElementById('chroma-btn');
const chromaModal = document.getElementById('chroma-modal');
const chromaOkBtn = document.getElementById('chroma-ok-btn');
const chromaCancelBtn = document.getElementById('chroma-cancel-btn');
const chromaCustomColor = document.getElementById('chroma-custom-color');
const chromaSwatchButtons = Array.from(document.querySelectorAll('.chroma-swatch'));

let chromaKeyActive = false;
let chromaKeyColor = chromaCustomColor.value;
let selectedChromaColor = chromaCustomColor.value;

function selectChromaSwatch(color) {
  selectedChromaColor = color;
  chromaSwatchButtons.forEach((b) => b.classList.toggle('active', b.dataset.color === color));
}

chromaSwatchButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    selectChromaSwatch(btn.dataset.color);
    chromaCustomColor.value = btn.dataset.color;
  });
});

chromaCustomColor.addEventListener('input', (e) => {
  selectedChromaColor = e.target.value;
  chromaSwatchButtons.forEach((b) => b.classList.remove('active'));
});

chromaBtn.addEventListener('click', () => {
  chromaModal.hidden = false;
});

chromaCancelBtn.addEventListener('click', () => {
  chromaModal.hidden = true;
});

chromaOkBtn.addEventListener('click', () => {
  chromaKeyColor = selectedChromaColor;
  chromaKeyActive = true;
  chromaModal.hidden = true;
  document.body.classList.add('chroma-active');
});

const STAR_TWINKLE_STEP = 0.45; // seconds between twinkle brightness changes
const STAR_LEVELS = 4; // discrete star brightness bands

let width = 0;
let height = 0;
let stars = [];

function randRange(a, b) {
  return a + Math.random() * (b - a);
}

function resize() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
  ctx.imageSmoothingEnabled = false;
  initStars();
}

function initStars() {
  const count = Math.floor((width * height) / 6000);
  stars = Array.from({ length: count }, () => ({
    x: Math.round(Math.random() * width),
    y: Math.round(Math.random() * height * 0.85),
    size: Math.random() < 0.15 ? 3 : 2,
    seed: Math.random() * Math.PI * 2,
    speed: 0.6 + Math.random() * 0.8,
  }));
}

window.addEventListener('resize', resize);
resize();

let designs = [];
let active = [];
let launchTimer = 0;
let nextLaunchIn = randRange(1.2, 3);

function refreshDesigns() {
  designs = getFireworks().filter((f) => f.enabled !== false);
  emptyMessage.style.display = designs.length ? 'none' : 'flex';
}
refreshDesigns();
window.addEventListener('storage', refreshDesigns);
window.addEventListener('focus', refreshDesigns);

const SCALE_MIN = 0.5;
const SCALE_MAX = 1.9;
const DISTANT_SOUND_DELAY_MS = 700; // max delay, applied at the smallest scale

// Smaller (further-away-feeling) fireworks get a longer delay before their
// boom, like real thunder lagging behind a distant flash.
function explosionSoundDelay(scale) {
  const t = Math.min(1, Math.max(0, (scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)));
  return (1 - t) * DISTANT_SOUND_DELAY_MS;
}

function launchDesign(design, xOverride, yOverride) {
  const x = xOverride ?? randRange(width * 0.15, width * 0.85);
  const y = yOverride ?? randRange(height * 0.15, height * 0.55);
  const scale = randRange(SCALE_MIN, SCALE_MAX);
  const fw = new Firework({
    design,
    x,
    y,
    startY: height + 10,
    scale,
    onExplode: () => setTimeout(() => playExplosionBoom(scale), explosionSoundDelay(scale)),
  });
  active.push(fw);
  bumpLaunchCount();
}

function launchRandom(xOverride, yOverride) {
  if (!designs.length) return;
  const design = designs[Math.floor(Math.random() * designs.length)];
  launchDesign(design, xOverride, yOverride);
}

canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  if (chromaKeyActive) {
    chromaKeyActive = false;
    document.body.classList.remove('chroma-active');
    return;
  }
  if (!designs.length) return;
  const y = Math.min(Math.max(e.clientY, height * 0.08), height * 0.85);
  launchRandom(e.clientX, y);
});

// Draws a circle built out of flat squares, like a sprite baked from pixels.
function drawPixelCircle(cx, cy, radiusPx, cell, color, alpha = 1) {
  const steps = Math.ceil(radiusPx / cell);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let iy = -steps; iy <= steps; iy++) {
    for (let ix = -steps; ix <= steps; ix++) {
      const x = ix * cell;
      const y = iy * cell;
      if (x * x + y * y <= radiusPx * radiusPx) {
        ctx.fillRect(
          Math.round(cx + x - cell / 2),
          Math.round(cy + y - cell / 2),
          cell,
          cell
        );
      }
    }
  }
  ctx.restore();
}

function drawMoon(now) {
  const mx = Math.round(width * 0.85);
  const my = Math.round(height * 0.15);
  const r = Math.min(width, height) * 0.045;
  const cell = Math.max(3, Math.round(r / 7));
  drawPixelCircle(mx, my, r * 1.5, cell, '#fdf6d8', 0.08);
  drawPixelCircle(mx, my, r, cell, '#fdf6d8', 0.95);
}

let lastTime = performance.now();
function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if (chromaKeyActive) {
    ctx.fillStyle = chromaKeyColor;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = '#060a1a';
    ctx.fillRect(0, 0, width, height);

    for (const s of stars) {
      const steppedT = Math.floor((now / 1000 / STAR_TWINKLE_STEP) * s.speed + s.seed);
      const band = Math.abs(steppedT) % STAR_LEVELS;
      ctx.globalAlpha = 0.35 + (band / (STAR_LEVELS - 1)) * 0.65;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    }
    ctx.globalAlpha = 1;

    drawMoon(now);
  }

  if (designs.length) {
    launchTimer += dt;
    if (launchTimer >= nextLaunchIn) {
      launchTimer = 0;
      nextLaunchIn = randRange(1.2, 3.2);
      launchRandom();
    }
  }

  for (const fw of active) {
    fw.update(dt);
    fw.draw(ctx);
  }
  active = active.filter((fw) => !fw.done);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
