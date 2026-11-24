/**
 * WebAudio 合成键音：带通噪声 + 短促下扫的三角波，组成「低频柔和木质轻叩」。
 * 每次触发带 ±5% 的音高/滤波随机；连发限流 + 压缩器限幅，避免叠加破音。
 */

export type KeyKind = 'key' | 'space' | 'backspace' | 'enter';

interface Voice {
  /** 带通中心频率 Hz */
  band: number;
  /** 噪声衰减 s */
  noiseDecay: number;
  /** 三角波起止频率 Hz */
  toneFrom: number;
  toneTo: number;
  /** 三角波衰减 s */
  toneDecay: number;
  gain: number;
}

const VOICES: Record<KeyKind, Voice> = {
  key: { band: 760, noiseDecay: 0.04, toneFrom: 300, toneTo: 190, toneDecay: 0.03, gain: 1 },
  space: { band: 560, noiseDecay: 0.06, toneFrom: 240, toneTo: 150, toneDecay: 0.045, gain: 1.05 },
  backspace: { band: 1000, noiseDecay: 0.03, toneFrom: 340, toneTo: 260, toneDecay: 0.025, gain: 0.75 },
  enter: { band: 480, noiseDecay: 0.08, toneFrom: 220, toneTo: 120, toneDecay: 0.15, gain: 1.1 },
};

const MIN_INTERVAL_MS = 25;
const REPEAT_INTERVAL_MS = 70;

export class KeySound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = 0;

  play(kind: KeyKind, repeat: boolean): void {
    const now = performance.now();
    if (now - this.last < (repeat ? REPEAT_INTERVAL_MS : MIN_INTERVAL_MS)) return;
    this.last = now;
    const ctx = this.ensure();
    const v = VOICES[kind];
    const jitter = () => 1 + (Math.random() - 0.5) * 0.1;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = v.band * jitter();
    band.Q.value = 1.3;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.5 * v.gain, t + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + v.noiseDecay);
    src.connect(band).connect(ng).connect(this.out!);
    src.start(t);
    src.stop(t + v.noiseDecay + 0.02);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const pitch = jitter();
    osc.frequency.setValueAtTime(v.toneFrom * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(v.toneTo * pitch, t + v.toneDecay);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.35 * v.gain, t + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, t + v.toneDecay);
    osc.connect(og).connect(this.out!);
    osc.start(t);
    osc.stop(t + v.toneDecay + 0.02);
  }

  destroy(): void {
    void this.ctx?.close();
    this.ctx = null;
  }

  /** 首次发声时才创建 AudioContext（浏览器要求用户手势后才能出声） */
  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 12;
    const out = ctx.createGain();
    out.gain.value = 0.35;
    out.connect(limiter).connect(ctx.destination);
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.12), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.ctx = ctx;
    this.out = out;
    this.noise = buffer;
    return ctx;
  }
}
