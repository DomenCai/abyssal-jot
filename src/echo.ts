/**
 * 「点一个小生命，看看哪些想法会回应」：用输入框里的词去匹配保存目录里的旧想法，
 * 在被点中的生物旁边浮出一个气泡；没有可匹配的词或没匹配上时，随机浮上来一条。
 */
import { App, TFile, normalizePath } from 'obsidian';
import { formatTime, summarize } from './history';

export interface Echo {
  file: TFile;
  summary: string;
  /** 匹配上的词；随机浮上来时为 null */
  keyword: string | null;
}

/** 参与匹配的旧想法上限（按创建时间取最新） */
const MAX_SCAN = 300;
/** 气泡自动消失的时间 */
const BUBBLE_MS = 8000;

/** 拆词：中文按相邻两字切分（无需分词库也能命中「水母」「深海」这类词），其他文字按 2 字符以上的词 */
function keywords(text: string): string[] {
  const words = new Set<string>();
  const plain = text.replace(/!?\[\[[^\]]*\]\]/g, ' ');
  for (const run of plain.match(/\p{Script=Han}+|[\p{L}\p{N}]{2,}/gu) ?? []) {
    if (/\p{Script=Han}/u.test(run)) {
      for (let i = 0; i + 2 <= run.length; i++) words.add(run.slice(i, i + 2));
    } else {
      words.add(run.toLowerCase());
    }
  }
  return [...words];
}

export async function findEcho(app: App, folder: string, text: string): Promise<Echo | null> {
  const prefix = `${normalizePath(folder)}/`;
  const files = app.vault
    .getMarkdownFiles()
    .filter((f) => f.path.startsWith(prefix))
    .sort((a, b) => b.stat.ctime - a.stat.ctime)
    .slice(0, MAX_SCAN);
  if (files.length === 0) return null;

  const words = keywords(text);
  if (words.length > 0) {
    let best: { file: TFile; raw: string; hits: string[] }[] = [];
    let bestScore = 0;
    for (const file of files) {
      const raw = await app.vault.cachedRead(file);
      const body = raw.toLowerCase();
      const hits = words.filter((w) => body.includes(w));
      if (hits.length === 0 || hits.length < bestScore) continue;
      if (hits.length > bestScore) {
        bestScore = hits.length;
        best = [];
      }
      best.push({ file, raw, hits });
    }
    if (best.length > 0) {
      const chosen = best[Math.floor(Math.random() * best.length)];
      const keyword = chosen.hits.reduce((a, b) => (b.length > a.length ? b : a));
      return { file: chosen.file, summary: summarize(chosen.raw), keyword };
    }
  }
  const file = files[Math.floor(Math.random() * files.length)];
  return { file, summary: summarize(await app.vault.cachedRead(file)), keyword: null };
}

export class EchoBubble {
  private el: HTMLElement;
  private timer = 0;

  constructor(
    private parent: HTMLElement,
    private opts: { onOpen: (file: TFile) => void; onInsertLink: (file: TFile) => void },
  ) {
    this.el = parent.createDiv({ cls: 'abyssal-jot-echo' });
  }

  /** 在 at（相对视图根节点）附近显示，自动避开视图边缘 */
  show(at: { x: number; y: number }, echo: Echo | null): void {
    const { el } = this;
    el.empty();
    if (echo) {
      el.createDiv({ cls: 'abyssal-jot-echo-why', text: echo.keyword ? `因「${echo.keyword}」回应` : '一条旧想法浮了上来' });
      el.createDiv({ cls: 'abyssal-jot-echo-time', text: formatTime(echo.file) });
      el.createDiv({ cls: 'abyssal-jot-echo-text', text: echo.summary || echo.file.basename });
      const actions = el.createDiv({ cls: 'abyssal-jot-echo-actions' });
      actions.createEl('button', { text: '打开' }).onclick = () => {
        this.opts.onOpen(echo.file);
        this.hide();
      };
      actions.createEl('button', { text: '插入链接' }).onclick = () => {
        this.opts.onInsertLink(echo.file);
        this.hide();
      };
    } else {
      el.createDiv({ cls: 'abyssal-jot-echo-text', text: '还没有沉下去的想法' });
    }
    const width = 260;
    const { clientWidth: pw, clientHeight: ph } = this.parent;
    el.style.left = `${Math.max(12, Math.min(pw - width - 12, at.x + 16))}px`;
    el.style.top = `${Math.max(12, Math.min(ph - 140, at.y - 20))}px`;
    el.removeClass('is-visible');
    void el.offsetWidth;
    el.addClass('is-visible');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), BUBBLE_MS);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.el.removeClass('is-visible');
  }

  destroy(): void {
    window.clearTimeout(this.timer);
    this.el.remove();
  }
}
