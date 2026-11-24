/**
 * 输入特效，两套预设：
 * - Pastel：柔彩涟漪、准星词框（输入法组字时锁定，标 X/Y 坐标）、换行 ASCII 彗星尾迹；
 * - Dither：1-bit 黑白墨滴飞溅、有序抖动消隐的换行流光尾迹、极淡细线词框。
 * 另有两套通用的保存水波 wave()。
 * 特效画在覆盖整个视图的独立 Canvas 上，坐标都相对视图根节点。
 * 克制红线：不遮挡正在辨认的字，所有痕迹在 500ms 内消散。
 */

export interface Point {
  x: number;
  y: number;
  /** 行高 */
  h: number;
}

export type Preset = 'pastel' | 'dither';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Ripple {
  x: number;
  y: number;
  born: number;
  color: string;
}

interface Comet {
  from: Point;
  to: Point;
  born: number;
  dither: boolean;
}

/** Dither 墨滴：一次输入迸出一组方块 */
interface Ink {
  x: number;
  y: number;
  born: number;
  /** life：该墨滴的寿命占 INK_MS 的比例，各不相同，让墨滴错开消失 */
  drops: { vx: number; vy: number; size: number; life: number }[];
}

interface Wave {
  rect: Rect;
  born: number;
  dither: boolean;
}

interface Frame {
  target: Rect;
  current: Rect;
  label: string[];
  born: number;
  /** compositionend 之后开始淡出的时刻 */
  released: number;
}

const PASTELS = ['#a5b4fc', '#f9a8d4', '#99f6e4', '#fde68a', '#c4b5fd'];
const FRAME_COLOR = '#ff6b8a';
const RIPPLE_MS = 450;
const COMET_MS = 380;
const TRAIL_MS = 160;
const FRAME_IN_MS = 180;
const FRAME_OUT_MS = 300;
const TRAIL_GLYPHS = '$%*+:.';
const INK_MS = 420;
const INK_GRAVITY = 260;
const DITHER_GLYPHS = '#=+:.';
const DITHER_FRAME_COLOR = '#ffffff';
const WAVE_MS = 700;
const WAVE_SPREAD = 60;
const WAVE_RADIUS = 16;
const WAVE_STEP = 10;
const WAVE_GLYPHS = '.:~';
/** 4x4 Bayer 有序抖动矩阵 */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;

/** 镜像 div 需要与 textarea 一致的排版属性 */
const MIRRORED: (keyof CSSStyleDeclaration)[] = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight',
  'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize',
];

export class Effects {
  private ctx: CanvasRenderingContext2D;
  private mirror: HTMLDivElement;
  private w = 0;
  private h = 0;
  private ripples: Ripple[] = [];
  private comets: Comet[] = [];
  private inks: Ink[] = [];
  private waves: Wave[] = [];
  private preset: Preset = 'pastel';
  private frame: Frame | null = null;
  private raf = 0;
  private colorIndex = 0;
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private canvas: HTMLCanvasElement, private root: HTMLElement, private ta: HTMLTextAreaElement) {
    this.ctx = canvas.getContext('2d')!;
    this.mirror = root.createDiv({ cls: 'abyssal-jot-mirror' });
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.draw(performance.now());
  }

  /** 文本中第 index 个字符前的光标位置（相对视图根节点，已扣除 textarea 滚动） */
  caretAt(index: number): Point {
    const { ta, mirror } = this;
    const style = getComputedStyle(ta);
    for (const prop of MIRRORED) {
      (mirror.style as unknown as Record<string, string>)[prop as string] = style[prop] as string;
    }
    mirror.style.width = `${ta.offsetWidth}px`;
    mirror.textContent = ta.value.slice(0, index);
    const marker = mirror.createSpan({ text: ta.value.slice(index) || '.' });
    const taRect = ta.getBoundingClientRect();
    const rootRect = this.root.getBoundingClientRect();
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6;
    return {
      x: taRect.left - rootRect.left + ta.clientLeft + marker.offsetLeft - ta.scrollLeft,
      y: taRect.top - rootRect.top + ta.clientTop + marker.offsetTop - ta.scrollTop,
      h: lineHeight,
    };
  }

  setPreset(preset: Preset): void {
    this.preset = preset;
  }

  ripple(at: Point): void {
    if (this.reduced.matches) return;
    if (this.preset === 'dither') {
      const count = 5 + Math.floor(Math.random() * 4);
      const drops = Array.from({ length: count }, () => {
        const angle = Math.random() * Math.PI * 2;
        const speed = 50 + Math.random() * 70;
        return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 30, size: 2 + Math.floor(Math.random() * 2), life: 0.45 + Math.random() * 0.55 };
      });
      this.inks.push({ x: at.x, y: at.y + at.h / 2, born: performance.now(), drops });
      this.kick();
      return;
    }
    this.ripples.push({
      x: at.x,
      y: at.y + at.h / 2,
      born: performance.now(),
      color: PASTELS[this.colorIndex++ % PASTELS.length],
    });
    this.kick();
  }

  comet(from: Point, to: Point): void {
    if (this.reduced.matches) return;
    this.comets.push({ from, to, born: performance.now(), dither: this.preset === 'dither' });
    this.kick();
  }

  /** 保存想法时从输入卡边缘向外荡开一圈 ASCII 水波，rect 为输入卡相对视图根节点的矩形 */
  wave(rect: Rect): void {
    if (this.reduced.matches) return;
    this.waves.push({ rect, born: performance.now(), dither: this.preset === 'dither' });
    this.kick();
  }

  /** 组字期间更新词框：套住 [start, end) 的文字，标出逻辑行列 */
  setFrame(start: number, end: number): void {
    const a = this.caretAt(start);
    const b = this.caretAt(end);
    // 组字文本折行时只框最后一行
    const left = Math.abs(a.y - b.y) < 2 ? a.x : this.caretAt(this.lineStartOf(end)).x;
    const target: Rect = { x: left - 4, y: b.y - 2, w: Math.max(b.x - left, 6) + 8, h: b.h + 4 };
    const before = this.ta.value.slice(0, start);
    const line = before.split('\n').length;
    const col = start - before.lastIndexOf('\n');
    const label = [`X:${col}`, `Y:${line}`];
    const now = performance.now();
    if (this.frame && !this.frame.released) {
      this.frame.target = target;
      this.frame.label = label;
    } else {
      // 新出现的词框从放大的状态收拢到目标，像准星锁定
      const grow = this.reduced.matches ? 0 : 10;
      this.frame = {
        target,
        current: { x: target.x - grow, y: target.y - grow, w: target.w + grow * 2, h: target.h + grow * 2 },
        label,
        born: now,
        released: 0,
      };
    }
    this.kick();
  }

  releaseFrame(): void {
    if (!this.frame) return;
    this.frame.released = performance.now();
    this.kick();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.mirror.remove();
  }

  private lineStartOf(index: number): number {
    // 找到 end 所在视觉行的起点：从 index 往前逐字测量，直到 y 变化
    const y = this.caretAt(index).y;
    let i = index;
    while (i > 0 && Math.abs(this.caretAt(i - 1).y - y) < 2) i--;
    return i;
  }

  private kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.raf = 0;
    this.ripples = this.ripples.filter((r) => now - r.born < RIPPLE_MS);
    this.comets = this.comets.filter((c) => now - c.born < COMET_MS + TRAIL_MS);
    this.inks = this.inks.filter((k) => now - k.born < INK_MS);
    this.waves = this.waves.filter((v) => now - v.born < WAVE_MS);
    if (this.frame?.released && now - this.frame.released > FRAME_OUT_MS) this.frame = null;
    this.draw(now);
    if (this.ripples.length || this.comets.length || this.inks.length || this.waves.length || this.frame) this.raf = requestAnimationFrame(this.tick);
  };

  private draw(now: number): void {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    for (const r of this.ripples) this.drawRipple(r, now);
    for (const k of this.inks) this.drawInk(k, now);
    for (const c of this.comets) this.drawComet(c, now);
    for (const v of this.waves) this.drawWave(v, now);
    if (this.frame) this.drawFrame(this.frame, now);
    ctx.globalAlpha = 1;
  }

  private drawRipple(r: Ripple, now: number): void {
    const { ctx } = this;
    const p = (now - r.born) / RIPPLE_MS;
    const ease = 1 - Math.pow(1 - p, 3);
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55 * (1 - p);
    ctx.beginPath();
    ctx.arc(r.x, r.y, 2 + ease * 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.25 * (1 - p);
    ctx.beginPath();
    ctx.arc(r.x, r.y, 1 + ease * 7, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** 彗星从换行前的光标沿弧线飞到新行行首，身后拖一串由密到疏的 ASCII 字符 */
  private drawComet(c: Comet, now: number): void {
    const { ctx } = this;
    const age = now - c.born;
    const pointAt = (p: number) => {
      const t = 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 2);
      const cx = (c.from.x + c.to.x) / 2;
      const cy = c.from.y + c.from.h * 0.2;
      const x = (1 - t) * (1 - t) * c.from.x + 2 * (1 - t) * t * cx + t * t * c.to.x;
      const y = (1 - t) * (1 - t) * (c.from.y + c.from.h / 2) + 2 * (1 - t) * t * cy + t * t * (c.to.y + c.to.h / 2);
      return { x, y };
    };
    if (c.dither) {
      this.drawDitherComet(c, age, pointAt);
      return;
    }
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const steps = 22;
    for (let i = 0; i < steps; i++) {
      // 第 i 个尾迹点比彗头晚 i * TRAIL_MS / steps 毫秒
      const lag = (i / steps) * TRAIL_MS;
      const p = (age - lag) / COMET_MS;
      if (p < 0 || p > 1.05) continue;
      const fadeOut = age > COMET_MS ? 1 - (age - COMET_MS) / TRAIL_MS : 1;
      const pt = pointAt(p);
      ctx.globalAlpha = Math.max(0, (1 - i / steps) * 0.85 * fadeOut);
      ctx.fillStyle = PASTELS[i % PASTELS.length];
      ctx.fillText(TRAIL_GLYPHS[Math.min(TRAIL_GLYPHS.length - 1, Math.floor((i / steps) * TRAIL_GLYPHS.length))], pt.x, pt.y);
    }
  }

  /**
   * 墨滴：方块带初速度溅开、受重力下落，在各自寿命内按整像素缩小（3→2→1）后消失。
   * 不按屏幕坐标做抖动阈值：墨滴在移动，按坐标取阈值会让它每帧随机闪烁。
   */
  private drawInk(k: Ink, now: number): void {
    const { ctx } = this;
    const t = (now - k.born) / 1000;
    ctx.fillStyle = '#f5f5f5';
    ctx.globalAlpha = 1;
    for (const d of k.drops) {
      const p = (now - k.born) / (INK_MS * d.life);
      if (p >= 1) continue;
      const size = Math.max(1, Math.ceil(d.size * (1 - p)));
      const x = Math.round(k.x + d.vx * t - size / 2);
      const y = Math.round(k.y + d.vy * t + 0.5 * INK_GRAVITY * t * t - size / 2);
      ctx.fillRect(x, y, size, size);
    }
  }

  /** 流光尾迹：白色 ASCII 光带沿弧线扫向新行行首，头亮尾暗，逐格按 Bayer 抖动消隐 */
  private drawDitherComet(c: Comet, age: number, pointAt: (p: number) => { x: number; y: number }): void {
    const { ctx } = this;
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 1;
    const steps = 28;
    const fadeOut = age > COMET_MS ? 1 - (age - COMET_MS) / TRAIL_MS : 1;
    for (let i = 0; i < steps; i++) {
      const p = (age - (i / steps) * TRAIL_MS) / COMET_MS;
      if (p < 0 || p > 1.05) continue;
      const pt = pointAt(p);
      const x = Math.round(pt.x);
      const y = Math.round(pt.y);
      // 亮度随离彗头距离衰减，低于 Bayer 阈值的点不画；阈值按尾迹序号取，
      // 不按坐标取（彗星在移动，按坐标取会让同一个点每帧随机显隐）
      if (bayer(i & 3, (i >> 2) & 3) >= (1 - i / steps) * fadeOut) continue;
      if (i === 0) ctx.fillRect(x - 1, y - 1, 3, 3);
      else ctx.fillText(DITHER_GLYPHS[Math.min(DITHER_GLYPHS.length - 1, Math.floor((i / steps) * DITHER_GLYPHS.length))], x, y);
    }
  }

  /**
   * 沿圆角矩形外扩的 ASCII 水波。字符数按初始周长每 WAVE_STEP 一个固定下来，
   * 每个字符固定在周长的同一比例位置上随外扩平滑移动；若每帧按固定间距重新排布，
   * 周长变长时字符会沿路径滑动、新字符不断冒出，看起来一抖一抖。
   */
  private drawWave(v: Wave, now: number): void {
    const { ctx } = this;
    const p = (now - v.born) / WAVE_MS;
    const d = (1 - Math.pow(1 - p, 3)) * WAVE_SPREAD;
    const x = v.rect.x - d;
    const y = v.rect.y - d;
    const w = v.rect.w + d * 2;
    const h = v.rect.h + d * 2;
    const r = WAVE_RADIUS + d;
    const sw = Math.max(0, w - 2 * r);
    const sh = Math.max(0, h - 2 * r);
    const arc = (Math.PI * r) / 2;
    const total = 2 * sw + 2 * sh + 4 * arc;
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.35 * (1 - p);
    const r0 = Math.min(WAVE_RADIUS, v.rect.w / 2, v.rect.h / 2);
    const total0 = 2 * (v.rect.w - 2 * r0) + 2 * (v.rect.h - 2 * r0) + 2 * Math.PI * r0;
    const n = Math.floor(total0 / WAVE_STEP);
    for (let i = 0; i < n; i++) {
      // 顺时针从上边起点出发，依次经过 上边、右上角、右边、右下角、下边、左下角、左边、左上角
      let s = (i / n) * total;
      let px: number;
      let py: number;
      if (s < sw) { px = x + r + s; py = y; }
      else if ((s -= sw) < arc) { const a = -Math.PI / 2 + s / r; px = x + w - r + r * Math.cos(a); py = y + r + r * Math.sin(a); }
      else if ((s -= arc) < sh) { px = x + w; py = y + r + s; }
      else if ((s -= sh) < arc) { const a = s / r; px = x + w - r + r * Math.cos(a); py = y + h - r + r * Math.sin(a); }
      else if ((s -= arc) < sw) { px = x + w - r - s; py = y + h; }
      else if ((s -= sw) < arc) { const a = Math.PI / 2 + s / r; px = x + r + r * Math.cos(a); py = y + h - r + r * Math.sin(a); }
      else if ((s -= arc) < sh) { px = x; py = y + h - r - s; }
      else { const a = Math.PI + (s - sh) / r; px = x + r + r * Math.cos(a); py = y + r + r * Math.sin(a); }
      ctx.fillStyle = v.dither ? '#fff' : PASTELS[i % PASTELS.length];
      ctx.fillText(WAVE_GLYPHS[i % WAVE_GLYPHS.length], px, py);
    }
  }

  private drawFrame(f: Frame, now: number): void {
    const { ctx } = this;
    const k = this.reduced.matches ? 1 : Math.min(1, (now - f.born) / FRAME_IN_MS) * 0.6 + 0.35;
    const lerp = (a: number, b: number) => a + (b - a) * k;
    f.current = {
      x: lerp(f.current.x, f.target.x),
      y: lerp(f.current.y, f.target.y),
      w: lerp(f.current.w, f.target.w),
      h: lerp(f.current.h, f.target.h),
    };
    let alpha = Math.min(1, (now - f.born) / FRAME_IN_MS + 0.3);
    let spread = 0;
    if (f.released) {
      const p = Math.min(1, (now - f.released) / FRAME_OUT_MS);
      alpha *= 1 - p;
      spread = p * 4;
    }
    const { x, y, w, h } = f.current;
    const x0 = x - spread;
    const y0 = y - spread;
    const x1 = x + w + spread;
    const y1 = y + h + spread;
    const arm = Math.min(6, w / 3, h / 3);

    if (this.preset === 'dither') {
      // 极淡的灰色细线框，无填充、无标签
      ctx.globalAlpha = alpha * 0.22;
      ctx.strokeStyle = DITHER_FRAME_COLOR;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0));
      return;
    }

    ctx.globalAlpha = alpha * 0.08;
    ctx.fillStyle = FRAME_COLOR;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

    // 四角准星
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = FRAME_COLOR;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [
      [x0, y0, 1, 1],
      [x1, y0, -1, 1],
      [x0, y1, 1, -1],
      [x1, y1, -1, -1],
    ]) {
      ctx.moveTo(cx + dx * arm, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * arm);
    }
    ctx.stroke();

    // 顶部坐标小标签
    ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let lx = x0;
    for (const text of f.label) {
      const tw = ctx.measureText(text).width + 6;
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = 'rgba(255, 80, 110, 0.85)';
      ctx.fillRect(lx, y0 - 13, tw, 11);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, lx + 3, y0 - 7.5);
      lx += tw + 3;
    }
  }
}
