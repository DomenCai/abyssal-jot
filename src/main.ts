import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { Preset } from './effects';
import type { Mix, Perf } from './ocean';
import { AbyssalJotView, VIEW_TYPE } from './view';

export interface JotData {
  /** 保存目录（Vault 相对路径），History 也列这个目录 */
  folder: string;
  /** note：每条一篇新笔记；inbox：追加到单个收件箱文件 */
  saveMode: 'note' | 'inbox';
  /** 收件箱文件路径（Vault 相对路径） */
  inboxPath: string;
  /** 输入特效预设，在视图内切换后记住 */
  preset: Preset;
  /** 背景生物组合，在视图右上角切换后记住 */
  mix: Mix;
  /** 网格格子边长（px），在视图右上角切换后记住 */
  cell: number;
  /** 性能档位：背景帧率与生物数量 */
  perf: Perf;
  /** 键音开关，在视图内切换后记住 */
  keySound: boolean;
  /** 未保存的草稿，与设置存在同一个 data.json 里，整体读写避免互相覆盖 */
  draft: string;
}

const DEFAULT_DATA: JotData = {
  folder: '潜思',
  saveMode: 'note',
  inboxPath: '潜思/收件箱.md',
  preset: 'dither',
  mix: 'all',
  cell: 8,
  perf: 'standard',
  keySound: false,
  draft: '',
};

export default class AbyssalJotPlugin extends Plugin {
  data: JotData = { ...DEFAULT_DATA };

  async onload(): Promise<void> {
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());
    // 旧版的「流畅」档已并入标准档
    if (this.data.perf !== 'saver') this.data.perf = 'standard';

    this.registerView(VIEW_TYPE, (leaf) => new AbyssalJotView(leaf, this));
    this.addRibbonIcon('waves', '打开潜思', () => this.openView());
    this.addCommand({
      id: 'open',
      name: '打开潜思',
      callback: () => this.openView(),
    });
    this.addSettingTab(new JotSettingTab(this.app, this));
  }

  async persist(): Promise<void> {
    await this.saveData(this.data);
  }

  private async openView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? workspace.getLeaf('tab');
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
  }
}

class JotSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AbyssalJotPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { data } = this.plugin;
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName('保存方式')
      .setDesc('每条想法存成一篇新笔记，或全部追加到同一个收件箱文件。')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('note', '每条一篇新笔记')
          .addOption('inbox', '追加到收件箱文件')
          .setValue(data.saveMode)
          .onChange(async (value) => {
            data.saveMode = value as JotData['saveMode'];
            await this.plugin.persist();
          }),
      );
    new Setting(this.containerEl)
      .setName('性能档位')
      .setDesc('背景动画的帧率与生物数量。笔记本用电池时可选省电。')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('saver', '省电（30fps，生物较少）')
          .addOption('standard', '标准（60fps）')
          .setValue(data.perf)
          .onChange(async (value) => {
            data.perf = value as Perf;
            await this.plugin.persist();
            for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
              if (leaf.view instanceof AbyssalJotView) leaf.view.setPerf(data.perf);
            }
          }),
      );
    new Setting(this.containerEl)
      .setName('保存目录')
      .setDesc('「每条一篇新笔记」时存到这里，History 也列出这个目录；不存在时会自动创建。')
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_DATA.folder)
          .setValue(data.folder)
          .onChange(async (value) => {
            data.folder = value.trim() || DEFAULT_DATA.folder;
            await this.plugin.persist();
          }),
      );
    new Setting(this.containerEl)
      .setName('收件箱文件')
      .setDesc('「追加到收件箱文件」时写入这里，每条带时间标题；文件不存在时会自动创建。')
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_DATA.inboxPath)
          .setValue(data.inboxPath)
          .onChange(async (value) => {
            data.inboxPath = value.trim() || DEFAULT_DATA.inboxPath;
            await this.plugin.persist();
          }),
      );
  }
}
