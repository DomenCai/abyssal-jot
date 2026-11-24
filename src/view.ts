import { ItemView, Notice, Platform, Scope, TFile, WorkspaceLeaf, debounce, normalizePath, setIcon } from 'obsidian';
import type AbyssalJotPlugin from './main';
import { Effects, Point, Preset } from './effects';
import { EchoBubble, findEcho } from './echo';
import { HistoryDrawer, NoteSuggestModal } from './history';
import { KeyKind, KeySound } from './keysound';
import { Mix, Ocean, Perf } from './ocean';

export const VIEW_TYPE = 'abyssal-jot-view';

/** 预设在输入卡胶囊和状态行里的图标与文案；键的顺序就是胶囊点击循环的顺序 */
const PRESETS: Record<Preset, { icon: string; chip: string; status: string }> = {
  dither: { icon: 'droplet', chip: 'Dither 墨滴飞溅', status: '已切换为：Dither 1-Bit 墨滴飞溅 + 换行像素彗尾' },
  pastel: { icon: 'sparkles', chip: 'Pastel 涟漪靶框', status: '已切换为：Pastel 涟漪 + 词框锁定 (X.. Y..) + 换行彗星尾迹' },
  off: { icon: 'pause', chip: '动效已关', status: '已关闭输入特效' },
};
const PRESET_ORDER = Object.keys(PRESETS) as Preset[];

const MIXES: Record<Mix, string> = { all: '多种混游', jelly: '只看水母', shark: '只看鲨鱼' };
const CELLS: Record<string, string> = { '8': '极细格', '10': '细格', '14': '粗格' };
/** 背景网格线的 alpha 随格子档位：格子越细线越密，线要越淡 */
const GRID_ALPHA: Record<string, number> = { '8': 0.008, '10': 0.012, '14': 0.016 };

/** 本地时间的日期与时分秒（补零），用于文件名、frontmatter 和收件箱标题 */
function localStamp(): { date: string; time: string[] } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: [now.getHours(), now.getMinutes(), now.getSeconds()].map(pad),
  };
}

export class AbyssalJotView extends ItemView {
  private ocean!: Ocean;
  private effects!: Effects;
  private drawer!: HistoryDrawer;
  private echo!: EchoBubble;
  private sound = new KeySound();
  private ta!: HTMLTextAreaElement;
  private card!: HTMLElement;
  private sendBtn!: HTMLElement;
  private historyCount!: HTMLElement;
  private statusEl!: HTMLElement;
  private compStart = 0;
  private lineBreakFrom: Point | null = null;
  private saving = false;
  private saveDraft = debounce(() => {
    this.plugin.data.draft = this.ta.value;
    void this.plugin.persist();
  }, 500, true);

  constructor(leaf: WorkspaceLeaf, private plugin: AbyssalJotPlugin) {
    super(leaf);
    // 视图激活时 ⌘/Ctrl+Enter 保存；组字中的回车留给输入法选词
    this.scope = new Scope(this.app.scope);
    this.scope.register(['Mod'], 'Enter', (evt) => {
      if (evt.isComposing) return true;
      void this.save();
      return false;
    });
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return '潜思';
  }

  getIcon(): string {
    return 'waves';
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('abyssal-jot');

    const ocean = root.createEl('canvas', { cls: 'abyssal-jot-ocean' });
    const stage = root.createDiv({ cls: 'abyssal-jot-stage' });
    stage.createEl('h1', { cls: 'abyssal-jot-title', text: "what's on your mind?" });
    const card = stage.createDiv({ cls: 'abyssal-jot-card' });
    this.ta = card.createEl('textarea', {
      cls: 'abyssal-jot-input',
      attr: { placeholder: '一句话，也值得留在这里……', spellcheck: 'false' },
    });
    const bar = card.createDiv({ cls: 'abyssal-jot-bar' });
    const linkBtn = bar.createEl('button', { cls: 'abyssal-jot-link', text: '+ 关联一个旧想法' });
    const actions = bar.createDiv({ cls: 'abyssal-jot-actions' });
    const presetBtn = actions.createEl('button', { cls: 'abyssal-jot-chip is-active' });
    const soundBtn = actions.createEl('button', { cls: 'abyssal-jot-chip', attr: { 'aria-label': '键音' } });
    setIcon(soundBtn.createSpan(), 'volume-2');
    soundBtn.createSpan({ text: '键音' });
    soundBtn.toggleClass('is-active', this.plugin.data.keySound);
    const sendBtn = actions.createEl('button', { cls: 'abyssal-jot-send', attr: { 'aria-label': '保存为笔记' } });
    setIcon(sendBtn, 'arrow-up');
    this.sendBtn = sendBtn;
    card.createDiv({
      cls: 'abyssal-jot-hint',
      text: `${Platform.isMacOS ? '⌘' : 'Ctrl'} + Enter · 保存为笔记`,
    });
    this.card = card;
    this.statusEl = stage.createDiv({ cls: 'abyssal-jot-status' });

    const fx = root.createEl('canvas', { cls: 'abyssal-jot-fx' });
    const pauseBtn = root.createEl('button', { cls: 'abyssal-jot-pause' });
    const pauseIcon = pauseBtn.createSpan();
    const pauseText = pauseBtn.createSpan();
    const historyBtn = root.createEl('button', { cls: 'abyssal-jot-history-btn' });
    setIcon(historyBtn.createSpan(), 'history');
    historyBtn.createSpan({ text: 'History' });
    this.historyCount = historyBtn.createSpan({ cls: 'abyssal-jot-history-btn-count' });
    this.updateHistoryCount();

    const { data } = this.plugin;
    const applyCell = () => {
      root.style.setProperty('--abyssal-jot-cell', `${data.cell}px`);
      root.style.setProperty('--abyssal-jot-grid-alpha', String(GRID_ALPHA[data.cell]));
    };
    applyCell();
    this.ocean = new Ocean(ocean, data.cell, data.mix, data.perf);
    this.echo = new EchoBubble(root, {
      onOpen: (file) => void this.app.workspace.getLeaf('tab').openFile(file),
      onInsertLink: (file) => this.insertLink(file, false),
    });
    root.createDiv({ cls: 'abyssal-jot-tip', text: '点一个小生命，看看哪些想法会回应' });

    // 右上角：生物组合、网格密度
    const controls = root.createDiv({ cls: 'abyssal-jot-controls' });
    const mixSelect = controls.createEl('select', { cls: 'abyssal-jot-select' });
    for (const [value, label] of Object.entries(MIXES)) mixSelect.createEl('option', { value, text: label });
    mixSelect.value = data.mix;
    mixSelect.onchange = async () => {
      data.mix = mixSelect.value as Mix;
      this.ocean.setMix(data.mix);
      await this.plugin.persist();
    };
    const cellSelect = controls.createEl('select', { cls: 'abyssal-jot-select' });
    for (const [value, label] of Object.entries(CELLS)) cellSelect.createEl('option', { value, text: label });
    cellSelect.value = String(data.cell);
    cellSelect.onchange = async () => {
      data.cell = Number(cellSelect.value);
      applyCell();
      this.ocean.setCell(data.cell);
      await this.plugin.persist();
    };

    // 点背景空白处：命中生物就让它停顿发光并浮出一条旧想法，没命中就收起气泡
    this.registerDomEvent(root, 'click', (e) => {
      if (e.target !== root) return;
      const rect = root.getBoundingClientRect();
      const at = this.ocean.greetAt(e.clientX - rect.left, e.clientY - rect.top);
      if (!at) {
        this.echo.hide();
        return;
      }
      void findEcho(this.app, data.folder, this.ta.value).then((echo) => this.echo.show(at, echo));
    });
    this.effects = new Effects(fx, root, this.ta);
    this.drawer = new HistoryDrawer(this.app, root, {
      folder: () => this.plugin.data.folder,
      onInsertLink: (file, embed) => this.insertLink(file, embed),
    });

    this.ta.value = this.plugin.data.draft;
    this.ta.setSelectionRange(this.ta.value.length, this.ta.value.length);
    this.updateSend();

    const applyPreset = () => {
      const preset = PRESETS[data.preset];
      presetBtn.empty();
      setIcon(presetBtn.createSpan(), preset.icon);
      presetBtn.createSpan({ text: preset.chip });
      presetBtn.toggleClass('is-active', data.preset !== 'off');
      // 光标颜色等随预设变化的样式挂在根节点上
      root.setAttr('data-preset', data.preset);
      this.effects.setPreset(data.preset);
    };
    applyPreset();
    presetBtn.onclick = async () => {
      data.preset = PRESET_ORDER[(PRESET_ORDER.indexOf(data.preset) + 1) % PRESET_ORDER.length];
      applyPreset();
      this.showStatus(PRESETS[data.preset].icon, PRESETS[data.preset].status);
      await this.plugin.persist();
      this.ta.focus();
    };
    linkBtn.onclick = () => new NoteSuggestModal(this.app, (file, embed) => this.insertLink(file, embed)).open();
    historyBtn.onclick = () => void this.drawer.toggle();

    soundBtn.onclick = async () => {
      this.plugin.data.keySound = !this.plugin.data.keySound;
      soundBtn.toggleClass('is-active', this.plugin.data.keySound);
      await this.plugin.persist();
      this.ta.focus();
    };
    sendBtn.onclick = () => void this.save();
    let paused = false;
    const applyPause = () => {
      setIcon(pauseIcon, paused ? 'play' : 'pause');
      pauseText.setText(paused ? '继续动效' : '暂停动效');
    };
    applyPause();
    pauseBtn.onclick = () => {
      paused = !paused;
      applyPause();
      this.ocean.setPaused(paused);
    };

    this.registerDomEvent(this.ta, 'keydown', (e) => this.onKeyDown(e));
    this.registerDomEvent(this.ta, 'beforeinput', (e) => {
      if (e.inputType === 'insertLineBreak') this.lineBreakFrom = this.effects.caretAt(this.ta.selectionStart);
    });
    this.registerDomEvent(this.ta, 'input', (e) => this.onInput(e as InputEvent));
    this.registerDomEvent(this.ta, 'compositionstart', () => {
      this.compStart = this.ta.selectionStart;
    });
    this.registerDomEvent(this.ta, 'scroll', () => {
      this.ta.toggleClass('is-scrolled', this.ta.scrollTop > 0);
    });
    this.registerDomEvent(this.ta, 'compositionend', (e) => {
      this.effects.commit(this.compStart, this.ta.selectionStart, e.data);
    });

    const observer = new ResizeObserver(() => {
      const { width, height } = root.getBoundingClientRect();
      this.ocean.resize(width, height, this.cardRect());
      this.effects.resize(width, height);
    });
    observer.observe(root);
    this.register(() => observer.disconnect());

    window.setTimeout(() => this.ta.focus(), 0);
  }

  async onClose(): Promise<void> {
    this.saveDraft.run();
    this.ocean.destroy();
    this.effects.destroy();
    this.drawer.destroy();
    this.echo.destroy();
    this.sound.destroy();
  }

  /**
   * 把链接插到光标处（替换选区），格式遵循用户的 Obsidian 链接设置。
   * embed 时加 ! 前缀成为嵌入（wikilink 与 Markdown 链接都适用），笔记里直接显示被引用的内容。
   */
  private insertLink(file: TFile, embed: boolean): void {
    const link = (embed ? '!' : '') + this.app.fileManager.generateMarkdownLink(file, '');
    this.ta.focus();
    this.ta.setRangeText(link, this.ta.selectionStart, this.ta.selectionEnd, 'end');
    this.saveDraft();
    this.updateSend();
    this.effects.ripple(this.effects.caretAt(this.ta.selectionStart));
  }

  setPerf(perf: Perf): void {
    this.ocean.setPerf(perf);
  }

  private updateHistoryCount(): void {
    const prefix = `${normalizePath(this.plugin.data.folder)}/`;
    const count = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix)).length;
    this.historyCount.setText(String(count));
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.plugin.data.keySound || e.metaKey || e.ctrlKey || e.altKey) return;
    let kind: KeyKind;
    if (e.key === 'Enter') kind = e.isComposing ? 'key' : 'enter';
    else if (e.key === ' ') kind = 'space';
    else if (e.key === 'Backspace' || e.key === 'Delete') kind = 'backspace';
    else if (e.key.length === 1 || e.key === 'Process') kind = 'key';
    else return;
    this.sound.play(kind, e.repeat);
  }

  /** 发送按钮：输入为空时变暗，有字时点亮 */
  private updateSend(): void {
    this.sendBtn.toggleClass('is-ready', this.ta.value.trim() !== '');
  }

  private onInput(e: InputEvent): void {
    this.saveDraft();
    this.updateSend();
    // 背景生物回应输入，不受输入特效预设影响
    this.ocean.react(e.inputType === 'insertLineBreak' ? 'break' : 'type', this.cardRect());
    const caret = this.ta.selectionStart;
    if (e.isComposing) {
      this.effects.compose(this.compStart, caret);
      return;
    }
    if (e.inputType === 'insertLineBreak' && this.lineBreakFrom) {
      this.effects.comet(this.lineBreakFrom, this.effects.caretAt(caret));
      this.lineBreakFrom = null;
    } else if (e.inputType === 'insertText' || e.inputType === 'insertFromPaste') {
      this.effects.ripple(this.effects.caretAt(caret));
    }
  }

  /** 输入卡相对视图根节点的矩形（px） */
  private cardRect(): { x: number; y: number; w: number; h: number } {
    const cardRect = this.card.getBoundingClientRect();
    const rootRect = this.contentEl.getBoundingClientRect();
    return { x: cardRect.left - rootRect.left, y: cardRect.top - rootRect.top, w: cardRect.width, h: cardRect.height };
  }

  private async save(): Promise<void> {
    const text = this.ta.value.trim();
    if (!text || this.saving) return;
    this.saving = true;
    try {
      const inbox = this.plugin.data.saveMode === 'inbox';
      const file = inbox ? await this.appendInbox(text) : await this.createNote(text);
      this.flyAway();
      const rect = this.cardRect();
      this.effects.wave(rect);
      this.ocean.react('save', rect);
      this.ta.value = '';
      this.updateSend();
      this.saveDraft.cancel();
      this.plugin.data.draft = '';
      await this.plugin.persist();
      this.updateHistoryCount();
      this.showStatus('check', inbox ? `已追加到 ${file.path}` : `已沉入 ${file.path}`);
    } catch (err) {
      new Notice(`潜思：保存失败，${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.saving = false;
      this.ta.focus();
    }
  }

  private async createNote(text: string): Promise<TFile> {
    const { vault } = this.app;
    const folder = normalizePath(this.plugin.data.folder);
    if (!vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
    const { date, time } = localStamp();
    const base = `${date} ${time.join('')}`;
    let path = `${folder}/${base}.md`;
    for (let n = 2; vault.getAbstractFileByPath(path); n++) path = `${folder}/${base}-${n}.md`;
    // 本地时间、不带时区后缀，与 Obsidian 属性面板的日期时间格式一致
    return vault.create(path, `---\ncreated: ${date}T${time.join(':')}\n---\n${text}\n`);
  }

  /** 追加到收件箱文件末尾，每条一个时间标题；文件或上级目录不存在时创建 */
  private async appendInbox(text: string): Promise<TFile> {
    const { vault } = this.app;
    const path = normalizePath(this.plugin.data.inboxPath);
    const { date, time } = localStamp();
    const entry = `## ${date} ${time.join(':')}\n\n${text}\n`;
    const existing = vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await vault.process(existing, (data) => (data.trim() ? `${data.trimEnd()}\n\n${entry}` : entry));
      return existing;
    }
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (parent && !vault.getAbstractFileByPath(parent)) await vault.createFolder(parent);
    return vault.create(path, entry);
  }

  /** 保存后原文从输入框上浮淡出 */
  private flyAway(): void {
    const ghost = this.ta.parentElement!.createDiv({ cls: 'abyssal-jot-flyaway', text: this.ta.value });
    ghost.scrollTop = this.ta.scrollTop;
    ghost.addEventListener('animationend', () => ghost.remove());
  }

  /** 卡片下方的状态行：图标 + 文案，3 秒淡出 */
  private showStatus(icon: string, text: string): void {
    this.statusEl.empty();
    setIcon(this.statusEl.createSpan(), icon);
    this.statusEl.createSpan({ text });
    this.statusEl.removeClass('is-visible');
    void this.statusEl.offsetWidth;
    this.statusEl.addClass('is-visible');
  }
}
