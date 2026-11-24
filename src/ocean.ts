/**
 * 背景深海：程序化生物（水母、双髻鲨、鲸鲨、小鱼群）+ ASCII 暗流微粒。
 * 每个生物先用矢量形状画到一张低分辨率蒙版（1 像素 = 1 格），再逐格采样成「色块 + 格内字符」。
 */
import { drawFishSchool, drawWhaleShark } from './creatures';

/** 由暗到亮的字符梯度 */
const GLYPHS = ' .:-otX%8$';
/** 蒙版边长（格），需容纳最大的生物 */
const MASK = 72;
/** 点中生物后停顿发光的时长（秒） */
const GREET_S = 1.2;

export type Mix = 'all' | 'jelly' | 'shark';
export type Perf = 'saver' | 'standard' | 'smooth';

/** 性能档位：背景帧率与生物数量系数 */
const PERF: Record<Perf, { fps: number; count: number }> = {
  saver: { fps: 20, count: 0.6 },
  standard: { fps: 30, count: 1 },
  smooth: { fps: 60, count: 1 },
};

type Kind = 'jelly' | 'shark' | 'whale' | 'fish';
type RGB = [number, number, number];

interface Creature {
  kind: Kind;
  x: number;
  y: number;
  heading: number;
  /** 基础速度，px/s */
  speed: number;
  phase: number;
  /** 体长或伞径，单位：格 */
  size: number;
  /** 0.45~1，越小越远：更暗 */
  depth: number;
  /** 0~1 固定随机数，鱼群用它决定队形 */
  seed: number;
  color: RGB;
  tx: number;
  ty: number;
  /** 被点中后停顿发光，到这个模拟时刻（秒）为止 */
  greetUntil: number;
  /** 上一帧实际画出的范围（px），用于点击命中 */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
}

/** 每种生物的参数：尺寸与速度区间、最大角速度（rad/s）、相位推进 */
const SPECIES: Record<Kind, { size: [number, number]; speed: [number, number]; turn: number; palette: RGB[] }> = {
  jelly: { size: [5, 7.5], speed: [7, 12], turn: 0.25, palette: [[170, 165, 240], [180, 214, 226], [205, 180, 230]] },
  shark: { size: [24, 34], speed: [18, 28], turn: 0.4, palette: [[205, 194, 172], [152, 158, 210], [190, 196, 206]] },
  whale: { size: [32, 44], speed: [10, 16], turn: 0.2, palette: [[130, 150, 185], [160, 172, 196]] },
  fish: { size: [4, 6], speed: [30, 42], turn: 0.8, palette: [[200, 210, 225], [180, 170, 230], [160, 200, 215]] },
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

export class Ocean {
  private ctx: CanvasRenderingContext2D;
  private mask: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private creatures: Creature[] = [];
  private raf = 0;
  private lastFrame = 0;
  private t = 0;
  private paused = false;
  private reduced: MediaQueryList;
  private onReducedChange = () => this.start();

  constructor(
    private canvas: HTMLCanvasElement,
    /** 一格的 CSS 像素尺寸，也是背景网格线间距 */
    private cell: number,
    private mix: Mix,
    private perf: Perf,
  ) {
    this.ctx = canvas.getContext('2d')!;
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = MASK;
    maskCanvas.height = MASK;
    this.mask = maskCanvas.getContext('2d', { willReadFrequently: true })!;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced.addEventListener('change', this.onReducedChange);
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    if (w > 0 && this.creatures.length === 0) this.spawn();
    this.start();
    this.render();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.start();
  }

  setCell(cell: number): void {
    this.cell = cell;
    this.render();
  }

  setMix(mix: Mix): void {
    this.mix = mix;
    this.creatures = [];
    this.spawn();
    this.render();
  }

  setPerf(perf: Perf): void {
    this.perf = perf;
    this.creatures = [];
    this.spawn();
    this.render();
  }

  /**
   * 点击命中：从最上层（最近）的生物往下找，命中范围比实际画出的外扩 12px（游动的生物不好点）。
   * 命中后让它停顿发光，返回它的中心点（px）；没命中返回 null。
   */
  greetAt(x: number, y: number): { x: number; y: number } | null {
    const pad = 12;
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      const b = c.box;
      if (!b || x < b.x0 - pad || x > b.x1 + pad || y < b.y0 - pad || y > b.y1 + pad) continue;
      c.greetUntil = this.t + GREET_S;
      this.render();
      return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    }
    return null;
  }

  /** 视图可见且未暂停时开始循环；减少动态效果时只画一帧静态画面 */
  start(): void {
    if (this.raf || this.w === 0) return;
    if (this.paused || this.reduced.matches) {
      this.render();
      return;
    }
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.reduced.removeEventListener('change', this.onReducedChange);
  }

  private frame = (now: number): void => {
    this.raf = 0;
    // 切到其他标签页时容器被隐藏：停帧，等 ResizeObserver 在重新显示时再 start()
    if (this.paused || this.reduced.matches || !this.canvas.isShown()) return;
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = now - this.lastFrame;
    // 留 2ms 余量，避免 60fps 档因 rAF 抖动被误判为未到间隔而丢帧
    if (elapsed < 1000 / PERF[this.perf].fps - 2) return;
    this.lastFrame = now;
    const dt = Math.min(elapsed, 100) / 1000;
    this.t += dt;
    for (const c of this.creatures) this.move(c, dt);
    this.render();
  };

  private spawn(): void {
    if (this.w === 0) return;
    const n = Math.max(1, Math.min(5, Math.round((3 * this.w * this.h) / (1600 * 900))));
    const counts: Partial<Record<Kind, number>> =
      this.mix === 'jelly'
        ? { jelly: Math.round(n * 1.6) }
        : this.mix === 'shark'
          ? { shark: n, whale: 1 }
          : { jelly: n, shark: Math.max(1, Math.round(n * 0.7)), whale: 1, fish: Math.max(1, Math.round(n * 0.7)) };
    for (const kind of Object.keys(counts) as Kind[]) {
      const count = Math.max(1, Math.round(counts[kind]! * PERF[this.perf].count));
      for (let i = 0; i < count; i++) this.creatures.push(this.create(kind));
    }
    // 远处的先画，近处的盖在上面
    this.creatures.sort((a, b) => a.depth - b.depth);
  }

  private create(kind: Kind): Creature {
    const spec = SPECIES[kind];
    const depth = rand(0.45, 1);
    const c: Creature = {
      kind,
      x: rand(0, this.w),
      y: rand(0, this.h),
      heading: rand(0, Math.PI * 2),
      speed: rand(...spec.speed),
      phase: rand(0, Math.PI * 2),
      size: rand(...spec.size) * (0.6 + depth * 0.4),
      depth,
      seed: Math.random(),
      color: pick(spec.palette),
      tx: 0,
      ty: 0,
      greetUntil: 0,
      box: null,
    };
    this.retarget(c);
    return c;
  }

  /** 漫游目标可以略超出画面，生物会游出去再游回来 */
  private retarget(c: Creature): void {
    c.tx = rand(-0.15, 1.15) * this.w;
    c.ty = rand(-0.15, 1.15) * this.h;
  }

  private move(c: Creature, dt: number): void {
    const greeting = c.greetUntil > this.t;
    const dx = c.tx - c.x;
    const dy = c.ty - c.y;
    if (dx * dx + dy * dy < 60 * 60) this.retarget(c);
    // 平滑转向目标，最大角速度有限，游动轨迹呈弧线
    let diff = Math.atan2(dy, dx) - c.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const maxTurn = SPECIES[c.kind].turn * dt;
    if (!greeting) c.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));

    let v = c.speed;
    if (c.kind === 'jelly') {
      // 伞盖收缩时推进，舒张时滑行
      c.phase += dt * 1.7;
      v *= 0.35 + 0.9 * Math.max(0, Math.sin(c.phase));
    } else if (c.kind === 'fish') {
      c.phase += dt * 6;
    } else {
      c.phase += dt * ((c.kind === 'whale' ? 1.2 : 2.2) + c.speed * 0.06);
    }
    // 被点中时原地停顿（身体照常摆动）
    if (greeting) return;
    c.x += Math.cos(c.heading) * v * dt;
    c.y += Math.sin(c.heading) * v * dt;
  }

  private render(): void {
    if (this.w === 0) return;
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.font = `${this.cell - 1}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.drawCurrents();
    for (const c of this.creatures) this.drawCreature(c);
  }

  /** 极暗的 ASCII 暗流：几层缓慢移动的正弦场叠加，超过阈值的格子画 . : - */
  private drawCurrents(): void {
    const { ctx, t, cell } = this;
    const cols = Math.ceil(this.w / cell);
    const rows = Math.ceil(this.h / cell);
    // 场按 10px 基准格计算，换网格密度时暗流的形状和流速保持不变
    const k = cell / 10;
    ctx.fillStyle = 'rgb(150, 165, 185)';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const fc = c * k;
        const fr = r * k;
        const n =
          Math.sin(fc * 0.09 + t * 0.12) * Math.sin(fr * 0.21 - t * 0.08) +
          Math.sin((fc + fr * 0.6) * 0.045 - t * 0.05) * 0.7 +
          Math.sin(c * 1.7 + r * 3.1) * 0.12;
        if (n < 1.15) continue;
        ctx.globalAlpha = Math.min(0.2, (n - 1.15) * 0.4);
        ctx.fillText(n > 1.45 ? '-' : n > 1.3 ? ':' : '.', c * cell + cell / 2, r * cell + cell / 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawCreature(c: Creature): void {
    const m = this.mask;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, MASK, MASK);
    m.translate(MASK / 2, MASK / 2);
    m.rotate(c.heading);
    m.fillStyle = '#fff';
    m.strokeStyle = '#fff';
    m.lineCap = 'round';
    if (c.kind === 'jelly') drawJelly(m, c);
    else if (c.kind === 'shark') drawShark(m, c);
    else if (c.kind === 'whale') drawWhaleShark(m, c);
    else drawFishSchool(m, c);

    const data = m.getImageData(0, 0, MASK, MASK).data;
    const { ctx, cell } = this;
    // 蒙版中心对齐到全局网格，移动时按格步进，保留像素感
    const baseCol = Math.round(c.x / cell) - MASK / 2;
    const baseRow = Math.round(c.y / cell) - MASK / 2;
    // 被点中时亮度随一个 0→1→0 的包络增强
    const left = c.greetUntil - this.t;
    const glow = left > 0 ? Math.max(0.4, Math.sin(Math.PI * (1 - left / GREET_S))) : 0;
    const lift = glow * 70;
    const [r, g, b] = c.color.map((v) => Math.min(255, v + lift));
    const fade = Math.min(1, (0.35 + c.depth * 0.65) * (1 + glow * 0.8));
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let py = 0; py < MASK; py++) {
      for (let px = 0; px < MASK; px++) {
        const lum = data[(py * MASK + px) * 4 + 3] / 255;
        if (lum < 0.08) continue;
        const x = (baseCol + px) * cell;
        const y = (baseRow + py) * cell;
        if (x < -cell || y < -cell || x > this.w || y > this.h) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + cell);
        y1 = Math.max(y1, y + cell);
        ctx.fillStyle = `rgba(${r},${g},${b},${(lum * (0.3 + glow * 0.25) * fade).toFixed(3)})`;
        ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
        const glyph = GLYPHS[Math.min(GLYPHS.length - 1, Math.round(lum * (GLYPHS.length - 1)))];
        if (glyph === ' ') continue;
        ctx.fillStyle = `rgba(${Math.min(255, r + 40)},${Math.min(255, g + 40)},${Math.min(255, b + 40)},${((0.3 + lum * 0.65) * fade).toFixed(3)})`;
        ctx.fillText(glyph, x + cell / 2, y + cell / 2);
      }
    }
    c.box = x0 === Infinity ? null : { x0, y0, x1, y1 };
  }
}

/** 水母：朝 +x 方向的半椭圆伞盖（随相位搏动）+ 拖在身后的正弦触手与口腕 */
function drawJelly(m: CanvasRenderingContext2D, c: Creature): void {
  const s = c.size;
  const pulse = Math.sin(c.phase);
  const bw = s * (0.95 + 0.15 * pulse);
  const bh = s * (1 - 0.14 * pulse);

  m.globalAlpha = 0.5;
  m.beginPath();
  m.ellipse(0, 0, bw, bh, 0, -Math.PI / 2, Math.PI / 2);
  m.closePath();
  m.fill();
  m.globalAlpha = 0.35;
  m.beginPath();
  m.ellipse(bw * 0.3, 0, bw * 0.45, bh * 0.5, 0, 0, Math.PI * 2);
  m.fill();
  m.globalAlpha = 0.9;
  m.lineWidth = 0.8;
  m.beginPath();
  m.ellipse(0, 0, bw, bh, 0, -Math.PI / 2, Math.PI / 2);
  m.stroke();

  const len = s * 2.6;
  const tentacles = 6;
  m.lineWidth = 0.7;
  for (let i = 0; i < tentacles; i++) {
    const y0 = -bh * 0.85 + (i * 1.7 * bh) / (tentacles - 1);
    m.globalAlpha = 0.55;
    m.beginPath();
    m.moveTo(0, y0);
    for (let k = 1; k <= 12; k++) {
      const f = k / 12;
      m.lineTo(-len * f * (0.85 + 0.15 * Math.sin(i * 2.1)), y0 * (1 - 0.2 * f) + Math.sin(c.phase - k * 0.55 + i * 1.3) * (0.3 + f * 1.6));
    }
    m.stroke();
  }
  // 两条更粗、更短的口腕
  m.lineWidth = 1.6;
  m.globalAlpha = 0.42;
  for (const side of [-1, 1]) {
    m.beginPath();
    m.moveTo(0, side * bh * 0.2);
    for (let k = 1; k <= 8; k++) {
      const f = k / 8;
      m.lineTo(-len * 0.65 * f, side * bh * 0.2 + Math.sin(c.phase * 0.8 - k * 0.5 + side) * f * 1.4);
    }
    m.stroke();
  }
  m.globalAlpha = 1;
}

/** 双髻鲨（俯视）：朝 +x 方向，脊柱从头到尾做振幅递增的正弦摆动 */
function drawShark(m: CanvasRenderingContext2D, c: Creature): void {
  const L = c.size;
  const N = 14;
  const amp = L * 0.08;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    pts.push({ x: L * (0.5 - s), y: amp * Math.pow(s, 1.6) * Math.sin(c.phase - s * 5.5) });
  }
  // 体宽轮廓：颈部窄，胸部最宽，向尾柄收细
  const width = (s: number) => L * (s < 0.3 ? 0.06 + (s / 0.3) * 0.055 : 0.115 * Math.pow(1 - (s - 0.3) / 0.7, 1.3) + 0.012);
  const tangentAt = (i: number) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(N, i + 1)];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    // 朝向头部的单位向量
    return { x: (a.x - b.x) / d, y: (a.y - b.y) / d };
  };

  m.globalAlpha = 0.55;
  for (let i = 0; i <= N; i++) {
    m.beginPath();
    m.arc(pts[i].x, pts[i].y, width(i / N) / 2, 0, Math.PI * 2);
    m.fill();
  }
  // 脊线高光
  m.globalAlpha = 0.45;
  m.lineWidth = 0.7;
  m.beginPath();
  m.moveTo(pts[0].x, pts[0].y);
  for (const p of pts) m.lineTo(p.x, p.y);
  m.stroke();

  // 锤头与两端的眼睛
  const head = pts[0];
  const ht = tangentAt(0);
  const angle = Math.atan2(ht.y, ht.x);
  m.globalAlpha = 0.65;
  m.beginPath();
  m.ellipse(head.x, head.y, L * 0.045, L * 0.16, angle, 0, Math.PI * 2);
  m.fill();
  m.globalAlpha = 1;
  for (const side of [-1, 1]) {
    m.beginPath();
    m.arc(head.x - ht.y * side * L * 0.15, head.y + ht.x * side * L * 0.15, 0.7, 0, Math.PI * 2);
    m.fill();
  }

  // 鳍：胸鳍、腹鳍向后外侧展开
  const fin = (i: number, back: number, out: number, alpha: number) => {
    const p = pts[i];
    const t = tangentAt(i);
    m.globalAlpha = alpha;
    for (const side of [-1, 1]) {
      const nx = -t.y * side;
      const ny = t.x * side;
      m.beginPath();
      m.moveTo(p.x + t.x * L * 0.03, p.y + t.y * L * 0.03);
      m.lineTo(p.x - t.x * back * L + nx * out * L, p.y - t.y * back * L + ny * out * L);
      m.lineTo(p.x - t.x * L * 0.06, p.y - t.y * L * 0.06);
      m.closePath();
      m.fill();
    }
  };
  fin(4, 0.16, 0.17, 0.45);
  fin(9, 0.06, 0.06, 0.35);

  // 叉形尾鳍：上叶长、下叶短
  const tail = pts[N];
  const tt = tangentAt(N);
  m.globalAlpha = 0.6;
  m.lineWidth = 1;
  const lobe = (back: number, out: number) => {
    m.beginPath();
    m.moveTo(tail.x, tail.y);
    m.lineTo(tail.x - tt.x * back * L - tt.y * out * L, tail.y - tt.y * back * L + tt.x * out * L);
    m.stroke();
  };
  lobe(0.13, 0.09);
  lobe(0.08, -0.05);
  m.globalAlpha = 1;
}
