# Reference for Zotero

Reference for Zotero 是面向 Zotero 9 Reader 的相关文献插件。它从当前论文已有的 MinerU Markdown 中读取参考文献，并在 Reader 侧栏中提供文献解析、反向引用、详情卡片与可信落地页跳转。

Reference for Zotero is a Zotero 9 Reader extension for exploring resolved references and citing papers without leaving the reading workflow.

## 功能

- 按原始顺序显示 MinerU Markdown 中的 References。
- 使用 DOI、可信学术 URL、题名、作者和年份解析文献身份。
- 显示 Citing papers，并支持 10、30、50 条累计加载。
- 在所选论文旁显示详情卡片；卡片随论文位置移动并在视口边缘自动约束。
- 显示题名、作者、期刊或会议、年份、DOI、引用数、参考文献数与摘要。
- 摘要缺失时仅在打开详情卡后按 DOI 延迟补全，避免批量请求。
- `Ctrl + 左键` 打开经过确认的论文落地页；未解析、存在歧义或落地页不可达时，仅保留论文题名并用该题名打开 Google 搜索。
- 可选调用 Paper Translate 的公开接口翻译插件界面内选中的文字。

## 运行要求

- Zotero `9.0.6` 至 `9.0.x`。
- 当前 Reader 附件已经由 `llm-for-zotero` MinerU 工作流生成有效 Markdown。
- 联网元数据功能需要能够访问 DOI、Crossref、DataCite、OpenCitations、OpenAlex 和 Semantic Scholar。

本插件不会上传当前 PDF。外部请求包含解析文献所需的题名、作者、年份或 DOI；详情见 [PRIVACY.md](PRIVACY.md)。

## 安装

1. 从 [GitHub Releases](https://github.com/Woif-sha/reference-for-zotro/releases/latest) 下载 `reference-for-zotero.xpi`。
2. 在 Zotero 中打开 **工具 → 插件**。
3. 选择 **Install Plugin From File / 从文件安装插件**，选择下载的 XPI。
4. 完全重启 Zotero。

后续稳定版可通过插件更新地址获取 `update.json`。也可以下载新 XPI 后按相同步骤覆盖安装。

## 使用

打开已生成 MinerU Markdown 的 PDF，展开 Reader 右侧的 **相关论文 / Related Papers**：

- **References**：当前论文引用的文献。
- **Citations**：引用当前论文的文献。
- 单击已解析题名：打开论文详情卡。
- 再次单击题名或卡片关闭按钮：关闭详情卡。
- `Ctrl + 左键`：已解析论文打开经过验证的学术落地页；无法确认时直接搜索当前显示的论文题名。
- **Refresh**：跳过当前缓存并重新解析。

## 数据与匹配

- Reference entries 只读取当前附件经过身份校验的 MinerU Markdown，不扫描其他附件或旧缓存。
- Crossref 与 DataCite 用于注册元数据和候选匹配。
- OpenCitations 用于 Citing papers。
- ACL Anthology 等可信页面的标准 citation metadata 可用于补全作者、会议、年份、DOI 和摘要。
- OpenAlex 与 Semantic Scholar 仅在用户打开缺少摘要的 DOI 论文详情时请求摘要，并验证返回 DOI 与目标完全一致。
- 同一引用出现多个候选时，只有作者、年份和题名相互一致且能够提供原论文的最优落地页才会成为主结果。
- 未解析、候选歧义或落地页不可达的条目不展示未经确认的元数据，只保留论文题名；`Ctrl + 左键` 会打开 Google 题名搜索。

## 故障排查

- **显示 No MinerU Markdown**：先在 `llm-for-zotero` 中为当前附件生成 Markdown，再刷新本节。
- **文献长期处于 Unresolved**：检查引用文本是否包含可识别题名、作者、年份、DOI 或可信学术 URL。
- **摘要不可用**：详情卡会显示具体 provider 错误；可稍后重新打开卡片重试。
- **安装新版本后界面未变化**：完全退出所有 Zotero 进程，再重新打开。

报告问题时请附上 Zotero 版本、插件版本、可见错误文本、当前论文状态和复现步骤：[GitHub Issues](https://github.com/Woif-sha/reference-for-zotro/issues)。

## 开发与验证

```powershell
npm ci
npm run typecheck
npm run build
```

稳定版 `main` 仅保留发布所需的核心源码、构建配置和相关文档；测试与界面原型不随发布源码上传。生成的 XPI 位于 `build/reference-for-zotero.xpi`。贡献约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

Copyright © 2026 Woif-sha and contributors. Licensed under [AGPL-3.0-or-later](LICENSE).
