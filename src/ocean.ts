/**
 * 背景深海：程序化生物（水母、鲨、鲸鲨、蝠鲼）+ ASCII 暗流微粒。
 * 每个生物先画到一张带色光照的低分辨率蒙版（1 像素 = 1 格），蒙版双线性缩小后垫在下层当柔光，
 * 再逐格采样成「实心底色 + 格内字符」：暗部深底亮字，亮部浅底深字。
 */
import { CreatureShape, RGB, drawJelly, drawRay, drawShark, drawWhaleShark } from './creatures';

/** 由暗到亮的字符梯度 */
const GLYPHS = ' .:-otX%8$';
/** 蒙版边长（格），需容纳最大的生物 */
const MASK = 144;
/** 点中生物后停顿发光的时长（秒） */
const GREET_S = 1.2;
/** 停止打字后，跟随卡片的生物再停留多久才恢复漫游（秒） */
const FOLLOW_S = 2.5;
/** 保存水波触发转向加速游离的持续时长（秒） */
const BOOST_S = 1.4;
/** 暗部底色偏向的冷青蓝 */
const COLD: RGB = [20, 35, 58];
/** 亮部反相时的深色字 */
const DARK_INK = 'rgb(6,9,16)';
const CURRENT_INK = 'rgb(150,165,185)';

export type Mix = 'all' | 'jelly' | 'shark';
export type Perf = 'saver' | 'standard';

/** 性能档位：背景帧率与生物数量系数 */
const PERF: Record<Perf, { fps: number; count: number }> = {
  saver: { fps: 30, count: 0.6 },
  standard: { fps: 60, count: 1 },
};

type Kind = 'jelly' | 'shark' | 'whale' | 'ray';

interface Creature extends CreatureShape {
  kind: Kind;
  x: number;
  y: number;
  heading: number;
  /** 游速：体长/秒（水母为伞径/秒） */
  speed: number;
  /** 摆尾/搏动的相位推进速度，rad/s */
  beat: number;
  /** 0.45~1，越小越远：更暗 */
  depth: number;
  /** 亮字颜色（色相向白色靠拢） */
  ink: string;
  tx: number;
  ty: number;
  /** 被点中后停顿发光，到这个模拟时刻（秒）为止 */
  greetUntil: number;
  /** 保存水波触发后的加速转向游离截止时刻（秒），始终沿自身朝向游动、不硬平移 */
  boostUntil: number;
  /** 上一帧实际画出的范围（px），用于点击命中 */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
}

/** 一帧蒙版的采样结果：蒙版像素 (px, py) 对应屏幕格 (baseCol + px, baseRow + py)；(cx, cy) 是生物中心在蒙版里的坐标 */
interface Sample {
  data: Uint8ClampedArray;
  baseCol: number;
  baseRow: number;
  cx: number;
  cy: number;
}

/** 柔光层：低分辨率离屏图，px 为一个低分像素对应的 CSS 像素 */
interface Glow {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  px: number;
}

/**
 * 每种生物的参数：尺寸（格）、游速（体长/秒）、最大角速度（rad/s）、摆尾/搏动频率（rad/s）、调色板，
 * reach：绘制轮廓离生物中心（x, y）的最远距离上界（体长倍数，含 creatures.ts 里的蒙版平移和摆动），用于绕行卡片的舒适轨道半径。
 * 鲨鱼的调色板按 seed 三等分取色，与 drawShark 的品种对应：前两段为尖吻鲨（灰白、蓝灰），第三段为豹纹鲨（沙棕）。
 */
const SPECIES: Record<
  Kind,
  { size: [number, number]; speed: [number, number]; turn: number; beat: [number, number]; reach: number; palette: RGB[] }
> = {
  // 冰青、淡紫
  jelly: { size: [9.5, 13.5], speed: [0.18, 0.26], turn: 0.55, beat: [1.8, 2.4], reach: 2.6, palette: [[170, 225, 240], [195, 175, 240], [170, 165, 240]] },
  shark: { size: [48, 68], speed: [0.24, 0.34], turn: 0.6, beat: [2.4, 3.2], reach: 0.7, palette: [[190, 196, 206], [152, 158, 210], [214, 186, 140]] },
  // 暖金、米色、蓝灰
  whale: { size: [46, 62], speed: [0.2, 0.28], turn: 0.5, beat: [1.9, 2.5], reach: 0.68, palette: [[222, 192, 132], [210, 196, 168], [140, 160, 195]] },
  ray: { size: [20, 30], speed: [0.3, 0.38], turn: 0.75, beat: [2.0, 2.7], reach: 1.12, palette: [[150, 170, 205], [180, 172, 210]] },
};

const DRAW: Record<Kind, (m: CanvasRenderingContext2D, c: CreatureShape) => void> = {
  jelly: drawJelly,
  shark: drawShark,
  whale: drawWhaleShark,
  ray: drawRay,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** 整数格点哈希 → [0, 1) */
const hash = (x: number, y: number) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** 平滑值噪声 → [0, 1) */
const noise2 = (x: number, y: number) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};
const glowLayer = (): Glow => {
  const canvas = document.createElement('canvas');
  return { canvas, ctx: canvas.getContext('2d')!, px: 1 };
};

export class Ocean {
  private ctx: CanvasRenderingContext2D;
  private mask: CanvasRenderingContext2D;
  private near = glowLayer();
  private far = glowLayer();
  /** 字符精灵图：每种颜色一张，按格子尺寸与 DPR 预渲染，逐格 drawImage 代替 fillText */
  private atlases = new Map<string, HTMLCanvasElement>();
  private atlasKey = '';
  /** 精灵图里一格的设备像素边长 */
  private cellPx = 0;
  private w = 0;
  private h = 0;
  private creatures: Creature[] = [];
  private raf = 0;
  /** 上一次实际渲染的时刻，模拟 dt 取两次渲染的间隔 */
  private lastFrame = 0;
  /** 下一帧的截止时刻，按 1000/fps 固定推进 */
  private nextFrame = 0;
  private t = 0;
  private paused = false;
  /** 输入卡在视图里的矩形（px），由 react() 和 resize() 传入 */
  private card = { x: 0, y: 0, w: 0, h: 0 };
  /** 打字时靠近卡片的那只生物，跟随到 followUntil 为止 */
  private follower: Creature | null = null;
  private followUntil = 0;
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

  resize(w: number, h: number, card: { x: number; y: number; w: number; h: number }): void {
    this.w = w;
    this.h = h;
    this.card = card;
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

  /**
   * 回应输入：type 打字时最近的一只缓慢转向并沿卡片外圈巡游；
   * save 保存时所有生物随水波平滑转向并加速游离卡片（只通过转向和加速响应，绝不横滑）。
   */
  react(event: 'type' | 'save', card: { x: number; y: number; w: number; h: number }): void {
    this.card = card;
    const cx = card.x + card.w / 2;
    const cy = card.y + card.h / 2;
    if (event === 'type') {
      if (this.followUntil <= this.t || !this.follower || !this.creatures.includes(this.follower)) {
        let best = Infinity;
        for (const c of this.creatures) {
          const d = Math.hypot(c.x - cx, c.y - cy);
          if (d < best) {
            best = d;
            this.follower = c;
          }
        }
      }
      this.followUntil = this.t + FOLLOW_S;
      return;
    }
    this.followUntil = 0;
    const span = Math.max(this.w, this.h) * 0.55;
    for (const c of this.creatures) {
      const n = this.normal(c.x, c.y);
      const a = Math.atan2(n.y, n.x) + rand(-0.35, 0.35);
      c.boostUntil = this.t + BOOST_S;
      c.tx = c.x + Math.cos(a) * span;
      c.ty = c.y + Math.sin(a) * span;
    }
  }

  /** 卡片矩形上离 (x, y) 最近的边界点的外法线（单位向量）；已在卡片内时取最近那条边的外法线 */
  private normal(x: number, y: number): { x: number; y: number } {
    const r = this.card;
    const ox = x - Math.max(r.x, Math.min(r.x + r.w, x));
    const oy = y - Math.max(r.y, Math.min(r.y + r.h, y));
    const d = Math.hypot(ox, oy);
    if (d > 0) return { x: ox / d, y: oy / d };
    const left = x - r.x;
    const right = r.x + r.w - x;
    const top = y - r.y;
    const bottom = r.y + r.h - y;
    const min = Math.min(left, right, top, bottom);
    if (min === left) return { x: -1, y: 0 };
    if (min === right) return { x: 1, y: 0 };
    return min === top ? { x: 0, y: -1 } : { x: 0, y: 1 };
  }

  /** 视图可见且未暂停时开始循环；减少动态效果时只画一帧静态画面 */
  start(): void {
    if (this.raf || this.w === 0) return;
    if (this.paused || this.reduced.matches) {
      this.render();
      return;
    }
    this.lastFrame = performance.now();
    this.nextFrame = this.lastFrame + 1000 / PERF[this.perf].fps;
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
    // 留 2ms 余量，避免 rAF 抖动略早到被误判为未到截止时间而丢帧
    if (now < this.nextFrame - 2) return;
    // 截止时间按固定间隔推进而不是重置为 now，75/90/144Hz 屏上也能贴近目标帧率；
    // 落后超过一个间隔（卡顿、切回标签页）时跳到 now 之后的下一个截止点，不补帧
    const interval = 1000 / PERF[this.perf].fps;
    this.nextFrame += interval;
    if (this.nextFrame <= now) this.nextFrame = now + interval;
    const dt = Math.min(now - this.lastFrame, 100) / 1000;
    this.lastFrame = now;
    this.t += dt;
    for (const c of this.creatures) this.move(c, dt);
    this.render();
  };

  private spawn(): void {
    if (this.w === 0) return;
    const n = Math.max(1, Math.min(5, Math.round((3 * this.w * this.h) / (1600 * 900))));
    const counts: Partial<Record<Kind, number>> =
      this.mix === 'jelly'
        ? { jelly: Math.max(2, Math.round(n * 1.1)) }
        : this.mix === 'shark'
          ? { shark: Math.max(2, n), whale: 1 }
          : {
              jelly: Math.max(1, Math.round(n * 0.65)),
              shark: Math.max(2, Math.round(n * 0.85)),
              whale: 1,
              ray: 1,
            };
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
    const seed = Math.random();
    const color = kind === 'shark' ? spec.palette[Math.floor(seed * spec.palette.length)] : pick(spec.palette);
    const top = Math.max(...color);
    const hue = color.map((v) => (v * 255) / top) as RGB;
    const c: Creature = {
      kind,
      x: rand(0, this.w),
      y: rand(0, this.h),
      heading: rand(0, Math.PI * 2),
      speed: rand(...spec.speed),
      beat: rand(...spec.beat),
      phase: rand(0, Math.PI * 2),
      size: rand(...spec.size) * (0.6 + depth * 0.4),
      depth,
      seed,
      hue,
      bend: 0,
      ink: `rgb(${hue.map((v) => Math.round(v + (255 - v) * 0.45)).join(',')})`,
      tx: 0,
      ty: 0,
      greetUntil: 0,
      boostUntil: 0,
      box: null,
    };
    this.retarget(c);
    return c;
  }

  /** 漫游目标按生物体型外扩一段余量，大生物可以完整游出屏幕后再从容折返 */
  private retarget(c: Creature): void {
    const padX = Math.max(this.w * 0.15, c.size * this.cell * 0.65);
    const padY = Math.max(this.h * 0.15, c.size * this.cell * 0.65);
    c.tx = rand(-padX, this.w + padX);
    c.ty = rand(-padY, this.h + padY);
  }

  private move(c: Creature, dt: number): void {
    const greeting = c.greetUntil > this.t;
    const spec = SPECIES[c.kind];
    // 体长/秒 → px/s：换网格密度时相对体长的游速不变
    const v = c.speed * c.size * this.cell * (c.kind === 'jelly' ? 2 : 1);
    // 约 1.5 秒路程内算到达；按转弯半径（v / turn）放宽，不会绕着目标打转
    const reach = v * Math.max(1.5, 1.25 / spec.turn);
    if ((c.tx - c.x) ** 2 + (c.ty - c.y) ** 2 < reach * reach) this.retarget(c);

    let ax = c.tx;
    let ay = c.ty;
    let pace = 1;
    const boost = Math.max(0, c.boostUntil - this.t) / BOOST_S;
    const following = c === this.follower && this.followUntil > this.t && boost === 0;
    if (following) {
      // 柔和的卡片外圈巡游：只通过转向引导到切向轨道，绝不硬覆写位移导致横滑
      const r = this.card;
      const qx = Math.max(r.x, Math.min(r.x + r.w, c.x));
      const qy = Math.max(r.y, Math.min(r.y + r.h, c.y));
      const n = this.normal(c.x, c.y);
      const d = Math.hypot(c.x - qx, c.y - qy);
      const orbit = Math.min(Math.min(this.w, this.h) * 0.28, (c.size * spec.reach * 0.55 + 4) * this.cell);
      // 顺着当前朝向选左右切线，避免突然原地掉头
      const cos = Math.cos(c.heading);
      const sin = Math.sin(c.heading);
      const sign = -n.y * cos + n.x * sin >= 0 ? 1 : -1;
      const tx = -n.y * sign;
      const ty = n.x * sign;
      if (d > orbit * 1.15) {
        ax = qx + n.x * orbit + tx * orbit * 0.45;
        ay = qy + n.y * orbit + ty * orbit * 0.45;
        pace = 0.85;
      } else if (d >= orbit * 0.65) {
        ax = c.x + tx * orbit + n.x * (orbit - d);
        ay = c.y + ty * orbit + n.y * (orbit - d);
        pace = 0.65;
      } else {
        // 已在卡片附近或后方：沿切向带一点外偏自然游出，不倒退
        ax = c.x + (tx * 0.75 + n.x * 0.65) * orbit;
        ay = c.y + (ty * 0.75 + n.y * 0.65) * orbit;
        pace = 0.75;
      }
    }

    // 平滑转向目标，最大角速度有限，游动轨迹呈自然弧线
    let diff = Math.atan2(ay - c.y, ax - c.x) - c.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const maxTurn = spec.turn * (1 + 1.8 * boost) * dt;
    const stepTurn = greeting ? 0 : Math.max(-maxTurn, Math.min(maxTurn, diff));
    c.heading += stepTurn;

    // 身体弯曲随实际转向角速度变化（并随小夹角平滑衰减），不再在直游或慢转时长时间僵弯
    const turnRatio = maxTurn > 0 ? stepTurn / maxTurn : 0;
    const bendTarget = greeting ? 0 : turnRatio * smooth(0.02, 0.35, Math.abs(diff));
    c.bend += (bendTarget - c.bend) * Math.min(1, dt * 2.5);

    // 摆尾/搏动频率保持在自然区间，水波游离时略微加快拍尾
    c.phase += dt * c.beat * (1 + 0.5 * boost);
    // 水母伞盖收缩时推进、舒张时滑行（系数均值约 1）
    const k = c.kind === 'jelly' ? 0.55 + 1.4 * Math.max(0, Math.sin(c.phase)) : 1;
    // 被点中时原地停顿（身体照常摆动）
    if (greeting) return;

    // 位移始终严格沿自身朝向前进，绝不横滑或倒滑
    const step = v * pace * (1 + 0.9 * boost) * k * dt;
    c.x += Math.cos(c.heading) * step;
    c.y += Math.sin(c.heading) * step;
  }

  private render(): void {
    if (this.w === 0) return;
    const { ctx, cell } = this;
    const dpr = window.devicePixelRatio || 1;
    const key = `${cell}@${dpr}`;
    if (key !== this.atlasKey) {
      this.atlasKey = key;
      this.atlases.clear();
      this.cellPx = Math.round(cell * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawCurrents();

    // 省电档只画单层柔光；标准档远近分两层：远处更模糊、更冷、更暗，近处更清晰、微暖
    const layered = this.perf === 'standard';
    this.prepGlow(this.near, cell * (layered ? 2 : 3));
    if (layered) this.prepGlow(this.far, cell * 4);
    const samples: Sample[] = [];
    for (const c of this.creatures) {
      const s = this.paintMask(c);
      samples.push(s);
      const l = layered && c.depth < 0.72 ? this.far : this.near;
      // 浮点坐标，不吸附格子
      l.ctx.globalAlpha = 0.45 + c.depth * 0.55;
      l.ctx.drawImage(this.mask.canvas, (s.baseCol * cell) / l.px, (s.baseRow * cell) / l.px, (MASK * cell) / l.px, (MASK * cell) / l.px);
    }
    if (layered) {
      this.tintGlow(this.far, 'rgba(30, 60, 115, 0.5)');
      this.tintGlow(this.near, 'rgba(255, 214, 170, 0.1)');
      this.compositeGlow(this.far, 0.35);
    }
    this.compositeGlow(this.near, layered ? 0.5 : 0.45);

    this.creatures.forEach((c, i) => this.drawCells(c, samples[i]));
  }

  /** 预渲染一种颜色的字符精灵图 */
  private atlas(color: string): HTMLCanvasElement {
    let a = this.atlases.get(color);
    if (a) return a;
    const p = this.cellPx;
    a = document.createElement('canvas');
    a.width = p * GLYPHS.length;
    a.height = p;
    const g = a.getContext('2d')!;
    g.font = `${(this.cell - 1) * (p / this.cell)}px ui-monospace, Menlo, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    for (let i = 1; i < GLYPHS.length; i++) g.fillText(GLYPHS[i], i * p + p / 2, p / 2);
    this.atlases.set(color, a);
    return a;
  }

  private prepGlow(l: Glow, px: number): void {
    const gw = Math.ceil(this.w / px) + 1;
    const gh = Math.ceil(this.h / px) + 1;
    if (l.canvas.width !== gw || l.canvas.height !== gh) {
      l.canvas.width = gw;
      l.canvas.height = gh;
    } else {
      l.ctx.clearRect(0, 0, gw, gh);
    }
    l.px = px;
    l.ctx.imageSmoothingQuality = 'high';
  }

  /** 只给已有光的区域上色 */
  private tintGlow(l: Glow, color: string): void {
    const g = l.ctx;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = color;
    g.fillRect(0, 0, l.canvas.width, l.canvas.height);
    g.globalCompositeOperation = 'source-over';
  }

  /** 低分图双线性放大垫到主画布上，放大本身就是模糊（不用 ctx.filter） */
  private compositeGlow(l: Glow, alpha: number): void {
    const { ctx } = this;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = alpha;
    ctx.drawImage(l.canvas, 0, 0, l.canvas.width * l.px, l.canvas.height * l.px);
    ctx.globalAlpha = 1;
  }

  /** 暗流：低频包络圈出横向拉伸的成团波带，团内稀疏地画 . : ，团外基本不画 */
  private drawCurrents(): void {
    const { ctx, t, cell } = this;
    const cols = Math.ceil(this.w / cell);
    const rows = Math.ceil(this.h / cell);
    // 场按 10px 基准格计算，换网格密度时暗流的形状和流速保持不变
    const k = cell / 10;
    const ink = this.atlas(CURRENT_INK);
    const p = this.cellPx;
    // 只和列或只和行有关的项先算好，逐格只剩一次 sin 乘积
    const gateCol = new Float32Array(cols);
    const warpCol = new Float32Array(cols);
    for (let c = 0; c < cols; c++) {
      gateCol[c] = Math.sin(c * k * 0.05 + t * 0.02);
      warpCol[c] = Math.sin(c * k * 0.03 - t * 0.04) * 2.5;
    }
    for (let r = 0; r < rows; r++) {
      const fr = r * k;
      const gateRow = Math.sin(fr * 0.11 - t * 0.015);
      const warpRow = Math.sin(fr * 0.07 + t * 0.05) * 2 - t * 0.12;
      for (let c = 0; c < cols; c++) {
        const gate = gateCol[c] * gateRow;
        if (gate < 0.05) continue;
        const band = Math.sin(c * k * 0.11 + warpRow) * Math.sin(fr * 0.42 + warpCol[c]);
        const env = smooth(0.3, 0.8, band) * smooth(0.05, 0.6, gate);
        if (env < 0.03) continue;
        const grain = hash(c, r);
        // 团心密、团边疏
        if (grain > env * 1.3) continue;
        const gi = env > 0.85 && grain < 0.06 ? 3 : grain < env * 0.45 ? 2 : 1;
        ctx.globalAlpha = 0.35 * env;
        ctx.drawImage(ink, gi * p, 0, p, p, c * cell, r * cell, cell, cell);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 画一帧带色光照蒙版：按亚格小数平移，格子前沿逐渐变亮、尾部逐渐变暗，不再整只一下跳一格 */
  private paintMask(c: Creature): Sample {
    const m = this.mask;
    const gx = c.x / this.cell;
    const gy = c.y / this.cell;
    const cx = MASK / 2 + gx - Math.floor(gx);
    const cy = MASK / 2 + gy - Math.floor(gy);
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, MASK, MASK);
    m.translate(cx, cy);
    m.rotate(c.heading);
    m.lineCap = 'round';
    m.lineJoin = 'round';
    DRAW[c.kind](m, c);
    return {
      data: m.getImageData(0, 0, MASK, MASK).data,
      baseCol: Math.floor(gx) - MASK / 2,
      baseRow: Math.floor(gy) - MASK / 2,
      cx,
      cy,
    };
  }

  private drawCells(c: Creature, s: Sample): void {
    const { ctx, cell } = this;
    const { data, baseCol, baseRow } = s;
    // 被点中时亮度随一个 0→1→0 的包络增强
    const left = c.greetUntil - this.t;
    const glow = left > 0 ? Math.max(0.4, Math.sin(Math.PI * (1 - left / GREET_S))) : 0;
    const fade = Math.min(1, (0.35 + c.depth * 0.65) * (1 + glow * 0.8));
    const light = this.atlas(c.ink);
    const dark = this.atlas(DARK_INK);
    const p = this.cellPx;
    // 省电档不叠斑驳噪声
    const noisy = this.perf === 'standard';
    const cos = Math.cos(c.heading);
    const sin = Math.sin(c.heading);
    const seed = c.seed * 131;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let py = 0; py < MASK; py++) {
      for (let px = 0; px < MASK; px++) {
        const i = (py * MASK + px) * 4;
        const a = data[i + 3];
        if (a === 0) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const top = Math.max(r, g, b);
        let lum = (top * a) / 65025;
        if (lum < 0.08) continue;
        const x = (baseCol + px) * cell;
        const y = (baseRow + py) * cell;
        if (x < -cell || y < -cell || x > this.w || y > this.h) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + cell);
        y1 = Math.max(y1, y + cell);
        if (noisy) {
          // 低频噪声取在生物本体坐标上：跟着生物走、不随屏幕闪烁；高光处减弱，保住轮廓
          const dx = px + 0.5 - s.cx;
          const dy = py + 0.5 - s.cy;
          const n = noise2((dx * cos + dy * sin) * 0.25 + seed, (dy * cos - dx * sin) * 0.25);
          lum = Math.max(0, lum + (n - 0.5) * 0.2 * (1 - smooth(0.75, 0.95, lum)));
        }
        lum = Math.min(1, lum * (1 + glow * 0.6));

        // 底色：色相取蒙版颜色，暗部偏向冷青蓝，lum > 0.8 提白
        const toHue = smooth(0.05, 0.6, lum);
        const white = lum > 0.8 ? (lum - 0.8) * 3 : 0;
        let cr = COLD[0] + ((r * 255) / top - COLD[0]) * toHue;
        let cg = COLD[1] + ((g * 255) / top - COLD[1]) * toHue;
        let cb = COLD[2] + ((b * 255) / top - COLD[2]) * toHue;
        cr += (255 - cr) * white;
        cg += (255 - cg) * white;
        cb += (255 - cb) * white;
        ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${(Math.pow(lum, 0.8) * 0.85 * fade).toFixed(3)})`;
        ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);

        const gi = Math.min(GLYPHS.length - 1, Math.round(lum * (GLYPHS.length - 1)));
        if (gi === 0) continue;
        // lum 0.55~0.7 之间亮字平滑过渡到深字
        const inv = smooth(0.55, 0.7, lum);
        if (inv < 1) {
          ctx.globalAlpha = (0.3 + lum * 0.65) * fade * (1 - inv);
          ctx.drawImage(light, gi * p, 0, p, p, x, y, cell, cell);
        }
        if (inv > 0) {
          ctx.globalAlpha = (0.7 + lum * 0.25) * Math.min(1, fade * 1.25) * inv;
          ctx.drawImage(dark, gi * p, 0, p, p, x, y, cell, cell);
        }
        ctx.globalAlpha = 1;
      }
    }
    c.box = x0 === Infinity ? null : { x0, y0, x1, y1 };
  }
}
