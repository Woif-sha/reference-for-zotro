# Reference for Zotero

Reference for Zotero 是一个 Zotero 9 Reader 插件。它把论文末尾的参考文献列表变成可以浏览、核验和继续追踪的论文关系入口，让读者留在 Zotero 里就能看清“这篇论文引用了谁”以及“后来谁引用了它”。

> Reference for Zotero is a Zotero 9 Reader extension for exploring references and citing papers without leaving the reading workflow.

## 为什么需要它

阅读论文时，参考文献通常只是 PDF 末尾的一段文本。想了解其中一篇论文，往往要复制题名、打开浏览器、搜索、辨认结果，再回到 Zotero 继续阅读。这个过程会频繁打断思路，而且搜索结果未必就是原文引用的那一篇。

Reference for Zotero 在 Reader 侧栏中补上了这层关系：它读取已有的 MinerU Markdown，识别每条 Reference 对应的论文，并把书目信息、摘要、引用关系和可信学术页面放回当前阅读上下文。

它主要解决这些问题：

- 参考文献只有纯文本，题名、作者、DOI 和发表信息散在同一条目里，不便查看。
- 参考文献列表只能告诉你当前论文引用了什么，却很难直接看到后来有哪些论文引用了它。
- 手动搜索需要反复切换窗口，同一篇论文还可能被重复检索。
- 仅凭相似题名容易打开错误结果，需要结合 DOI、作者、年份和来源共同核验。

## 功能

- 在 Zotero Reader 侧栏中按原始顺序展示当前论文的 References。
- 使用 DOI、可信学术 URL、题名、作者和年份解析论文身份；没有精确结果时保留规范化后的原始条目，方便人工判断。
- 打开相关论文区域后自动查询前 10 篇 Citations，并支持按 30、50 条继续加载。
- 点击论文题名打开详情卡，查看作者、期刊或会议、年份、DOI、引用数、参考文献数和摘要。
- References 与已加载 Citations 缺少摘要时，后台按 DOI 依次查询 OpenAlex 或 Semantic Scholar，无需逐篇打开详情卡。
- 使用 `Ctrl + 左键` 打开已核验的论文落地页；未解析条目会按题名转到 Google Scholar 搜索。
- 通过题名的右键菜单复制可用书目信息，或显式发起 Google 搜索。
- 为每篇论文保存独立的本地检索缓存，再次阅读时直接恢复 References、Citations、OpenAlex 摘要和落地页信息。
- 可选调用 Paper Translate 的公开接口，翻译插件界面中选中的文字。
- 规范化 MinerU Reference 的编号、断行、转义字符和 URL，并同步共享的 Markdown 数据，减少其他插件重复处理同一条目。

## 它如何工作

1. 插件读取当前 Reader 附件对应的 MinerU Markdown，不重新上传或解析 PDF。
2. Reference 条目经过规范化后，使用 DOI、Crossref、DataCite 和可信学术页面进行匹配。
3. 候选结果会比较标识符、题名、作者、年份和来源；只有身份得到确认的论文才会显示为已解析结果。
4. OpenCitations 提供 Citations；OpenAlex 和 Semantic Scholar 在后台依次补全已确认 DOI 的论文摘要。

Reference for Zotero 专注于阅读过程中的论文关系探索。它关心的是当前论文与相关研究之间的联系，以及每个匹配结果能否被可靠核验；Zotero 原有的文献管理方式不会因此改变。

## 运行要求

- Zotero `9.0.6` 至 `9.0.x`。
- 当前 Reader 附件已有由 `llm-for-zotero` MinerU 工作流生成的有效 Markdown。
- 联网元数据功能需要能够访问 DOI、Crossref、DataCite、OpenCitations、OpenAlex 和 Semantic Scholar。

插件不会上传当前 PDF。外部请求只包含解析文献所需的题名、作者、年份或 DOI；详情见 [PRIVACY.md](PRIVACY.md)。

## 安装

1. 前往 [Releases](https://github.com/Woif-sha/reference-for-zotro/releases/latest) 下载 `reference-for-zotero.xpi`。
2. 在 Zotero 中打开“工具 → 插件”。
3. 选择“Install Plugin From File / 从文件安装插件”，安装下载的 XPI。
4. 完全重启 Zotero。

也可以从 `dev` 分支构建：

```powershell
npm ci
npm run build
```

生成的插件位于 `build/reference-for-zotero.xpi`。

## 使用

打开已经生成 MinerU Markdown 的 PDF，然后展开 Reader 右侧的“相关论文 / Related Papers”：

- “References”显示当前论文引用的文献。
- “Citations”显示引用当前论文的文献；默认前 10 篇会自动加载，选择 30 或 50 时继续加载新增结果。
- 单击论文题名可以打开或关闭详情卡。
- `Ctrl + 左键`可以打开已核验的学术落地页；未解析条目会转到 Google Scholar 搜索。
- 右键单击题名可以复制书目信息或发起 Google 搜索。
- “Refresh”会跳过当前缓存，重新解析和查询。

## 数据与匹配原则

插件只读取当前附件经过身份校验的 MinerU Markdown，不扫描其他附件或旧缓存。Crossref 与 DataCite 用于注册元数据和候选匹配，OpenCitations 用于查询 Citations。ACL Anthology 等可信页面中的标准 citation metadata 也可用于补全论文信息。

匹配结果宁缺毋滥。题名相似但 DOI、作者或年份冲突的候选不会被当作同一篇论文。身份确认且页面可达时，`Ctrl + 左键`会直接打开论文落地页；未解析条目只会按题名发起 Google Scholar 搜索，不会被标记为已解析。完整的 Reference 规范化规则见 [MinerU Reference normalization](docs/mineru-reference-normalization.md)。

## 常见问题

### 显示 No MinerU Markdown

先在 `llm-for-zotero` 中为当前附件生成 MinerU Markdown，再刷新“相关论文”侧栏。

### 文献长期显示 Unresolved

这表示插件没有找到证据充分的精确结果。可以展开详情查看规范化后的原始 Reference，确认其中是否有题名、作者、年份、DOI 或可信学术 URL。

### 摘要不可用

后台补全失败不会影响已经解析出的书目信息。详情卡会保留具体的服务错误；刷新或下次打开论文时会重试未缓存的摘要。

### 安装新版本后界面没有变化

完全退出所有 Zotero 进程，再重新打开 Zotero。

报告问题时，请附上 Zotero 版本、插件版本、可见错误文本和复现步骤：[GitHub Issues](https://github.com/Woif-sha/reference-for-zotro/issues)。

## 开发与贡献

```powershell
npm ci
npm run verify
git diff --check
```

贡献约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

Copyright © 2026 Woif-sha and contributors. Licensed under [AGPL-3.0-or-later](LICENSE).
