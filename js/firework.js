const GRAVITY = 70; // px, downward drift strength during fall/fade
const TIME_STEP = 1 / 12; // quantize motion to ~12 "frames" per second for a chunky, sprite-like feel
const ALPHA_LEVELS = 6; // quantize opacity into bands instead of a smooth fade
const PIXEL_SNAP = 2; // round drawn positions to this many px for a blocky look

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInQuad(t) {
  return t * t;
}

function stepTime(t, step) {
  return Math.floor(t / step) * step;
}

function quantizeAlpha(a, levels) {
  return Math.ceil(a * levels) / levels;
}

function snap(v, grid) {
  return Math.round(v / grid) * grid;
}

// A single firework: rises from (x, startY) to (x, targetY), then bursts
// into square pixel particles arranged from the pixel-art design, centered
// on the burst point and scaled outward. Motion is quantized in time and
// space so it reads as chunky sprite animation rather than a smooth tween.
export class Firework {
  constructor({ design, x, y, startY, scale = 1, onExplode = null }) {
    this.design = design; // { size, pixels }
    this.x = x;
    this.targetY = y;
    this.startY = startY;
    this.scale = scale;
    this.onExplode = onExplode;

    this.phase = 'launch';
    this.launchDuration = 1.7 + Math.random() * 0.9;
    this.elapsed = 0;
    this.particles = null;
    this.particleSize = 4;
    this.maxLife = 1;
    this.done = false;
  }

  buildParticles() {
    const size = this.design.size;
    const center = (size - 1) / 2;
    const cellRadius = (198 * this.scale) / size;
    this.particleSize = Math.round(Math.max(3, Math.min(16, cellRadius * 0.55)));
    const particles = [];
    for (let gy = 0; gy < size; gy++) {
      for (let gx = 0; gx < size; gx++) {
        const color = this.design.pixels[gy][gx];
        if (!color) continue;
        particles.push({
          dx: (gx - center) * cellRadius,
          dy: (gy - center) * cellRadius,
          color,
          delay: Math.random() * 0.12,
          expandDur: 0.5 + Math.random() * 0.25,
          holdDur: 0.35 + Math.random() * 0.25,
          fadeDur: 0.6 + Math.random() * 0.5,
          flickerSeed: Math.random() * Math.PI * 2,
          driftX: (Math.random() - 0.5) * 20,
        });
      }
    }
    this.particles = particles;
    this.maxLife = Math.max(...particles.map((p) => p.delay + p.expandDur + p.holdDur + p.fadeDur), 1);
  }

  update(dt) {
    this.elapsed += dt;
    if (this.phase === 'launch') {
      if (this.elapsed >= this.launchDuration) {
        this.phase = 'explode';
        this.elapsed = 0;
        this.buildParticles();
        this.onExplode?.();
      }
      return;
    }
    if (this.phase === 'explode' && this.elapsed >= this.maxLife) {
      this.done = true;
    }
  }

  draw(ctx) {
    if (this.phase === 'launch') this.drawLaunch(ctx);
    else if (this.phase === 'explode') this.drawExplosion(ctx);
  }

  drawLaunch(ctx) {
    const stepped = stepTime(this.elapsed, TIME_STEP);
    const t = Math.min(1, stepped / this.launchDuration);
    const y = snap(this.startY + (this.targetY - this.startY) * easeOutCubic(t), PIXEL_SNAP);
    const x = snap(this.x, PIXEL_SNAP);

    // Trail length tracks the rocket's instantaneous speed (derivative of
    // easeOutCubic, normalized to 1 at launch / 0 at the apex) so it
    // shortens as the rocket decelerates instead of staying a fixed-length
    // rigid streak that just freezes in place right before the burst.
    const speed = (1 - t) * (1 - t);
    // The trail also fades out over the flight, fully gone by the apex.
    const fade = 1 - t;

    ctx.save();
    ctx.fillStyle = '#fff8d0';
    ctx.fillRect(x - 2, y - 2, 4, 4);

    const trailPixels = [
      { offset: 7, alpha: 0.55 },
      { offset: 14, alpha: 0.3 },
      { offset: 21, alpha: 0.12 },
    ];
    for (const tp of trailPixels) {
      const off = tp.offset * speed;
      const alpha = tp.alpha * fade;
      if (off < 1 || alpha <= 0.01) continue;
      ctx.globalAlpha = alpha;
      ctx.fillRect(x - 1.5, y + off - 1.5, 3, 3);
    }
    ctx.restore();
  }

  drawExplosion(ctx) {
    const stepped = stepTime(this.elapsed, TIME_STEP);
    const half = this.particleSize / 2;

    for (const p of this.particles) {
      const t = stepped - p.delay;
      if (t <= 0) continue;

      let px, py, alpha;
      if (t < p.expandDur) {
        const et = easeOutCubic(t / p.expandDur);
        px = this.x + p.dx * et;
        py = this.targetY + p.dy * et;
        alpha = 1;
      } else {
        const ft = t - p.expandDur;
        const fallSpan = p.holdDur + p.fadeDur;
        const fallT = Math.min(ft / fallSpan, 1);
        px = this.x + p.dx + p.driftX * fallT;
        py = this.targetY + p.dy + GRAVITY * fallT * fallT;
        alpha = ft < p.holdDur ? 1 : 1 - easeInQuad(Math.min((ft - p.holdDur) / p.fadeDur, 1));
      }

      alpha *= 0.7 + 0.3 * Math.sin(stepped * 9 + p.flickerSeed);
      alpha = quantizeAlpha(Math.max(0, Math.min(1, alpha)), ALPHA_LEVELS);
      if (alpha <= 0.01) continue;

      px = snap(px, PIXEL_SNAP);
      py = snap(py, PIXEL_SNAP);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(px - half, py - half, this.particleSize, this.particleSize);
      ctx.restore();
    }
  }
}
