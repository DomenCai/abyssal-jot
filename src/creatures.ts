/** 新增生物的蒙版绘制：约定与 ocean.ts 的 drawJelly / drawShark 一致。
 *  调用前蒙版已 translate 到中心并 rotate 到朝向，生物朝 +x，单位为格，
 *  fillStyle / strokeStyle 为白色，用 globalAlpha 表达明暗，结束时复位为 1。 */

export interface CreatureShape {
  size: number;
  phase: number;
  seed: number;
}

/** 鲸鲨（俯视）：宽扁方头 + 横向宽嘴 + 粗壮身体 + 大胸鳍 + 新月尾鳍 + 背部浅色斑点 */
export function drawWhaleShark(m: CanvasRenderingContext2D, c: CreatureShape): void {
  const L = c.size;
  const N = 16;
  const amp = L * 0.05;
  const ph = c.phase * 0.6; // 比双髻鲨慢，显得沉稳
  // 脊柱：s 为 0(头)~1(尾)，摆幅向尾部递增
  const spineY = (s: number) => amp * Math.pow(s, 1.5) * Math.sin(ph - s * 4);
  const spine = (s: number) => ({ x: L * (0.5 - s), y: spineY(s) });
  // 朝向头部的单位切向量
  const tangent = (s: number) => {
    const a = spine(Math.max(0, s - 0.02));
    const b = spine(Math.min(1, s + 0.02));
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    return { x: (a.x - b.x) / d, y: (a.y - b.y) / d };
  };
  // 体宽：头部宽而平，胸部最宽，向尾柄收细
  const width = (s: number) => L * (0.035 + 0.13 * Math.pow(1 - s, 0.9));

  // 身体
  m.globalAlpha = 0.5;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const p = spine(s);
    m.beginPath();
    m.arc(p.x, p.y, width(s) / 2, 0, Math.PI * 2);
    m.fill();
  }
  // 方头：在头部补一块横向矩形，让前端平直
  const h = spine(0.03);
  const ht = tangent(0.03);
  const hw = width(0.03);
  m.globalAlpha = 0.5;
  m.beginPath();
  m.moveTo(h.x - ht.y * hw * 0.5, h.y + ht.x * hw * 0.5);
  m.lineTo(h.x + ht.y * hw * 0.5, h.y - ht.x * hw * 0.5);
  m.lineTo(h.x + ht.y * hw * 0.5 + ht.x * L * 0.03, h.y - ht.x * hw * 0.5 + ht.y * L * 0.03);
  m.lineTo(h.x - ht.y * hw * 0.5 + ht.x * L * 0.03, h.y + ht.x * hw * 0.5 + ht.y * L * 0.03);
  m.closePath();
  m.fill();
  // 横向宽嘴（头端前缘高光线）
  m.globalAlpha = 0.8;
  m.lineWidth = 0.8;
  m.beginPath();
  m.moveTo(h.x + ht.x * L * 0.03 - ht.y * hw * 0.4, h.y + ht.y * L * 0.03 + ht.x * hw * 0.4);
  m.lineTo(h.x + ht.x * L * 0.03 + ht.y * hw * 0.4, h.y + ht.y * L * 0.03 - ht.x * hw * 0.4);
  m.stroke();

  // 脊线高光
  m.globalAlpha = 0.4;
  m.lineWidth = 0.8;
  m.beginPath();
  for (let i = 0; i <= N; i++) {
    const p = spine(i / N);
    if (i === 0) m.moveTo(p.x, p.y);
    else m.lineTo(p.x, p.y);
  }
  m.stroke();

  // 胸鳍：一对大三角鳍向后外侧展开；背鳍/腹鳍较小
  const fin = (s: number, back: number, out: number, alpha: number) => {
    const p = spine(s);
    const t = tangent(s);
    m.globalAlpha = alpha;
    for (const side of [-1, 1]) {
      const nx = -t.y * side;
      const ny = t.x * side;
      m.beginPath();
      m.moveTo(p.x + t.x * L * 0.05, p.y + t.y * L * 0.05);
      m.lineTo(p.x - t.x * back * L + nx * (out * L + width(s) / 2), p.y - t.y * back * L + ny * (out * L + width(s) / 2));
      m.lineTo(p.x - t.x * L * 0.1, p.y - t.y * L * 0.1);
      m.closePath();
      m.fill();
    }
  };
  fin(0.24, 0.2, 0.2, 0.38);
  fin(0.62, 0.07, 0.07, 0.3);

  // 浅色斑点：沿脊柱的几列规则排布，位置跟随脊柱摆动
  const offsets = [-0.36, -0.12, 0.12, 0.36];
  m.globalAlpha = 0.95;
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

  // 月牙形尾鳍：上叶长、下叶短，向后弯曲
  const tail = spine(1);
  const tt = tangent(1);
  m.globalAlpha = 0.6;
  m.lineWidth = 1.3;
  const lobe = (back: number, out: number) => {
    const ex = tail.x - tt.x * back * L - tt.y * out * L;
    const ey = tail.y - tt.y * back * L + tt.x * out * L;
    // 控制点靠近尾柄侧，使叶片向后凸出成新月形
    m.beginPath();
    m.moveTo(tail.x, tail.y);
    m.quadraticCurveTo(tail.x - tt.x * back * L * 0.2 - tt.y * out * L * 0.8, tail.y - tt.y * back * L * 0.2 + tt.x * out * L * 0.8, ex, ey);
    m.stroke();
  };
  lobe(0.12, 0.14);
  lobe(0.09, -0.1);
  m.globalAlpha = 1;
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

    // 纺锤形身体
    m.globalAlpha = 0.6;
    m.beginPath();
    m.ellipse(x, y, len * 0.5, len * 0.2, 0, 0, Math.PI * 2);
    m.fill();
    // 背脊高光
    m.globalAlpha = 0.9;
    m.beginPath();
    m.ellipse(x + len * 0.1, y, len * 0.22, len * 0.07, 0, 0, Math.PI * 2);
    m.fill();
    // 小三角尾鳍，尾端随相位左右摆
    m.globalAlpha = 0.45;
    m.beginPath();
    m.moveTo(x - len * 0.42, y);
    m.lineTo(x - len * 0.75, y + swing - len * 0.2);
    m.lineTo(x - len * 0.75, y + swing + len * 0.2);
    m.closePath();
    m.fill();
  }
  m.globalAlpha = 1;
}
