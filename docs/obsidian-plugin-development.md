# Obsidian 插件开发指南

本指南用于启动本仓库的 Obsidian 插件开发。示例沿用 Obsidian 官方模板的 TypeScript、npm 和 esbuild；插件 ID、功能、最低兼容版本与目标平台在实现时按需求确定。

## 官方资料

| 要做什么 | 从这里开始 |
| --- | --- |
| 编译并加载第一个插件 | [Build a plugin](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)、[官方示例模板](https://github.com/obsidianmd/obsidian-sample-plugin) |
| 了解入口、启停与清理 | [Anatomy of a plugin](https://docs.obsidian.md/Plugins/Getting+started/Anatomy+of+a+plugin)、[Plugin API](https://docs.obsidian.md/Reference/TypeScript+API/Plugin) |
| 查 API 签名与版本 | [官方 TypeScript 类型定义](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)，开发时也可查看已安装的 `node_modules/obsidian/obsidian.d.ts` |
| 配置版本和平台 | [Manifest](https://docs.obsidian.md/Reference/Manifest)、[Mobile development](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development) |
| 实现功能并检查常见问题 | [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) |
| 发布到社区插件目录 | [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)、[提交要求](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)、[开发者政策](https://docs.obsidian.md/community-directory/developer-policies) |

## 本地开发与调试

1. 在 Obsidian 新建一个专用的测试 Vault，放几篇可以重建的测试笔记。插件中涉及的创建、编辑和删除都在这里验证。
2. 开始实现时，参考官方模板把 `src/`、`package.json`、构建配置和 `manifest.json` 引入本仓库。安装 Git 和当前受支持的 Node.js LTS；以所采用的模板及其依赖要求为准。
3. 在插件项目根目录运行 `npm install` 安装依赖，然后执行 `npm run dev`。官方模板会监听源码并把 `src/main.ts` 打包为项目根目录下的 `main.js`。
4. 将 `main.js`、`manifest.json` 和 `styles.css`（如有）放到测试 Vault 的 `.obsidian/plugins/<插件 ID>/` 下，目录名必须与 `manifest.json` 的 `id` 一致。这里使用默认配置目录 `.obsidian`；如测试 Vault 改了配置目录，使用实际路径。
5. 在 Obsidian 的「设置 → 社区插件」中打开社区插件并启用自己的插件。修改源码后，将最新构建产物放回测试目录，再关闭并重新启用插件；源码自动构建后，Obsidian 仍需重新加载插件。修改 `manifest.json` 后按官方指南重启应用。

macOS 可按 `⌘⌥I` 打开开发者工具。插件没有出现时，先查 `manifest.json`、插件目录名和 `main.js` 是否对应；能启用但功能无响应时，再看控制台的加载异常并确认运行的是最新产物。官方模板还提供 `npm run build`（类型检查并生成生产包）和 `npm run lint`。

## 文件与最小入口

| 文件 | 用途 |
| --- | --- |
| `src/main.ts` | 默认导出继承 `Plugin` 的类；在 `onload()` 中注册命令、事件和界面 |
| `manifest.json` | 声明插件 `id`、`name`、`version`、`minAppVersion`、`description`、`author` 和 `isDesktopOnly` |
| `main.js` | Obsidian 加载的构建产物 |
| `styles.css` | 可选，放插件的界面样式；样式限定在插件自己的容器中 |
| `versions.json` | 记录插件发布版本与最低 Obsidian 版本的映射，用于旧版客户端选择兼容版本 |

插件 ID 使用小写字母和连字符，例如 `note-tools`。上架时 ID 需全局唯一，不能包含 `obsidian`，也不能以 `plugin` 结尾。`minAppVersion` 应覆盖实际调用的 API，并在声明的最低版本上验证；安装了最新的 npm 类型定义并不代表旧客户端也支持这些 API。

下面的最小入口可以替换模板里的 `src/main.ts`。启用后，在命令面板执行「验证插件加载」，应看到提示。

```ts
import { Notice, Plugin } from 'obsidian';

export default class NoteToolsPlugin extends Plugin {
  onload(): void {
    this.addCommand({
      id: 'verify-loading',
      name: '验证插件加载',
      callback: () => {
        new Notice('插件已加载');
      },
    });
  }
}
```

## 常用 API 的选择

| 需求 | 推荐入口 |
| --- | --- |
| 修改当前编辑器中的选区或正文 | `addCommand({ editorCallback })` 取得 `Editor`，通过编辑器操作保留光标、选区等状态 |
| 查找、读取或修改 Vault 文件 | `this.app.vault`；按路径定位文件。修改后台文件的已有内容用 `Vault.process()`，避免把读取和写回拆成两步 |
| 读取已有索引的标签、链接或属性 | `this.app.metadataCache`；写入笔记的 YAML frontmatter 用 `this.app.fileManager.processFrontMatter()` |
| 获取当前视图或管理自定义面板 | `this.app.workspace`；按视图类型调用 `getActiveViewOfType()`，自定义面板用 `registerView()` |
| 添加设置并保存插件自己的数据 | `PluginSettingTab`、`addSettingTab()` 与 `loadData()` / `saveData()`；加载时为未保存的字段保留默认值 |
| 监听 Vault、Workspace、DOM 事件或定时器 | `registerEvent()`、`registerDomEvent()`、`registerInterval()` 让 Obsidian 在卸载时清理；其他需要手动释放的资源在 `onunload()` 处理 |

插件内用 `this.app` 访问宿主，通过 `normalizePath()` 处理用户给出的 Vault 相对路径。需要访问 Vault 配置目录时使用 `app.vault.configDir`。显示用户输入或笔记内容时用文本节点或 Obsidian 的 DOM 辅助函数；界面颜色优先使用 Obsidian CSS 变量，以适配主题。

移动端没有 Node.js 和 Electron API。若计划支持 iOS / Android，需要检查插件和依赖是否调用这些 API，并在目标平台验证启用和核心操作；如果功能必须依赖桌面能力，将 `isDesktopOnly` 设为 `true`。每次新增事件监听时，关闭插件应停止响应，重新启用后一次事件应只触发一次。

## 发布到社区插件目录

1. 确认生产构建能在测试 Vault 中安装、启用并运行核心功能。准备公开的 GitHub 仓库，在根目录放 `README.md`、`LICENSE` 和 `manifest.json`。
2. 更新 `manifest.json` 的 `version` 和 `minAppVersion`，同步 `versions.json`；GitHub Release 的标签与 `version` 完全相同，例如 `1.0.0`。将 `main.js`、`manifest.json` 和可选的 `styles.css` 作为独立的 Release 附件上传。
3. 首次上架时，在 [Obsidian Community](https://community.obsidian.md/) 绑定 GitHub 账号并提交插件，按目录的反馈处理审核。目录会读取默认分支最新提交中的 `manifest.json`，并从匹配版本的 GitHub Release 获取安装文件。后续更新通过 GitHub Release 分发。提交时以[官方发布指南](https://docs.obsidian.md/plugins/releasing/submit-plugin)为准。
