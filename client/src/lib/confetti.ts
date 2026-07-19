/**
 * 依存ライブラリなしの紙吹雪。精算完了など「祝う」瞬間にだけ使う。
 * prefers-reduced-motion が有効な環境では何もしない。
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  color: string;
  rotation: number;
  vr: number;
  opacity: number;
}

// iOS システムカラー（blue / green / orange / pink / purple / cyan）
const COLORS = ["#0A84FF", "#30D158", "#FF9F0A", "#FF375F", "#BF5AF2", "#64D2FF"];

export function fireConfetti(durationMs = 1800): void {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999;";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const W = window.innerWidth;
  const H = window.innerHeight;
  const particles: Particle[] = [];

  // 左右下から中央上方向へ 2 発、計 140 枚
  const spawn = (originX: number, direction: 1 | -1) => {
    for (let i = 0; i < 70; i++) {
      const angle = (-Math.PI / 2) + direction * (Math.PI / 5) * (Math.random() - 0.15);
      const speed = 9 + Math.random() * 9;
      particles.push({
        x: originX,
        y: H + 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 5,
        h: 8 + Math.random() * 7,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.35,
        opacity: 1,
      });
    }
  };
  spawn(W * 0.12, 1);
  spawn(W * 0.88, -1);

  const start = performance.now();
  const tick = (now: number) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of particles) {
      p.vy += 0.24; // 重力
      p.vx *= 0.992; // 空気抵抗
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.vr;
      if (elapsed > durationMs) p.opacity = Math.max(0, p.opacity - 0.03);
      if (p.opacity > 0 && p.y < H + 40) alive = true;

      ctx.save();
      ctx.globalAlpha = p.opacity;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive && elapsed < durationMs + 2000) {
      requestAnimationFrame(tick);
    } else {
      canvas.remove();
    }
  };
  requestAnimationFrame(tick);
}
