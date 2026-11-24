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
  /** 转弯带来的身体弯曲，-1~1，正值朝 +y（游向的右侧）弯成 C 形；只有蝠鲼鞭尾使用，鲨与鲸鲨的弯曲来自 path */
  bend: number;
  /** 屏幕上的游向（rad），用于把固定的屏幕光源换算到生物本体坐标 */
  heading: number;
  /** 鲨与鲸鲨：头部走过的轨迹，按体长等分成 PATH_N + 1 个点（本体坐标，头在前）；身体沿它铺开，所以不会横滑 */
  path: P[];
}

export type P = { x: number; y: number };
type V3 = { x: number; y: number; z: number };

/** 轨迹分段数 */
export const PATH_N = 32;

/** 屏幕空间光源方向：左上方、略偏向观察者（z 朝屏幕外），各生物按自身朝向换算到本体坐标 */
const LIGHT: V3 = (() => {
  const v = { x: -0.55, y: -0.65, z: 0.5 };
  const d = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / d, y: v.y / d, z: v.z / d };
})();
/** 半程向量（光源 + 视线 z），用于高光 */
const HALF: V3 = (() => {
  const v = { x: LIGHT.x, y: LIGHT.y, z: LIGHT.z + 1 };
  const d = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / d, y: v.y / d, z: v.z / d };
})();

/** 光源换算到本体坐标（蒙版已 rotate(heading)）；z 分量不随朝向变 */
function lightOf(c: CreatureShape): { l: V3; h: V3 } {
  const cos = Math.cos(c.heading);
  const sin = Math.sin(c.heading);
  const rot = (v: V3): V3 => ({ x: v.x * cos + v.y * sin, y: v.y * cos - v.x * sin, z: v.z });
  return { l: rot(LIGHT), h: rot(HALF) };
}
type Light = ReturnType<typeof lightOf>;

/** 法线 n（未归一化）处的光照强度：环境光 + 漫反射 + 高光。背光侧压到很暗、受光侧接近白，靠这个反差出立体感 */
function lit(n: V3, light: Light): number {
  const d = Math.hypot(n.x, n.y, n.z) || 1;
  const diff = Math.max(0, (n.x * light.l.x + n.y * light.l.y + n.z * light.l.z) / d);
  const spec = Math.max(0, (n.x * light.h.x + n.y * light.h.y + n.z * light.h.z) / d) ** 20;
  return Math.min(1, 0.06 + diff + 0.6 * spec);
}

/** 光照强度 level 下的颜色 */
const shade = (hue: RGB, level: number) => `rgb(${(hue[0] * level) | 0},${(hue[1] * level) | 0},${(hue[2] * level) | 0})`;

/** 每个脊柱点朝向头部的单位切向量 */
function tangents(pts: P[]): P[] {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    return { x: (a.x - b.x) / d, y: (a.y - b.y) / d };
  });
}

/** 在轨迹上叠加摆尾行波：每点沿轨迹法线侧移 lateral(s)，s 为 0（头）~1（尾） */
function swim(path: P[], lateral: (s: number) => number): P[] {
  const ts = tangents(path);
  const N = path.length - 1;
  return path.map((p, i) => local(p, ts[i], 0, lateral(i / N)));
}

/** 截面分带数：越多明暗过渡越细 */
const BANDS = 10;

/** 把身体当作半径沿脊柱变化的圆管，俯视下逐段、逐横向条带算表面法线并打光：
 *  横向位置 u（-1~1）处法线 = u·体侧方向 + √(1-u²)·朝上，再按半径沿体长的变化前后倾斜（吻部朝前、尾柄朝后）。
 *  先铺一层底色填住条带间的抗锯齿缝。gain 整体压暗（鲸鲨留给斑点对比） */
function tubeBody(m: CanvasRenderingContext2D, pts: P[], widths: number[], hue: RGB, light: Light, gain = 1): void {
  const ts = tangents(pts);
  const at = (i: number, u: number): P => local(pts[i], ts[i], 0, (u * widths[i]) / 2);
  m.fillStyle = shade(hue, 0.25 * gain);
  m.beginPath();
  for (let i = 0; i < pts.length; i++) m.lineTo(at(i, 1).x, at(i, 1).y);
  for (let i = pts.length - 1; i >= 0; i--) m.lineTo(at(i, -1).x, at(i, -1).y);
  m.fill();
  for (let i = 0; i < pts.length - 1; i++) {
    const tx = ts[i].x + ts[i + 1].x;
    const ty = ts[i].y + ts[i + 1].y;
    const tl = Math.hypot(tx, ty) || 1;
    const t = { x: tx / tl, y: ty / tl };
    const seg = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) || 1;
    // 半径沿体长（朝尾）的变化率；法线朝「半径变小的方向」倾斜
    const dr = (widths[i + 1] - widths[i]) / 2 / seg;
    for (let b = 0; b < BANDS; b++) {
      const u0 = -1 + (2 * b) / BANDS;
      const u1 = u0 + 2 / BANDS;
      const u = (u0 + u1) / 2;
      const z = Math.sqrt(Math.max(0, 1 - u * u));
      const level = lit({ x: -t.y * u + t.x * dr, y: t.x * u + t.y * dr, z }, light) * gain;
      m.fillStyle = shade(hue, level);
      const a = at(i, u0);
      const c = at(i, u1);
      const d = at(i + 1, u1);
      const e = at(i + 1, u0);
      m.beginPath();
      m.moveTo(a.x, a.y);
      m.lineTo(c.x, c.y);
      m.lineTo(d.x, d.y);
      m.lineTo(e.x, e.y);
      m.closePath();
      m.fill();
    }
  }
}

/** 脊柱点 p、朝头单位切向量 t 的局部坐标 → 蒙版坐标：along 沿头向，side 朝 +y 一侧 */
const local = (p: P, t: P, along: number, side: number): P => ({ x: p.x + t.x * along - t.y * side, y: p.y + t.y * along + t.x * side });

/** 鳍的受光：鳍面向外侧下垂，法线朝外侧倾斜，受光侧的鳍更亮、背光侧更暗；level 为水平朝上时的亮度 */
const finLevel = (level: number, t: P, light: Light, side: number) =>
  (level * lit({ x: -t.y * side * 0.45, y: t.x * side * 0.45, z: 1 }, light)) / lit({ x: 0, y: 0, z: 1 }, light);

/** 一对向后外侧展开的三角鳍；out 为翼尖到脊柱的横向距离（格） */
function finPair(m: CanvasRenderingContext2D, p: P, t: P, L: number, back: number, out: number, root: number, hue: RGB, level: number, light: Light): void {
  for (const side of [-1, 1]) {
    m.fillStyle = shade(hue, finLevel(level, t, light, side));
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

/** 一次搏动里伞罩快速收缩所占的比例，其余时间缓慢舒张 */
const CONTRACT = 0.22;
const ease = (x: number) => x * x * (3 - 2 * x);
/** 收缩程度 0~1：快收（ease-in-out）→ 慢放（先快后慢地回弹） */
function squeezeAt(phase: number): number {
  const u = (((phase / (Math.PI * 2)) % 1) + 1) % 1;
  return u < CONTRACT ? ease(u / CONTRACT) : (1 - (u - CONTRACT) / (1 - CONTRACT)) ** 2;
}
/** 推进速度曲线（未归一化）：收缩时喷水猛冲，之后靠惯性滑行、被水阻迅速拖慢 */
function rawThrust(phase: number): number {
  const u = (((phase / (Math.PI * 2)) % 1) + 1) % 1;
  return 0.1 + (u < CONTRACT ? u / CONTRACT : Math.exp(-(u - CONTRACT) * 5));
}
/** rawThrust 一个周期的均值，归一化后平均游速不变 */
const THRUST_MEAN = Array.from({ length: 200 }, (_, i) => rawThrust((i / 200) * Math.PI * 2)).reduce((a, b) => a + b) / 200;

/** 水母一次搏动：squeeze 为伞罩收缩程度 0~1，thrust 为游速倍数（周期均值 1） */
export function jellyPulse(phase: number): { squeeze: number; thrust: number } {
  return { squeeze: squeezeAt(phase), thrust: rawThrust(phase) / THRUST_MEAN };
}

/** 水母（侧视）：朝 +x 的中空玻璃伞罩（伞缘亮环、内部暗透、口腕核心发光）+ 拖在身后的长触手。
 *  搏动为「一抽一抽」的喷水推进：伞罩快速收窄拉长、触手被甩直并拢，随后伞罩慢慢张开、触手散开飘荡；
 *  触手上的收缩沿长度向后延迟传递，像鞭梢一样一节节跟上。
 *  触手很长，整体在蒙版里向 +x 偏置，让伞顶到触手末端的包围盒居中，避免被截断。 */
export function drawJelly(m: CanvasRenderingContext2D, c: CreatureShape): void {
  const s = c.size;
  const hue = c.hue;
  const q = squeezeAt(c.phase);
  // 收缩时伞罩变窄（bh）且向前拉长（bw），舒张时又扁又宽
  const bw = s * (0.88 + 0.24 * q);
  const bh = s * (1.06 - 0.3 * q);
  const len = s * 3.6;
  const light = lightOf(c).l;
  m.translate((len - bw) / 2, 0);

  // 沿触手第 f 处的收缩程度：越往末端延迟越多
  const lag = (f: number) => squeezeAt(c.phase - f * 2.2);
  // 触手：从伞缘垂下，越往末端越暗；收缩时并拢甩直，舒张时散开、缓慢起伏
  const tentacles = 8;
  m.lineWidth = Math.max(0.65, s * 0.065);
  for (let i = 0; i < tentacles; i++) {
    const y0 = -bh * 0.9 + (i * 1.8 * bh) / (tentacles - 1);
    const tl = len * (0.75 + 0.25 * Math.abs(Math.sin(i * 2.1 + c.seed * 9)));
    const pts: P[] = [];
    for (let k = 0; k <= 14; k++) {
      const f = k / 14;
      const qf = lag(f);
      const sway = Math.sin(c.phase * 0.5 - k * 0.45 + i * 1.3) * s * (0.04 + f * 0.26) * (1 - 0.7 * qf);
      pts.push({ x: -tl * f * (0.88 + 0.12 * qf), y: y0 * (1 - 0.25 * f) * (1 - 0.45 * qf) + sway });
    }
    fadingLine(m, pts, hue, 0.65, 0.25);
  }
  // 口腕：两条粗丝带，中心一线更亮；同样随搏动收拢、舒展
  for (const side of [-1, 1]) {
    const arm = () => {
      m.beginPath();
      for (let k = 0; k <= 10; k++) {
        const f = k / 10;
        const qf = lag(f * 0.62);
        m.lineTo(
          bw * 0.15 - len * 0.62 * f * (0.9 + 0.1 * qf),
          side * bh * 0.14 * (1 - f * 0.5) * (1 - 0.4 * qf) + Math.sin(c.phase * 0.4 - k * 0.5 + side) * f * s * 0.22 * (1 - 0.6 * qf),
        );
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

  // 伞罩：内层向 +x 收、越往里越暗，留下一圈亮伞缘和亮外壁 = 中空玻璃感；内层略向背光侧偏，受光侧外壁更亮更厚
  for (const [k, level] of [
    [1, 0.55],
    [0.86, 0.3],
    [0.7, 0.14],
  ]) {
    m.fillStyle = shade(hue, level);
    m.beginPath();
    m.ellipse(bw * (1 - k) * 0.4 - light.x * (1 - k) * bw * 0.3, -light.y * (1 - k) * bh * 0.3, bw * k, bh * k, 0, -Math.PI / 2, Math.PI / 2);
    m.closePath();
    m.fill();
  }
  // 伞顶弧形高光：偏向受光侧
  m.strokeStyle = shade(hue, 0.95);
  m.lineWidth = Math.max(1.1, s * 0.11);
  m.beginPath();
  const tilt = Math.atan2(light.y, Math.max(0.2, light.x)) * 0.6;
  m.ellipse(0, 0, bw * 0.93, bh * 0.93, 0, tilt - 0.9, tilt + 0.9);
  m.stroke();
  // 伞缘：侧视为一条微微起伏的亮线，收缩时随伞罩一起收口
  m.strokeStyle = shade(hue, 0.8);
  m.lineWidth = Math.max(1.0, s * 0.095);
  m.beginPath();
  for (let k = 0; k <= 12; k++) {
    const f = k / 12;
    m.lineTo(Math.sin(f * 12 + c.phase * 2) * 0.3 - q * s * 0.08 * Math.sin(f * Math.PI), -bh + 2 * bh * f);
  }
  m.stroke();
  // 口腕核心：伞内发光的胃腔，收缩时被挤得更亮
  m.fillStyle = shade(hue, 0.5 + 0.15 * q);
  m.beginPath();
  m.ellipse(bw * 0.28, 0, bw * 0.34, bh * 0.32, 0, 0, Math.PI * 2);
  m.fill();
  m.fillStyle = shade(hue, 1);
  m.beginPath();
  m.ellipse(bw * 0.28, 0, bw * 0.2, bh * 0.18, 0, 0, Math.PI * 2);
  m.fill();
}

/** 镰刀形成对鳍：前缘外凸、后缘内凹、鳍尖尖锐；鳍根在脊柱上，由身体盖住。back / out / root 为体长倍数 */
function sickleFins(m: CanvasRenderingContext2D, p: P, t: P, L: number, back: number, out: number, root: number, hue: RGB, level: number, light: Light): void {
  for (const side of [-1, 1]) {
    m.fillStyle = shade(hue, finLevel(level, t, light, side));
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
  // 体宽：最宽处占体长 W，位于 sm；吻部圆钝指数 p（越小越钝），向尾收细指数 q（越小后半身越饱满）；尾柄宽为最宽处的 0.14
  const [W, sm, p, q] = leopard ? [0.25, 0.3, 0.4, 1.1] : [0.21, 0.32, 0.5, 1.2];
  const width = (s: number) => L * W * (s < sm ? Math.pow(s / sm, p) : 0.14 + 0.86 * Math.pow(1 - (s - sm) / (1 - sm), q));
  const amp = L * 0.07;
  const light = lightOf(c);
  // 身体沿头部轨迹铺开（转弯时自然弯成 C 形），再叠加鲹科游动：前半身稳重少晃、行波主要在后半身放大（相位跨度约半个波，不呈蛇形）
  const N = PATH_N;
  const pts = swim(c.path, (s) => amp * (0.04 + 0.96 * s * s) * Math.sin(c.phase - s * 3.1));
  const widths = pts.map((_, i) => width(i / N));
  const ts = tangents(pts);
  const at = (s: number) => Math.round(s * N);

  // 胸鳍、腹鳍比身体暗，先画，鳍根被身体盖住。胸鳍 [位置, 后掠, 外展, 鳍根长]
  const [ps, pb, po, pr] = leopard ? [0.27, 0.16, 0.25, 0.12] : [0.28, 0.23, 0.28, 0.1];
  sickleFins(m, pts[at(ps)], ts[at(ps)], L, pb, po, pr, hue, 0.4, light);
  sickleFins(m, pts[at(0.6)], ts[at(0.6)], L, 0.07, width(0.6) / L / 2 + 0.04, 0.05, hue, 0.34, light);

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

  tubeBody(m, pts, widths, hue, light);

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
  const N = PATH_N;
  const amp = L * 0.055;
  const light = lightOf(c);
  // 身体沿头部轨迹铺开，摆幅向尾部递增，前半身稳重
  const pts = swim(c.path, (s) => amp * (0.03 + 0.97 * Math.pow(s, 1.9)) * Math.sin(c.phase - s * 3));
  const ts = tangents(pts);
  const at = (s: number) => Math.round(s * N);
  // 体宽：头部宽而平（分层身体在 s=0 处平直收口，即方头），胸部最宽，向尾柄收细
  const width = (s: number) => L * (0.035 + 0.135 * Math.pow(1 - s, 0.9));

  // 胸鳍：一对大三角鳍；腹鳍较小
  const fin = (s: number, back: number, out: number, level: number) =>
    finPair(m, pts[at(s)], ts[at(s)], L, back, out * L + width(s) / 2, L * 0.1, hue, level, light);
  fin(0.24, 0.2, 0.2, 0.34);
  fin(0.62, 0.07, 0.07, 0.3);

  // 实心月牙形尾鳍：上叶长、下叶短，与鲨鱼质感一致
  const tail = pts[N];
  const tt = ts[N];
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
  const widths = pts.map((_, i) => width(i / N));
  tubeBody(m, pts, widths, hue, light, 0.85);

  // 横向宽嘴：贴着方头前缘的一道暗缝
  const h = pts[1];
  const ht = ts[1];
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
    const p = pts[at(s)];
    const t = ts[at(s)];
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
      y: Math.sin(c.phase * 0.7 - f * 3.2) * f * L * 0.08 + c.bend * L * 0.35 * f * f,
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

  // 双翼：同一轮廓向盘心缩放成多层、越往里越亮，并整体向受光侧偏移，形成穹顶状明暗
  const span = L * (0.95 - 0.1 * Math.abs(flap));
  const tipX = -L * 0.02 + flap * L * 0.14;
  const cx = -L * 0.02;
  const light = lightOf(c);
  const wing = (side: number) => {
    m.moveTo(L * 0.48, 0);
    // 前缘略凸、后缘内凹
    m.quadraticCurveTo(L * 0.3, side * span * 0.55, tipX, side * span);
    m.quadraticCurveTo(-L * 0.15, side * span * 0.35, tail0, 0);
  };
  for (const [k, level] of [
    [1, 0.14],
    [0.8, 0.3],
    [0.6, 0.5],
    [0.4, 0.72],
    [0.2, 0.95],
  ]) {
    m.save();
    m.translate(cx + light.l.x * (1 - k) * L * 0.3, light.l.y * (1 - k) * span * 0.55);
    m.scale(k, k);
    m.translate(-cx, 0);
    m.fillStyle = shade(hue, level);
    m.beginPath();
    wing(1);
    wing(-1);
    m.fill();
    m.restore();
  }
  // 扇翼时翼面倾斜：翼尖抬起的一侧法线朝内倾，转向光源的翼变亮、背离的变暗；从中轴到翼尖渐变，盘心不受影响
  const flat = lit({ x: 0, y: 0, z: 1 }, light);
  for (const side of [-1, 1]) {
    const tilt = flap * 0.6;
    const r = lit({ x: 0, y: -side * Math.sin(tilt), z: Math.cos(tilt) }, light) / flat;
    const [rgb, a] = r < 1 ? ['0,0,0', Math.min(0.45, (1 - r) * 0.9)] : [hue.join(','), Math.min(0.4, (r - 1) * 0.9)];
    const g = m.createLinearGradient(0, side * span * 0.1, 0, side * span);
    g.addColorStop(0, `rgba(${rgb},0)`);
    g.addColorStop(1, `rgba(${rgb},${a.toFixed(3)})`);
    m.fillStyle = g;
    m.beginPath();
    wing(side);
    m.closePath();
    m.fill();
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
