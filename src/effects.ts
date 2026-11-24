/**
 * 输入特效，三档预设：
 * - Pastel：柔彩涟漪、准星词框（输入法组字时锁定，标 X/Y 坐标胶囊）、上屏迸柔彩 ASCII、换行 ASCII 彗星尾迹；
 * - Dither：1-bit 黑白墨滴飞溅、换行时头宽尾尖的 Bayer 像素彗尾、极淡细线词框；
 * - off：不画任何打字特效。
 * 两种动效预设都会给刚上屏的词组叠一层淡色块，另有通用的保存水波 wave()。
 * 特效画在覆盖整个视图的独立 Canvas 上，坐标都相对视图根节点。
 * 克制红线：不遮挡正在辨认的字，所有痕迹在 500ms 内消散。
 */

export interface Point {
  x: number;
  y: number;
  /** 行高 */
  h: number;
}

export type Preset = 'pastel' | 'dither' | 'off';

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

/** Dither 彗尾路径上的采样点：按弧长每 PIXEL 一个，带单位法线 */
interface PathPoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

interface Comet {
  from: Point;
  to: Point;
  born: number;
  /** Dither 像素带的路径采样，Pastel 为 null */
  path: PathPoint[] | null;
  /** 彗头是否已落到新行行首（落点迸墨滴只迸一次） */
  landed: boolean;
}

/**
 * 一颗飞溅物：Dither 是方块墨滴，Pastel 上屏时是柔彩 ASCII 字符（glyph/color 有值）。
 * life：寿命占 INK_MS 的比例，各不相同，让它们错开消失。
 */
interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  glyph?: string;
  color?: string;
}

/** 一次迸出的一组飞溅物 */
interface Ink {
  born: number;
  gravity: number;
  drops: Drop[];
}

/** 刚上屏词组的淡色块 */
interface Glow {
  rect: Rect;
  born: number;
  color: string;
  /** 创建时 textarea 的滚动位置，绘制时按滚动差修正，输入框上滚后色块跟着文字走 */
  scrollLeft: number;
  scrollTop: number;
}

interface Wave {
  rect: Rect;
  born: number;
}

interface Frame {
  target: Rect;
  current: Rect;
  label: string;
  /** 词框在第 2 行及以后时，标签放到词框下方，避免压住上一行文字 */
  below: boolean;
  born: number;
  /** compositionend 之后开始淡出的时刻 */
  released: number;
}

const PASTELS = ['#a5b4fc', '#f9a8d4', '#99f6e4', '#fde68a', '#c4b5fd'];
const FRAME_COLOR = '#ff6b8a';
const RIPPLE_MS = 450;
const COMET_MS = 340;
const TRAIL_MS = 160;
const FRAME_IN_MS = 180;
const FRAME_OUT_MS = 300;
const TRAIL_GLYPHS = '$%*+:.';
const INK_MS = 420;
const INK_GRAVITY = 260;
/** 同屏飞溅物上限，组字小墨滴超过时不再迸 */
const MAX_DROPS = 60;
/** 组字小墨滴的节流间隔 */
const SPRINKLE_MS = 60;
const SCATTER_GLYPHS = '$%Xt:';
const GLOW_MS = 500;
const GLOW_ALPHA = 0.2;
const DITHER_GLOW_COLOR = '#9db4d6';
/** Dither 彗尾的像素格边长与彗头宽度 */
const PIXEL = 2;
const HEAD_W = 12;
const DITHER_FRAME_COLOR = '#ffffff';
const WAVE_MS = 700;
const WAVE_SPREAD = 60;
const WAVE_RADIUS = 16;
const WAVE_STEP = 10;
const WAVE_GLYPHS = '.:~';
/** 4x4 Bayer 有序抖动矩阵 */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
const easeOut = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 2);

/** 换行彗星的弧线：从换行前光标出发，略向下拱，落到新行行首；t ∈ [0, 1] */
function curve(from: Point, to: Point, t: number): { x: number; y: number } {
  const cx = (from.x + to.x) / 2;
  const cy = from.y + from.h * 0.2;
  const x0 = from.x;
  const y0 = from.y + from.h / 2;
  const x1 = to.x;
  const y1 = to.y + to.h / 2;
  return {
    x: (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1,
    y: (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1,
  };
}

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
  private glows: Glow[] = [];
  private waves: Wave[] = [];
  private preset: Preset = 'pastel';
  private frame: Frame | null = null;
  private raf = 0;
  private colorIndex = 0;
  private lastSprinkle = 0;
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

  /** 切换预设时清掉进行中的特效，旧预设的痕迹不跨预设残留 */
  setPreset(preset: Preset): void {
    this.preset = preset;
    this.ripples = [];
    this.comets = [];
    this.inks = [];
    this.glows = [];
    this.waves = [];
    this.frame = null;
    this.draw(performance.now());
  }

  ripple(at: Point): void {
    if (this.still) return;
    if (this.preset === 'dither') {
      this.splash(at.x, at.y + at.h / 2, 6 + Math.floor(Math.random() * 5), 2, 4, 50, 120);
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
    if (this.still) return;
    const path = this.preset === 'dither' ? this.trace(from, to) : null;
    this.comets.push({ from, to, born: performance.now(), path, landed: false });
    this.kick();
  }

  /** 保存想法时从输入卡边缘向外荡开一圈 ASCII 水波，rect 为输入卡相对视图根节点的矩形 */
  wave(rect: Rect): void {
    if (this.still) return;
    this.waves.push({ rect, born: performance.now() });
    this.kick();
  }

  /** 组字更新：词框套住 [start, end) 的文字并标出逻辑行列；Dither 下在光标处迸几颗小墨滴 */
  compose(start: number, end: number): void {
    if (this.preset === 'off') return;
    const r = this.wordRect(start, end);
    const target: Rect = { x: r.x - 4, y: r.y - 2, w: r.w + 8, h: r.h + 4 };
    const before = this.ta.value.slice(0, start);
    const label = `X:${start - before.lastIndexOf('\n')} Y:${before.split('\n').length}`;
    // 不在第一条视觉行时，上方紧挨着上一行文字
    const below = r.y - this.caretAt(0).y > r.h;
    const now = performance.now();
    if (this.frame && !this.frame.released) {
      this.frame.target = target;
      this.frame.label = label;
      this.frame.below = below;
    } else {
      // 新出现的词框从放大的状态收拢到目标，像准星锁定
      const grow = this.reduced.matches ? 0 : 10;
      this.frame = {
        target,
        current: { x: target.x - grow, y: target.y - grow, w: target.w + grow * 2, h: target.h + grow * 2 },
        label,
        below,
        born: now,
        released: 0,
      };
    }
    if (this.preset === 'dither' && !this.reduced.matches && now - this.lastSprinkle > SPRINKLE_MS) {
      const count = this.inks.reduce((n, k) => n + k.drops.length, 0);
      if (count < MAX_DROPS) {
        this.lastSprinkle = now;
        this.splash(r.x + r.w, r.y + r.h / 2, 3 + Math.floor(Math.random() * 2), 1, 2, 30, 70);
      }
    }
    this.kick();
  }

  /**
   * 组字上屏：词框淡出，迸完整涟漪/墨滴，给 [start, end) 叠一层淡色块；Pastel 另在词组周围迸柔彩 ASCII。
   * data 为 compositionend 的上屏文字，为空表示取消组字：只释放词框，不播上屏效果。
   */
  commit(start: number, end: number, data: string): void {
    if (this.frame) this.frame.released = performance.now();
    this.kick();
    if (this.preset === 'off' || !data) return;
    this.ripple(this.caretAt(end));
    if (end <= start) return;
    const rect = this.wordRect(start, end);
    const color = this.preset === 'dither' ? DITHER_GLOW_COLOR : PASTELS[(this.colorIndex + PASTELS.length - 1) % PASTELS.length];
    this.glows.push({ rect, born: performance.now(), color, scrollLeft: this.ta.scrollLeft, scrollTop: this.ta.scrollTop });
    if (this.preset === 'pastel' && !this.reduced.matches) this.scatter(rect);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.mirror.remove();
  }

  /** 动效被关：系统要求减少动态，或预设为 off */
  private get still(): boolean {
    return this.reduced.matches || this.preset === 'off';
  }

  /** [start, end) 文字所在的最后一条视觉行（折行时只取最后一行），高度收窄到字身 */
  private wordRect(start: number, end: number): Rect {
    const a = this.caretAt(start);
    const b = this.caretAt(end);
    const left = Math.abs(a.y - b.y) < 2 ? a.x : this.caretAt(this.lineStartOf(end)).x;
    const th = Math.min(b.h, parseFloat(getComputedStyle(this.ta).fontSize) * 1.45);
    return { x: left, y: b.y + (b.h - th) / 2, w: Math.max(b.x - left, 6), h: th };
  }

  private lineStartOf(index: number): number {
    // 找到 end 所在视觉行的起点：从 index 往前逐字测量，直到 y 变化
    const y = this.caretAt(index).y;
    let i = index;
    while (i > 0 && Math.abs(this.caretAt(i - 1).y - y) < 2) i--;
    return i;
  }

  /** 从 (x, y) 迸一组方块墨滴，数量、边长、初速度都在给定区间内随机 */
  private splash(x: number, y: number, count: number, minSize: number, maxSize: number, minSpeed: number, maxSpeed: number): void {
    const drops = Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
      return {
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        size: minSize + Math.floor(Math.random() * (maxSize - minSize + 1)),
        life: 0.45 + Math.random() * 0.55,
      };
    });
    this.inks.push({ born: performance.now(), gravity: INK_GRAVITY, drops });
    this.kick();
  }

  /** Pastel 上屏：从词组右端和上下边外侧迸出一小片柔彩 ASCII 字符，向外飘散，不从字上起飞 */
  private scatter(r: Rect): void {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const drops = Array.from({ length: 6 + Math.floor(Math.random() * 4) }, () => {
      let x: number;
      let y: number;
      if (Math.random() < 0.4) {
        x = r.x + r.w + 4 + Math.random() * 8;
        y = r.y + Math.random() * r.h;
      } else {
        x = r.x + Math.random() * r.w;
        y = Math.random() < 0.5 ? r.y - 5 : r.y + r.h + 5;
      }
      const dx = x - cx;
      const dy = (y - cy) * 2;
      const len = Math.hypot(dx, dy) || 1;
      const speed = 25 + Math.random() * 30;
      return {
        x,
        y,
        vx: (dx / len) * speed,
        vy: (dy / len) * speed,
        size: 0,
        life: 0.6 + Math.random() * 0.4,
        glyph: SCATTER_GLYPHS[Math.floor(Math.random() * SCATTER_GLYPHS.length)],
        color: PASTELS[Math.floor(Math.random() * PASTELS.length)],
      };
    });
    this.inks.push({ born: performance.now(), gravity: 40, drops });
  }

  /** 把彗星弧线按弧长每 PIXEL 重采样，像素带的抖动阈值锚定在这些固定采样点上 */
  private trace(from: Point, to: Point): PathPoint[] {
    const pts = Array.from({ length: 65 }, (_, i) => curve(from, to, i / 64));
    const out: PathPoint[] = [];
    let acc = 0;
    let next = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      const seg = Math.hypot(dx, dy);
      if (!seg) continue;
      for (; next <= acc + seg; next += PIXEL) {
        const t = (next - acc) / seg;
        out.push({ x: pts[i - 1].x + dx * t, y: pts[i - 1].y + dy * t, nx: -dy / seg, ny: dx / seg });
      }
      acc += seg;
    }
    return out;
  }

  private kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    // 落点墨滴要在 raf 清零前迸：splash 里的 kick 见 raf 非零不会重复排帧
    for (const c of this.comets) {
      // Dither 彗头落到新行行首时迸一次小墨滴
      if (c.path && !c.landed && now - c.born >= COMET_MS) {
        c.landed = true;
        this.splash(c.to.x, c.to.y + c.to.h / 2, 4 + Math.floor(Math.random() * 2), 2, 3, 40, 90);
      }
    }
    this.raf = 0;
    this.ripples = this.ripples.filter((r) => now - r.born < RIPPLE_MS);
    this.comets = this.comets.filter((c) => now - c.born < COMET_MS + TRAIL_MS);
    this.inks = this.inks.filter((k) => now - k.born < INK_MS);
    this.glows = this.glows.filter((g) => now - g.born < GLOW_MS);
    this.waves = this.waves.filter((v) => now - v.born < WAVE_MS);
    if (this.frame?.released && now - this.frame.released > FRAME_OUT_MS) this.frame = null;
    this.draw(now);
    if (this.ripples.length || this.comets.length || this.inks.length || this.glows.length || this.waves.length || this.frame) {
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  private draw(now: number): void {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.glows.length) {
      // 色块裁剪到 textarea 的可见区域（padding box），滚出输入框的部分不画
      const { ta } = this;
      const taRect = ta.getBoundingClientRect();
      const rootRect = this.root.getBoundingClientRect();
      ctx.save();
      ctx.beginPath();
      ctx.rect(taRect.left - rootRect.left + ta.clientLeft, taRect.top - rootRect.top + ta.clientTop, ta.clientWidth, ta.clientHeight);
      ctx.clip();
      for (const g of this.glows) this.drawGlow(g, now);
      ctx.restore();
    }
    for (const r of this.ripples) this.drawRipple(r, now);
    for (const k of this.inks) this.drawInk(k, now);
    for (const c of this.comets) this.drawComet(c, now);
    for (const v of this.waves) this.drawWave(v, now);
    if (this.frame) this.drawFrame(this.frame, now);
    ctx.globalAlpha = 1;
  }

  /** 刚上屏词组的圆角淡色块：textarea 不能给局部文字上色，用 fx 画布上的低 alpha 色块代替 */
  private drawGlow(g: Glow, now: number): void {
    const { ctx } = this;
    const p = (now - g.born) / GLOW_MS;
    const { w, h } = g.rect;
    const x = g.rect.x - (this.ta.scrollLeft - g.scrollLeft);
    const y = g.rect.y - (this.ta.scrollTop - g.scrollTop);
    ctx.globalAlpha = GLOW_ALPHA * (1 - p * p);
    ctx.fillStyle = g.color;
    ctx.beginPath();
    ctx.roundRect(x - 3, y, w + 6, h, 4);
    ctx.fill();
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
    if (c.path) {
      this.drawDitherComet(c.path, age);
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
      const pt = curve(c.from, c.to, easeOut(p));
      ctx.globalAlpha = Math.max(0, (1 - i / steps) * 0.85 * fadeOut);
      ctx.fillStyle = PASTELS[i % PASTELS.length];
      ctx.fillText(TRAIL_GLYPHS[Math.min(TRAIL_GLYPHS.length - 1, Math.floor((i / steps) * TRAIL_GLYPHS.length))], pt.x, pt.y);
    }
  }

  /**
   * 飞溅物：带初速度溅开、受重力下落。方块墨滴在各自寿命内按整像素缩小后消失；ASCII 字符按寿命淡出。
   * 不按屏幕坐标做抖动阈值：墨滴在移动，按坐标取阈值会让它每帧随机闪烁。
   */
  private drawInk(k: Ink, now: number): void {
    const { ctx } = this;
    const t = (now - k.born) / 1000;
    ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const d of k.drops) {
      const p = (now - k.born) / (INK_MS * d.life);
      if (p >= 1) continue;
      const x = d.x + d.vx * t;
      const y = d.y + d.vy * t + 0.5 * k.gravity * t * t;
      if (d.glyph) {
        ctx.globalAlpha = 0.85 * (1 - p);
        ctx.fillStyle = d.color!;
        ctx.fillText(d.glyph, Math.round(x), Math.round(y));
        continue;
      }
      const size = Math.max(1, Math.ceil(d.size * (1 - p)));
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
    }
  }

  /**
   * 1-bit 像素彗尾：沿弧线从尾到头逐个采样点铺 PIXEL 见方的白块，宽度从尾部 1px 渐粗到彗头 HEAD_W，
   * 彗头最后半个头宽收成半圆刷头。亮度随离头距离和离中线距离衰减，低于 Bayer 阈值的格子不画。
   * 阈值按（路径采样序号, 横向格序号）取，锚定在固定的路径上而不是屏幕坐标，否则彗尾移动时会每帧随机闪烁。
   */
  private drawDitherComet(path: PathPoint[], age: number): void {
    const { ctx } = this;
    const last = path.length - 1;
    if (last < 1) return;
    const head = easeOut(age / COMET_MS) * last;
    const tail = easeOut((age - TRAIL_MS) / COMET_MS) * last;
    const span = head - tail;
    const fade = age > COMET_MS ? Math.max(0, 1 - (age - COMET_MS) / TRAIL_MS) : 1;
    const r = HEAD_W / 2;
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 1;
    for (let k = Math.ceil(tail); k <= head; k++) {
      const s = span > 0 ? (k - tail) / span : 1;
      const d = (head - k) * PIXEL;
      let w = 1 + (HEAD_W - 1) * Math.pow(s, 1.5);
      if (d < r) w = Math.min(w, 2 * Math.sqrt(r * r - (r - d) * (r - d)));
      const cells = Math.max(1, Math.round(w / PIXEL));
      const size = w < PIXEL ? 1 : PIXEL;
      const bright = (0.3 + 0.7 * s) * fade;
      const p = path[k];
      for (let m = 0; m < cells; m++) {
        const off = (m - (cells - 1) / 2) * PIXEL;
        const edge = cells > 1 ? Math.abs(off) / (w / 2) : 0;
        if (bayer(k, m - (cells >> 1)) >= bright * (1 - 0.5 * edge * edge)) continue;
        const x = Math.floor((p.x + p.nx * off) / PIXEL) * PIXEL;
        const y = Math.floor((p.y + p.ny * off) / PIXEL) * PIXEL;
        ctx.fillRect(x, y, size, size);
      }
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
      ctx.fillStyle = this.preset === 'dither' ? '#fff' : PASTELS[i % PASTELS.length];
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

    // 坐标胶囊：约 10px 高，默认在词框上方，第 2 行起放到下方
    ctx.font = '8px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(f.label).width + 8;
    const ly = f.below ? y1 + 2 : y0 - 12;
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = 'rgba(255, 80, 110, 0.85)';
    ctx.beginPath();
    ctx.roundRect(x0, ly, tw, 10, 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(f.label, x0 + 4, ly + 5.5);
  }
}
