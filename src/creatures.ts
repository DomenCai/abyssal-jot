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
  /** 转弯带来的身体弯曲，-1~1，正值朝 +y（游向的右侧）弯成 C 形 */
  bend: number;
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

/** 脊柱点 p、朝头单位切向量 t 的局部坐标 → 蒙版坐标：along 沿头向，side 朝 +y 一侧 */
const local = (p: P, t: P, along: number, side: number): P => ({ x: p.x + t.x * along - t.y * side, y: p.y + t.y * along + t.x * side });

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

  // 触手：从伞缘垂下，越往末端越暗；线宽和摆幅随尺寸缩放，放大后不断续
  const tentacles = 8;
  m.lineWidth = Math.max(0.65, s * 0.065);
  for (let i = 0; i < tentacles; i++) {
    const y0 = -bh * 0.9 + (i * 1.8 * bh) / (tentacles - 1);
    const tl = len * (0.75 + 0.25 * Math.abs(Math.sin(i * 2.1 + c.seed * 9)));
    const pts: P[] = [];
    for (let k = 0; k <= 14; k++) {
      const f = k / 14;
      pts.push({ x: -tl * f, y: y0 * (1 - 0.25 * f) + Math.sin(c.phase - k * 0.48 + i * 1.3) * s * (0.04 + f * 0.22) });
    }
    fadingLine(m, pts, hue, 0.65, 0.25);
  }
  // 口腕：两条粗丝带，中心一线更亮
  for (const side of [-1, 1]) {
    const arm = () => {
      m.beginPath();
      for (let k = 0; k <= 10; k++) {
        const f = k / 10;
        m.lineTo(bw * 0.15 - len * 0.62 * f, side * bh * 0.14 * (1 - f * 0.5) + Math.sin(c.phase * 0.8 - k * 0.5 + side) * f * s * 0.2);
      }
      m.stroke();
    };
    m.lineWidth = Math.max(2.0, s * 0.24);
    m.strokeStyle = shade(hue, 0.42);
    arm();
    m.lineWidth = Math.max(0.9, s * 0.1);
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
  m.lineWidth = Math.max(1.1, s * 0.11);
  m.beginPath();
  m.ellipse(0, 0, bw * 0.93, bh * 0.93, 0, -0.9, 0.9);
  m.stroke();
  // 伞缘：侧视为一条微微起伏的亮线
  m.strokeStyle = shade(hue, 0.8);
  m.lineWidth = Math.max(1.0, s * 0.095);
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

/** 鲨的身体分层：中脊高光收一档，给背鳍亮棱留出对比 */
const SHARK_LAYERS: [number, number][] = [
  [1, 0.3],
  [0.75, 0.47],
  [0.5, 0.62],
  [0.22, 0.78],
];

/** 镰刀形成对鳍：前缘外凸、后缘内凹、鳍尖尖锐；鳍根在脊柱上，由身体盖住。back / out / root 为体长倍数 */
function sickleFins(m: CanvasRenderingContext2D, p: P, t: P, L: number, back: number, out: number, root: number, color: string): void {
  m.fillStyle = color;
  for (const side of [-1, 1]) {
    const at = (a: number, s: number) => local(p, t, a * L, side * s * L);
    const front = at(root / 2, 0);
    const tip = at(-back, out);
    const lead = at(-back * 0.05, out * 0.75);
    const trail = at(-back * 0.45, out * 0.6);
    const rear = at(-root / 2, 0);
    m.beginPath();
    m.moveTo(front.x, front.y);
    m.quadraticCurveTo(lead.x, lead.y, tip.x, tip.y);
    m.quadraticCurveTo(trail.x, trail.y, rear.x, rear.y);
    m.closePath();
    m.fill();
  }
}

/** 鲨（俯视）：朝 +x。seed < 2/3 为尖吻鲨（镰刀形长胸鳍，ocean.ts 再按 seed 分灰、蓝两种配色），否则为豹纹鲨（钝头更粗壮、背上深色斑块）。
 *  轮廓为圆钝吻部 → 胸部最宽 → 尾柄收细 → 上长下短的新月尾鳍；
 *  背鳍俯视是脊线上一道亮棱加一侧阴影；游动为振幅向尾部递增的行波，转弯时整条身体弯成 C 形。 */
export function drawShark(m: CanvasRenderingContext2D, c: CreatureShape): void {
  const L = c.size;
  const hue = c.hue;
  const leopard = c.seed >= 2 / 3;
  const N = 32;
  // 体宽：最宽处占体长 W，位于 sm；吻部圆钝指数 p（越小越钝），向尾收细指数 q（越小后半身越饱满）；尾柄宽为最宽处的 0.14
  const [W, sm, p, q] = leopard ? [0.25, 0.3, 0.4, 1.1] : [0.21, 0.32, 0.5, 1.2];
  const width = (s: number) => L * W * (s < sm ? Math.pow(s / sm, p) : 0.14 + 0.86 * Math.pow(1 - (s - sm) / (1 - sm), q));
  const amp = L * 0.055;
  const pts: P[] = [];
  const widths: number[] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    // 鲨鱼为鲹科游动：前半身稳重少晃、行波主要在后半身放大（相位跨度约半个波，不呈蛇形）；转弯弯曲收敛在自然弧度内
    const wave = amp * (0.04 + 0.96 * Math.pow(s, 2)) * Math.sin(c.phase - s * 3.1);
    const curve = c.bend * L * 0.17 * (s - 0.3) ** 2;
    pts.push({ x: L * (0.5 - s), y: wave + curve });
    widths.push(width(s));
  }
  const ts = tangents(pts);
  const at = (s: number) => Math.round(s * N);

  // 胸鳍、腹鳍比身体暗，先画，鳍根被身体盖住。胸鳍 [位置, 后掠, 外展, 鳍根长]
  const [ps, pb, po, pr] = leopard ? [0.27, 0.16, 0.25, 0.12] : [0.28, 0.23, 0.28, 0.1];
  sickleFins(m, pts[at(ps)], ts[at(ps)], L, pb, po, pr, shade(hue, 0.4));
  sickleFins(m, pts[at(0.6)], ts[at(0.6)], L, 0.07, width(0.6) / L / 2 + 0.04, 0.05, shade(hue, 0.34));

  // 新月尾鳍：上叶长、下叶短，前缘外凸、后缘内凹，两叶在尾叉处汇合
  const tail = pts[N];
  const tt = ts[N];
  const tl = (a: number, s: number) => local(tail, tt, a * L, s * L);
  m.fillStyle = shade(hue, 0.42);
  for (const [back, out] of [
    [0.17, 0.1],
    [0.1, -0.075],
  ]) {
    const base = tl(0.05, 0);
    const lead = tl(-back * 0.2, out * 0.85);
    const tip = tl(-back, out);
    const trail = tl(-back * 0.45, out * 0.4);
    const fork = tl(-0.045, 0);
    m.beginPath();
    m.moveTo(base.x, base.y);
    m.quadraticCurveTo(lead.x, lead.y, tip.x, tip.y);
    m.quadraticCurveTo(trail.x, trail.y, fork.x, fork.y);
    m.closePath();
    m.fill();
  }

  layeredBody(m, pts, widths, hue, SHARK_LAYERS);

  // 豹纹鲨：背上散布深色斑块，位置随 seed 固定、跟着脊柱摆动
  if (leopard) {
    const rnd = mulberry32(c.seed);
    m.fillStyle = shade(hue, 0.3);
    for (let k = 0; k < 28; k++) {
      const s = 0.12 + rnd() * 0.7;
      const i = at(s);
      const pt = local(pts[i], ts[i], 0, (rnd() - 0.5) * 0.8 * widths[i]);
      m.beginPath();
      m.arc(pt.x, pt.y, L * (0.007 + rnd() * 0.009), 0, Math.PI * 2);
      m.fill();
    }
  }

  // 鳃裂：头后两侧各 5 道短暗纹
  m.strokeStyle = shade(hue, 0.26);
  m.lineWidth = Math.max(0.5, L * 0.005);
  for (let k = 0; k < 5; k++) {
    const i = at(0.17 + k * 0.016);
    for (const side of [-1, 1]) {
      const a = local(pts[i], ts[i], 0, side * widths[i] * 0.28);
      const b = local(pts[i], ts[i], -L * 0.008, side * widths[i] * 0.46);
      m.beginPath();
      m.moveTo(a.x, a.y);
      m.lineTo(b.x, b.y);
      m.stroke();
    }
  }

  // 背鳍：俯视只见一道亮棱，旁边一条阴影
  const ridge = (s0: number, s1: number, w: number) => {
    const a = at(s0);
    const b = at(s1);
    m.fillStyle = shade(hue, 0.3);
    m.beginPath();
    for (let i = a; i <= b; i++) {
      const f = (i - a) / (b - a);
      const pt = local(pts[i], ts[i], 0, w * L * Math.sin(Math.PI * Math.pow(f, 0.6)) + 0.4);
      m.lineTo(pt.x, pt.y);
    }
    for (let i = b; i >= a; i--) m.lineTo(pts[i].x, pts[i].y);
    m.closePath();
    m.fill();
    m.strokeStyle = shade(hue, 1);
    m.lineWidth = Math.max(0.8, w * L * 0.6);
    m.beginPath();
    for (let i = a; i <= b; i++) m.lineTo(pts[i].x, pts[i].y);
    m.stroke();
  };
  ridge(leopard ? 0.37 : 0.35, 0.5, 0.022);
  ridge(0.7, 0.77, 0.009);

  // 眼睛：头部两侧的暗点
  m.fillStyle = shade(hue, 0.1);
  const i = at(0.075);
  for (const side of [-1, 1]) {
    const pt = local(pts[i], ts[i], 0, side * widths[i] * 0.4);
    m.beginPath();
    m.arc(pt.x, pt.y, Math.max(0.6, L * 0.009), 0, Math.PI * 2);
    m.fill();
  }
}

/** 鲸鲨（俯视）：宽扁方头 + 横向宽嘴 + 粗壮身体 + 大胸鳍 + 实心新月尾鳍 + 背部浅色斑点 */
export function drawWhaleShark(m: CanvasRenderingContext2D, c: CreatureShape): void {
  const L = c.size;
  const hue = c.hue;
  const N = 24;
  const amp = L * 0.045;
  // 脊柱：前半身稳重，摆幅向尾部递增，并随转弯温和弯曲
  const spine = (s: number): P => ({
    x: L * (0.5 - s),
    y: amp * (0.03 + 0.97 * Math.pow(s, 1.9)) * Math.sin(c.phase - s * 3) + c.bend * L * 0.14 * (s - 0.3) ** 2,
  });
  // 朝向头部的单位切向量
  const tangent = (s: number): P => {
    const a = spine(Math.max(0, s - 0.02));
    const b = spine(Math.min(1, s + 0.02));
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    return { x: (a.x - b.x) / d, y: (a.y - b.y) / d };
  };
  // 体宽：头部宽而平（分层身体在 s=0 处平直收口，即方头），胸部最宽，向尾柄收细
  const width = (s: number) => L * (0.035 + 0.135 * Math.pow(1 - s, 0.9));

  // 胸鳍：一对大三角鳍；腹鳍较小
  const fin = (s: number, back: number, out: number, level: number) =>
    finPair(m, spine(s), tangent(s), L, back, out * L + width(s) / 2, L * 0.1, shade(hue, level));
  fin(0.24, 0.2, 0.2, 0.34);
  fin(0.62, 0.07, 0.07, 0.3);

  // 实心月牙形尾鳍：上叶长、下叶短，与鲨鱼质感一致
  const tail = spine(1);
  const tt = tangent(1);
  const tl = (a: number, s: number) => local(tail, tt, a * L, s * L);
  m.fillStyle = shade(hue, 0.42);
  for (const [back, out] of [
    [0.16, 0.12],
    [0.1, -0.085],
  ]) {
    const base = tl(0.05, 0);
    const lead = tl(-back * 0.2, out * 0.85);
    const tip = tl(-back, out);
    const trail = tl(-back * 0.45, out * 0.4);
    const fork = tl(-0.045, 0);
    m.beginPath();
    m.moveTo(base.x, base.y);
    m.quadraticCurveTo(lead.x, lead.y, tip.x, tip.y);
    m.quadraticCurveTo(trail.x, trail.y, fork.x, fork.y);
    m.closePath();
    m.fill();
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
  m.lineWidth = Math.max(0.8, L * 0.016);
  m.beginPath();
  m.moveTo(h.x - ht.y * hw, h.y + ht.x * hw);
  m.lineTo(h.x + ht.y * hw, h.y - ht.x * hw);
  m.stroke();

  // 浅色斑点：沿脊柱的几列规则排布，位置跟随脊柱摆动
  const offsets = [-0.36, -0.12, 0.12, 0.36];
  const dotR = Math.max(0.55, L * 0.013);
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
      m.arc(p.x - t.y * off, p.y + t.x * off, dotR, 0, Math.PI * 2);
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

  // 鞭尾：随相位缓慢甩动并顺着转弯弯曲，末端更暗
  const tail: P[] = [];
  for (let k = 0; k <= 12; k++) {
    const f = k / 12;
    tail.push({
      x: tail0 - L * f,
      y: Math.sin(c.phase * 0.7 - f * 3.2) * f * L * 0.065 + c.bend * L * 0.16 * f * f,
    });
  }
  m.lineWidth = Math.max(0.7, L * 0.03);
  fadingLine(m, tail, hue, 0.5, 0.22);

  // 头鳍：吻端一对向内卷的短角
  m.strokeStyle = shade(hue, 0.45);
  m.lineWidth = Math.max(0.9, L * 0.04);
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
