// Synthesizes firework sound effects with the Web Audio API instead of
// shipping audio files -- keeps the app dependency-free and buildless.
// Playback is silently skipped until a user gesture unlocks the
// AudioContext (browser autoplay policy) and while muted.

let ctx = null;
let masterGain = null;
let noiseBuffer = null;

// Not persisted on purpose: every page (re)load -- including navigating
// between the sky and editor pages -- should start back at muted.
let muted = true;

function ensureContext() {
  if (ctx) return ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  ctx = new AudioCtx();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.8;
  masterGain.connect(ctx.destination);
  return ctx;
}

function getNoiseBuffer(c) {
  if (noiseBuffer) return noiseBuffer;
  const len = c.sampleRate; // ~1 second of noise, reused/truncated per play
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
}

// Call from any user-gesture handler (click/keydown) to satisfy autoplay
// policies. Safe to call repeatedly.
export function unlockAudio() {
  const c = ensureContext();
  if (c && c.state === 'suspended') c.resume();
}

export function initMuteButton(btn) {
  const render = () => {
    btn.textContent = isMuted() ? '音: OFF' : '音: ON';
  };
  render();
  btn.addEventListener('click', () => {
    unlockAudio();
    setMuted(!isMuted());
    render();
  });
}

// Dull low thump + muffled rumble for the burst (no bright/crisp crackle).
// `intensity` (roughly the firework's render scale) makes bigger bursts
// sound a bit louder/deeper.
export function playExplosionBoom(intensity = 1) {
  if (isMuted()) return;
  const c = ensureContext();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  const amt = Math.max(0.5, Math.min(1.6, intensity));

  const thump = c.createOscillator();
  thump.type = 'sine';
  const thumpFilter = c.createBiquadFilter();
  thumpFilter.type = 'lowpass';
  thumpFilter.frequency.value = 200;
  const thumpGain = c.createGain();
  thump.connect(thumpFilter);
  thumpFilter.connect(thumpGain);
  thumpGain.connect(masterGain);
  thump.frequency.setValueAtTime(70 + 25 * amt, now);
  thump.frequency.exponentialRampToValueAtTime(24, now + 0.5);
  thumpGain.gain.setValueAtTime(0.0001, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.4 * amt, now + 0.05);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
  thump.start(now);
  thump.stop(now + 0.7);

  const noise = c.createBufferSource();
  noise.buffer = getNoiseBuffer(c);
  const noiseFilter = c.createBiquadFilter();
  noiseFilter.type = 'lowpass';
  noiseFilter.frequency.setValueAtTime(700, now);
  noiseFilter.frequency.exponentialRampToValueAtTime(220, now + 0.55);
  noiseFilter.Q.value = 0.3;
  const noiseGain = c.createGain();
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(masterGain);
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.16 * amt, now + 0.04);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
  noise.start(now);
  noise.stop(now + 0.65);
}
