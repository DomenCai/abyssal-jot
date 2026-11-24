# 潜思 Abyssal Jot

深海沉浸式随手记 Obsidian 插件：像素水母与鲨鱼在身后游动，一句话也值得留下。

- 仅支持桌面端，Obsidian ≥ 1.12.0
- 打开方式：左侧栏波浪图标，或命令面板执行「打开潜思」

## 让 AI agent 帮你安装

把这句话发给你的 coding agent（Claude Code / Codex 等）：

```text
阅读 https://raw.githubusercontent.com/DomenCai/abyssal-jot/main/README.md ，然后帮我安装这个 Obsidian 插件
```

## 安装步骤

> Agent 请按以下步骤执行；人工安装同理。

1. 向用户确认 Obsidian vault 的绝对路径，记为 `<VAULT>`（其下应有 `.obsidian` 目录）。
2. 克隆并构建（需要 git 和 Node.js 18+）。`main.js` 是构建产物，不在仓库里，必须先构建：
   ```bash
   git clone https://github.com/DomenCai/abyssal-jot.git /tmp/abyssal-jot
   cd /tmp/abyssal-jot && npm install && npm run build
   ```
3. 复制产物到插件目录（目录名必须是 `abyssal-jot`）：
   ```bash
   mkdir -p "<VAULT>/.obsidian/plugins/abyssal-jot"
   cp main.js manifest.json styles.css "<VAULT>/.obsidian/plugins/abyssal-jot/"
   ```
4. 启用插件：读取 `<VAULT>/.obsidian/community-plugins.json`（不存在视为 `[]`），数组中没有 `"abyssal-jot"` 就追加并写回，保留已有条目。不要改动 vault 中的其他文件。
5. 提示用户重启 Obsidian（若开着安全模式，到「设置 → 第三方插件」关闭），然后点左侧栏波浪图标或在命令面板运行「打开潜思」。

## 开发

```bash
npm run dev    # 监听构建
npm run build  # 类型检查 + 生产构建
```

## License

MIT
