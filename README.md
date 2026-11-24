# 潜思 Abyssal Jot

深海沉浸式随手记 Obsidian 插件：像素水母与鲨鱼在身后游动，一句话也值得留下。

- 仅支持桌面端，Obsidian ≥ 1.12.0
- 打开方式：左侧栏波浪图标，或命令面板执行「打开潜思」

## 安装（给 AI agent 的说明）

> 把下面这段直接发给你的 coding agent（Claude Code / Codex 等）即可。

```text
请帮我安装 Obsidian 插件「潜思 Abyssal Jot」：

1. 问我 Obsidian vault 的绝对路径，记为 <VAULT>（该目录下应有 .obsidian 文件夹）。
2. 克隆并构建（需要 Node.js 18+ 和 git）：
   git clone https://github.com/DomenCai/abyssal-jot.git /tmp/abyssal-jot
   cd /tmp/abyssal-jot && npm install && npm run build
3. 复制产物到插件目录（目录名必须是 abyssal-jot）：
   mkdir -p "<VAULT>/.obsidian/plugins/abyssal-jot"
   cp main.js manifest.json styles.css "<VAULT>/.obsidian/plugins/abyssal-jot/"
4. 启用插件：读取 "<VAULT>/.obsidian/community-plugins.json"（不存在则视为 []），
   若数组中没有 "abyssal-jot" 就追加进去并写回，保留其他已有条目。
5. 告诉我：重启 Obsidian（或在「设置 → 第三方插件」中关闭安全模式并刷新），
   然后点击左侧栏波浪图标或在命令面板运行「打开潜思」。

注意：不要修改 vault 中的其他文件；main.js 是构建产物，不在仓库里，必须先 npm run build。
```

## 手动安装

```bash
git clone https://github.com/DomenCai/abyssal-jot.git
cd abyssal-jot
npm install && npm run build
```

把 `main.js`、`manifest.json`、`styles.css` 复制到 `<你的 vault>/.obsidian/plugins/abyssal-jot/`，然后在 Obsidian「设置 → 第三方插件」中启用「潜思 Abyssal Jot」。

## 开发

```bash
npm run dev    # 监听构建
npm run build  # 类型检查 + 生产构建
```

## License

MIT
