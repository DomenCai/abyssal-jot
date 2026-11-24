/** 生物的带色光照蒙版绘制。
 *  调用前蒙版已 translate 到生物中心并 rotate 到朝向，生物朝 +x，单位为格（1 像素 = 1 格）。
 *  颜色 = 归一化色相 × 光照强度 level（0~1），采样端用最亮通道 × alpha 还原亮度 lum，
 *  所以「亮」靠 level 表达，alpha 只用于抗锯齿和半透明。 */

export type RGB = [number, number, number];

export interface CreatureShape {
  size: number;
  phase: number;
  seed: number;
  /** 归一化色相：最亮通道 = 255 */
  hue: RGB;
}

type P = { x: number; y: number };

/** 光照强度 level 下的颜色 */
const shade = (hue: RGB, level: number) => `rgb(${(hue[0] * level) | 0},${(hue[1] * level) | 0},${(hue[2] * level) | 0})`;

/** 身体分层：[体宽比例, 光照强度]，由外到内越窄越亮 */
const BODY_LAYERS: [number, number][] = [
  [1, 0.3],
  [0.75, 0.5],
  [0.5, 0.7],
  [0.25, 0.92],
];

/** 每个脊柱点朝向头部的单位切向量 */
function tangents(pts: P[]): P[] {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    return { x: (a.x - b.x) / d, y: (a.y - b.y) / d };
  });
}

/** 沿脊柱画分层身体：每层按体宽收窄、亮度递增，得到「边缘暗 → 体侧 → 背脊高光」的法线渐变 */
function layeredBody(m: CanvasRenderingContext2D, pts: P[], widths: number[], hue: RGB, layers = BODY_LAYERS): void {
  const ts = tangents(pts);
  for (const [k, level] of layers) {
    m.fillStyle = shade(hue, level);
    m.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const h = (widths[i] * k) / 2;
      m.lineTo(pts[i].x - ts[i].y * h, pts[i].y + ts[i].x * h);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const h = (widths[i] * k) / 2;
      m.lineTo(pts[i].x + ts[i].y * h, pts[i].y - ts[i].x * h);
    }
    m.closePath();
    m.fill();
  }
}

/** 一对向后外侧展开的三角鳍；out 为翼尖到脊柱的横向距离（格） */
function finPair(m: CanvasRenderingContext2D, p: P, t: P, L: number, back: number, out: number, root: number, color: string): void {
  m.fillStyle = color;
  for (const side of [-1, 1]) {
    const nx = -t.y * side;
    const ny = t.x * side;
    m.beginPath();
    m.moveTo(p.x + t.x * root * 0.5, p.y + t.y * root * 0.5);
    m.lineTo(p.x - t.x * back * L + nx * out, p.y - t.y * back * L + ny * out);
    m.lineTo(p.x - t.x * root, p.y - t.y * root);
    m.closePath();
    m.fill();
  }
}

/** 按段画一条渐暗的线：level 从 from 线性降到 to */
function fadingLine(m: CanvasRenderingContext2D, pts: P[], hue: RGB, from: number, to: number): void {
  for (let k = 1; k < pts.length; k++) {
    m.strokeStyle = shade(hue, from + ((to - from) * k) / (pts.length - 1));
    m.beginPath();
    m.moveTo(pts[k - 1].x, pts[k - 1].y);
    m.lineTo(pts[k].x, pts[k].y);
    m.stroke();
  }
}

/** 水母（侧视）：朝 +x 的中空玻璃伞罩（伞缘亮环、内部暗透、口腕核心发光）+ 拖在身后的长触手。
 *  触手很长，整体在蒙版里向 +x 偏置，让伞顶到触手末端的包围盒居中，避免被截断。 */
export function drawJelly(m: CanvasRenderingContext2D, c: CreatureShape): void {
  const s = c.size;
  const hue = c.hue;
  const pulse = Math.sin(c.phase);
  const bw = s * (0.95 + 0.15 * pulse);
  const bh = s * (1 - 0.14 * pulse);
  const len = s * 3.6;
  m.translate((len - bw) / 2, 0);

  // 触手：从伞缘垂下，越往末端越暗
  const tentacles = 8;
  m.lineWidth = 0.6;
  for (let i = 0; i < tentacles; i++) {
    const y0 = -bh * 0.9 + (i * 1.8 * bh) / (tentacles - 1);
    const tl = len * (0.75 + 0.25 * Math.abs(Math.sin(i * 2.1 + c.seed * 9)));
    const pts: P[] = [];
    for (let k = 0; k <= 14; k++) {
      const f = k / 14;
      pts.push({ x: -tl * f, y: y0 * (1 - 0.25 * f) + Math.sin(c.phase - k * 0.5 + i * 1.3) * (0.3 + f * 2.2) });
    }
    fadingLine(m, pts, hue, 0.62, 0.25);
  }
  // 口腕：两条粗丝带，中心一线更亮
  for (const side of [-1, 1]) {
    const arm = () => {
      m.beginPath();
      for (let k = 0; k <= 10; k++) {
        const f = k / 10;
        m.lineTo(bw * 0.15 - len * 0.62 * f, side * bh * 0.14 * (1 - f * 0.5) + Math.sin(c.phase * 0.8 - k * 0.5 + side) * f * 1.8);
      }
      m.stroke();
    };
    m.lineWidth = 2.2;
    m.strokeStyle = shade(hue, 0.42);
    arm();
    m.lineWidth = 0.9;
    m.strokeStyle = shade(hue, 0.82);
    arm();
  }

  // 伞罩：内层向 +x 收、越往里越暗，留下一圈亮伞缘和亮外壁 = 中空玻璃感
  for (const [k, level] of [
    [1, 0.55],
    [0.86, 0.3],
    [0.7, 0.14],
  ]) {
    m.fillStyle = shade(hue, level);
    m.beginPath();
    m.ellipse(bw * (1 - k) * 0.4, 0, bw * k, bh * k, 0, -Math.PI / 2, Math.PI / 2);
    m.closePath();
    m.fill();
  }
  // 伞顶弧形高光
  m.strokeStyle = shade(hue, 0.95);
  m.lineWidth = 1.1;
  m.beginPath();
  m.ellipse(0, 0, bw * 0.93, bh * 0.93, 0, -0.9, 0.9);
  m.stroke();
  // 伞缘：侧视为一条微微起伏的亮线
  m.strokeStyle = shade(hue, 0.8);
  m.lineWidth = 1;
  m.beginPath();
  for (let k = 0; k <= 12; k++) {
    const f = k / 12;
    m.lineTo(Math.sin(f * 12 + c.phase * 2) * 0.3, -bh + 2 * bh * f);
  }
  m.stroke();
  // 口腕核心：伞内发光的胃腔
  m.fillStyle = shade(hue, 0.5);
  m.beginPath();
  m.ellipse(bw * 0.28, 0, bw * 0.34, bh * 0.32, 0, 0, Math.PI * 2);
  m.fill();
  m.fillStyle = shade(hue, 1);
  m.beginPath();
  m.ellipse(bw * 0.28, 0, bw * 0.2, bh * 0.18, 0, 0, Math.PI * 2);
  m.fill();
}

/** 鲨（俯视）：朝 +x，脊柱从头到尾做振幅递增的正弦摆动。seed < 0.5 为双髻鲨（锤头），否则为尖吻流线型 */
export function drawShark(m: CanvasRenderingContext2D, c: CreatureShape): void {
  const L = c.size;
  const hue = c.hue;
  const hammer = c.seed < 0.5;
  const N = 16;
  const amp = L * 0.08;
  // 体宽轮廓：双髻鲨颈部窄、胸部最宽；尖吻鲨从吻尖迅速变宽，体型更粗壮
  const width = hammer
    ? (s: number) => L * (s < 0.3 ? 0.06 + (s / 0.3) * 0.055 : 0.115 * Math.pow(1 - (s - 0.3) / 0.7, 1.3) + 0.012)
    : (s: number) => L * (s < 0.3 ? 0.16 * Math.pow(s / 0.3, 0.6) + 0.01 : 0.16 * Math.pow(1 - (s - 0.3) / 0.7, 1.2) + 0.012);
  const pts: P[] = [];
  const widths: number[] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    pts.push({ x: L * (0.5 - s), y: amp * Math.pow(s, 1.6) * Math.sin(c.phase - s * 5.5) });
    widths.push(width(s));
  }
  const ts = tangents(pts);

  // 鳍比身体暗，先画，被身体盖住根部
  const fin = (i: number, back: number, out: number, level: number) =>
    finPair(m, pts[i], ts[i], L, back, out * L, L * 0.06, shade(hue, level));
  if (hammer) fin(5, 0.16, 0.17, 0.34);
  else fin(5, 0.2, 0.25, 0.36);
  fin(11, 0.06, 0.06, 0.28);

  // 叉形尾鳍：上叶长、下叶短
  const tail = pts[N];
  const tt = ts[N];
  m.strokeStyle = shade(hue, 0.42);
  m.lineWidth = 1;
  for (const [back, out] of [
    [0.13, 0.09],
    [0.08, -0.05],
  ]) {
    m.beginPath();
    m.moveTo(tail.x, tail.y);
    m.lineTo(tail.x - tt.x * back * L - tt.y * out * L, tail.y - tt.y * back * L + tt.x * out * L);
    m.stroke();
  }

  layeredBody(m, pts, widths, hue);

  if (!hammer) return;
  // 锤头：外缘暗、中线亮；两端的眼睛
  const head = pts[0];
  const ht = ts[0];
  const angle = Math.atan2(ht.y, ht.x);
  for (const [rx, ry, level] of [
    [0.045, 0.16, 0.4],
    [0.022, 0.12, 0.68],
  ]) {
    m.fillStyle = shade(hue, level);
    m.beginPath();
    m.ellipse(head.x, head.y, L * rx, L * ry, angle, 0, Math.PI * 2);
    m.fill();
  }
  m.fillStyle = shade(hue, 1);
  for (const side of [-1, 1]) {
    m.beginPath();
    m.arc(head.x - ht.y * side * L * 0.15, head.y + ht.x * side * L * 0.15, 0.7, 0, Math.PI * 2);
    m.fill();
  }
}

/** 鲸鲨（俯视）：宽扁方头 + 横向宽嘴 + 粗壮身体 + 大胸鳍 + 新月尾鳍 + 背部浅色斑点 */
export function drawWhaleShark(m: CanvasRenderingContext2D, c: CreatureShape): void {
  const L = c.size;
  const hue = c.hue;
  const N = 16;
  const amp = L * 0.05;
  // 脊柱：s 为 0(头)~1(尾)，摆幅向尾部递增
  const spine = (s: number): P => ({ x: L * (0.5 - s), y: amp * Math.pow(s, 1.5) * Math.sin(c.phase - s * 4) });
  // 朝向头部的单位切向量
  const tangent = (s: number): P => {
    const a = spine(Math.max(0, s - 0.02));
    const b = spine(Math.min(1, s + 0.02));
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    return { x: (a.x - b.x) / d, y: (a.y - b.y) / d };
  };
  // 体宽：头部宽而平（分层身体在 s=0 处平直收口，即方头），胸部最宽，向尾柄收细
  const width = (s: number) => L * (0.035 + 0.13 * Math.pow(1 - s, 0.9));

  // 胸鳍：一对大三角鳍；背鳍/腹鳍较小
  const fin = (s: number, back: number, out: number, level: number) =>
    finPair(m, spine(s), tangent(s), L, back, out * L + width(s) / 2, L * 0.1, shade(hue, level));
  fin(0.24, 0.2, 0.2, 0.32);
  fin(0.62, 0.07, 0.07, 0.28);

  // 月牙形尾鳍：上叶长、下叶短，向后弯曲
  const tail = spine(1);
  const tt = tangent(1);
  m.strokeStyle = shade(hue, 0.45);
  m.lineWidth = 1.3;
  for (const [back, out] of [
    [0.12, 0.14],
    [0.09, -0.1],
  ]) {
    // 控制点靠近尾柄侧，使叶片向后凸出成新月形
    m.beginPath();
    m.moveTo(tail.x, tail.y);
    m.quadraticCurveTo(
      tail.x - tt.x * back * L * 0.2 - tt.y * out * L * 0.8,
      tail.y - tt.y * back * L * 0.2 + tt.x * out * L * 0.8,
      tail.x - tt.x * back * L - tt.y * out * L,
      tail.y - tt.y * back * L + tt.x * out * L,
    );
    m.stroke();
  }

  // 身体整体压暗一档，让背部斑点跳出来
  const pts: P[] = [];
  const widths: number[] = [];
  for (let i = 0; i <= N; i++) {
    pts.push(spine(i / N));
    widths.push(width(i / N));
  }
  layeredBody(m, pts, widths, hue, [
    [1, 0.26],
    [0.75, 0.42],
    [0.5, 0.58],
    [0.25, 0.74],
  ]);

  // 横向宽嘴：贴着方头前缘的一道暗缝
  const h = spine(0.02);
  const ht = tangent(0.02);
  const hw = width(0.02) * 0.4;
  m.strokeStyle = shade(hue, 0.12);
  m.lineWidth = 0.8;
  m.beginPath();
  m.moveTo(h.x - ht.y * hw, h.y + ht.x * hw);
  m.lineTo(h.x + ht.y * hw, h.y - ht.x * hw);
  m.stroke();

  // 浅色斑点：沿脊柱的几列规则排布，位置跟随脊柱摆动
  const offsets = [-0.36, -0.12, 0.12, 0.36];
  m.fillStyle = shade(hue, 1);
  for (let col = 0; col < 9; col++) {
    const s = 0.14 + col * 0.075;
    const p = spine(s);
    const t = tangent(s);
    const w = width(s);
    for (let k = 0; k < offsets.length; k++) {
      // 奇偶列错开半格，形成规则的点阵
      const off = (offsets[k] + (col % 2 ? 0.12 : 0)) * w;
      if (Math.abs(off) > w * 0.42) continue;
      m.beginPath();
      m.arc(p.x - t.y * off, p.y + t.x * off, 0.55, 0, Math.PI * 2);
      m.fill();
    }
  }
}

/** 蝠鲼（俯视）：菱形双翼正弦扇动（翼尖前后摆、翼展略收）+ 头鳍 + 长鞭尾。鞭尾很长，整体向 +x 偏置 */
export function drawRay(m: CanvasRenderingContext2D, c: CreatureShape): void {
  const L = c.size;
  const hue = c.hue;
  const flap = Math.sin(c.phase);
  m.translate(L * 0.45, 0);
  const tail0 = -L * 0.42;

  // 鞭尾：随相位缓慢甩动，末端更暗
  const tail: P[] = [];
  for (let k = 0; k <= 12; k++) {
    const f = k / 12;
    tail.push({ x: tail0 - L * f, y: Math.sin(c.phase * 0.7 - f * 3.5) * f * L * 0.07 });
  }
  m.lineWidth = 0.7;
  fadingLine(m, tail, hue, 0.5, 0.22);

  // 头鳍：吻端一对向内卷的短角
  m.strokeStyle = shade(hue, 0.45);
  m.lineWidth = 1;
  for (const side of [-1, 1]) {
    m.beginPath();
    m.moveTo(L * 0.4, side * L * 0.09);
    m.quadraticCurveTo(L * 0.58, side * L * 0.16, L * 0.6, side * L * 0.07);
    m.stroke();
  }

  // 双翼：同一轮廓向盘心缩放成多层，越往里越亮，翼尖最暗
  const span = L * (0.95 - 0.1 * Math.abs(flap));
  const tipX = -L * 0.02 + flap * L * 0.14;
  const cx = -L * 0.02;
  for (const [k, level] of [
    [1, 0.26],
    [0.78, 0.42],
    [0.56, 0.6],
    [0.34, 0.78],
    [0.15, 0.95],
  ]) {
    m.save();
    m.translate(cx, 0);
    m.scale(k, k);
    m.translate(-cx, 0);
    m.fillStyle = shade(hue, level);
    m.beginPath();
    m.moveTo(L * 0.48, 0);
    // 前缘略凸、后缘内凹
    m.quadraticCurveTo(L * 0.3, span * 0.55, tipX, span);
    m.quadraticCurveTo(-L * 0.15, span * 0.35, tail0, 0);
    m.quadraticCurveTo(-L * 0.15, -span * 0.35, tipX, -span);
    m.quadraticCurveTo(L * 0.3, -span * 0.55, L * 0.48, 0);
    m.fill();
    m.restore();
  }
}

/** 确定性伪随机（mulberry32），同一 seed 每帧序列一致 */
function mulberry32(seed: number): () => number {
  let a = Math.floor(seed * 4294967296) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 小鱼群：5~8 条纺锤形小鱼松散聚成一团，整体朝 +x，队形仅由 seed 决定 */
export function drawFishSchool(m: CanvasRenderingContext2D, c: CreatureShape): void {
  const rnd = mulberry32(c.seed);
  const hue = c.hue;
  const n = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    // 队形：半径 ≤ 3.2 倍体长的圆盘内均匀散布
    const ang = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * c.size * 3.2;
    const len = c.size * (0.85 + rnd() * 0.3);
    const ph = rnd() * Math.PI * 2;
    // 极小的随相位漂移，幅度 0.3 倍体长（每轴）
    const x = Math.cos(ang) * r + Math.sin(c.phase * 0.5 + ph) * c.size * 0.3;
    const y = Math.sin(ang) * r + Math.cos(c.phase * 0.4 + ph * 1.7) * c.size * 0.3;
    const swing = Math.sin(c.phase * 2.5 + ph) * len * 0.16;

    // 小三角尾鳍，尾端随相位左右摆
    m.fillStyle = shade(hue, 0.38);
    m.beginPath();
    m.moveTo(x - len * 0.42, y);
    m.lineTo(x - len * 0.75, y + swing - len * 0.2);
    m.lineTo(x - len * 0.75, y + swing + len * 0.2);
    m.closePath();
    m.fill();
    // 纺锤形身体：边缘暗 → 体侧 → 背脊高光
    for (const [dx, rx, ry, level] of [
      [0, 0.5, 0.2, 0.32],
      [0.04, 0.38, 0.13, 0.6],
      [0.1, 0.22, 0.07, 0.95],
    ]) {
      m.fillStyle = shade(hue, level);
      m.beginPath();
      m.ellipse(x + len * dx, y, len * rx, len * ry, 0, 0, Math.PI * 2);
      m.fill();
    }
  }
}
