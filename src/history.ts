import { App, FuzzySuggestModal, TFile, normalizePath } from 'obsidian';

const MAX_ITEMS = 50;
const SUMMARY_LEN = 60;

interface HistoryOptions {
  folder: () => string;
  /** embed 为 true 时插入 ![[嵌入]]（笔记里直接显示内容），否则插入 [[链接]] */
  onInsertLink: (file: TFile, embed: boolean) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 文件名 `YYYY-MM-DD HHmmss` -> `MM-DD HH:mm`；不匹配时用 ctime */
export function formatTime(file: TFile): string {
  const m = /^\d{4}-(\d{2}-\d{2}) (\d{2})(\d{2})\d{2}/.exec(file.basename);
  if (m) return `${m[1]} ${m[2]}:${m[3]}`;
  const d = new Date(file.stat.ctime);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 去掉 frontmatter 和空行，取首行并截断 */
export function summarize(raw: string): string {
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '');
  const line = body.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const text = line.trim();
  return text.length > SUMMARY_LEN ? text.slice(0, SUMMARY_LEN) + '…' : text;
}

export class HistoryDrawer {
  private el: HTMLElement;
  private countEl: HTMLElement;
  private listEl: HTMLElement;
  private opened = false;
  private openedAt = 0;
  private renderToken = 0;

  constructor(private app: App, private parent: HTMLElement, private opts: HistoryOptions) {
    this.el = parent.createDiv({ cls: 'abyssal-jot-history' });
    const head = this.el.createDiv({ cls: 'abyssal-jot-history-head' });
    head.createSpan({ cls: 'abyssal-jot-history-title', text: 'History' });
    this.countEl = head.createSpan({ cls: 'abyssal-jot-history-count' });
    const closeBtn = head.createEl('button', {
      cls: 'abyssal-jot-history-close',
      text: '×',
      attr: { 'aria-label': '关闭' },
    });
    closeBtn.addEventListener('click', () => this.close());
    this.listEl = this.el.createDiv({ cls: 'abyssal-jot-history-list' });

    parent.addEventListener('click', this.onOutsideClick);
    parent.ownerDocument.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  async open(): Promise<void> {
    this.opened = true;
    this.openedAt = performance.now();
    this.el.addClass('is-open');
    const token = ++this.renderToken;
    const items = await this.loadItems();
    if (token !== this.renderToken) return;
    this.render(items);
  }

  close(): void {
    this.opened = false;
    this.renderToken++;
    this.el.removeClass('is-open');
  }

  toggle(): Promise<void> {
    if (this.opened) {
      this.close();
      return Promise.resolve();
    }
    return this.open();
  }

  destroy(): void {
    this.parent.removeEventListener('click', this.onOutsideClick);
    this.parent.ownerDocument.removeEventListener('keydown', this.onKeyDown, true);
    this.el.remove();
  }

  private onOutsideClick = (e: MouseEvent) => {
    // 忽略触发打开的那次点击本身
    if (!this.opened || e.timeStamp < this.openedAt) return;
    if (e.target instanceof Node && this.el.contains(e.target)) return;
    this.close();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.opened || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
  };

  private async loadItems(): Promise<{ file: TFile; summary: string }[]> {
    const folder = normalizePath(this.opts.folder());
    const prefix = folder === '/' ? '' : folder + '/';
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(prefix))
      .sort((a, b) => b.stat.ctime - a.stat.ctime)
      .slice(0, MAX_ITEMS);
    return Promise.all(
      files.map(async (file) => ({ file, summary: summarize(await this.app.vault.cachedRead(file)) })),
    );
  }

  private render(items: { file: TFile; summary: string }[]) {
    this.listEl.empty();
    this.countEl.setText(String(items.length));
    if (items.length === 0) {
      this.listEl.createDiv({ cls: 'abyssal-jot-history-empty', text: '还没有沉下去的想法' });
      return;
    }
    for (const { file, summary } of items) {
      const item = this.listEl.createDiv({ cls: 'abyssal-jot-history-item' });
      item.createDiv({ cls: 'abyssal-jot-history-time', text: formatTime(file) });
      item.createDiv({ cls: 'abyssal-jot-history-summary', text: summary || file.basename });
      const actions = item.createDiv({ cls: 'abyssal-jot-history-actions' });
      actions
        .createEl('button', { cls: 'abyssal-jot-history-action', text: '打开' })
        .addEventListener('click', () => {
          void this.app.workspace.getLeaf('tab').openFile(file);
        });
      for (const [text, embed] of [['插入链接', false], ['嵌入预览', true]] as const) {
        actions
          .createEl('button', { cls: 'abyssal-jot-history-action', text })
          .addEventListener('click', () => {
            this.opts.onInsertLink(file, embed);
            this.close();
          });
      }
    }
  }
}

/** ↵ 插入 [[链接]]；⇧↵ 或 ⇧点击 插入 ![[嵌入]] */
export class NoteSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onChoose: (file: TFile, embed: boolean) => void) {
    super(app);
    this.setPlaceholder('搜索一个旧想法…');
    this.setInstructions([
      { command: '↵', purpose: '插入链接（点击跳转）' },
      { command: '⇧ ↵', purpose: '嵌入预览（笔记里直接显示内容）' },
      { command: 'esc', purpose: '取消' },
    ]);
    // SuggestModal 默认只响应无修饰键的 Enter，补上 Shift+Enter
    this.scope.register(['Shift'], 'Enter', (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent): void {
    this.onChoose(file, evt.shiftKey);
  }
}
