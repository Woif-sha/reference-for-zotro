# Reference for Zotero

> 当前分支生成 `1.1.0-beta.1` 第二阶段测试构建，仅用于 Zotero 9 实机验收；不对应 Git tag、GitHub Release 或自动更新渠道。

Reference for Zotero 是面向 Zotero 9 Reader 的相关文献插件。它从当前论文已有的 MinerU Markdown 中读取参考文献，并在 Reader 侧栏中提供文献解析、反向引用、详情卡片与可信落地页跳转。

Reference for Zotero is a Zotero 9 Reader extension for exploring resolved references and citing papers without leaving the reading workflow.

## 功能

- 按原始顺序显示 MinerU Markdown 中的 References。
- 使用 DOI、可信学术 URL、题名、作者和年份解析文献身份。
- 显示 Citing papers，并支持 10、30、50 条累计加载。
- 在所选论文旁显示详情卡片；卡片随论文位置移动并在视口边缘自动约束。
- 显示题名、作者、期刊或会议、年份、DOI、引用数、参考文献数与摘要。
- 摘要缺失时仅在打开详情卡后按 DOI 延迟补全，避免批量请求。
- `Ctrl + 左键` 打开经过确认的论文落地页。
- 可选调用 Paper Translate 的公开接口翻译插件界面内选中的文字。
- 在 Reader 下载区域显示当前保存目录；默认使用 `E:\paper`，也可通过 Windows 原生目录选择器修改或恢复默认值。
- 启动及每次下载前自动探测已有 Python 3.11+ 兼容运行时，并只通过插件自有 sidecar 的版本化 `probe` 建立下载能力；插件不会创建、安装或切换 Python 环境。

## 运行要求

- Zotero `9.0.6` 至 `9.0.x`。
- 当前 Reader 附件已经由 `llm-for-zotero` MinerU 工作流生成有效 Markdown。
- 联网元数据功能需要能够访问 DOI、Crossref、DataCite、OpenCitations、OpenAlex 和 Semantic Scholar。

本插件不会上传当前 PDF。外部请求包含解析文献所需的题名、作者、年份或 DOI；详情见 [PRIVACY.md](PRIVACY.md)。

## 安装

1. 从本分支执行 `npm ci && npm run build`，使用生成的 `build/reference-for-zotero-second-stage-test.xpi`；不要把该测试构建发布为 GitHub Release。
2. 在 Zotero 中打开 **工具 → 插件**。
3. 选择 **Install Plugin From File / 从文件安装插件**，选择下载的 XPI。
4. 完全重启 Zotero。

后续稳定版可通过插件更新地址获取 `update.json`。也可以下载新 XPI 后按相同步骤覆盖安装。

第二阶段测试构建仅为通过 Zotero bootstrap 清单校验而保留 `update_url`；本任务不发布对应的更新元数据，因此不会自动进入稳定版或 beta 更新渠道。完整首次使用与验收步骤见 [第二阶段测试 XPI 验收说明](docs/testing/second-stage-xpi.md)。

## 使用

打开已生成 MinerU Markdown 的 PDF，展开 Reader 右侧的 **相关论文 / Related Papers**：

- **References**：当前论文引用的文献。
- **Citations**：引用当前论文的文献。
- 单击已解析题名：打开论文详情卡。
- 再次单击题名或卡片关闭按钮：关闭详情卡。
- `Ctrl + 左键`：在浏览器打开已验证的学术落地页。
- **Refresh**：跳过当前缓存并重新解析。
- **Change folder**：选择 Download destination；插件不会创建独立设置页。
- ScanSci 能力由插件在后台自动探测。若 runtime、协议、schema、来源清单、legal-only policy 或 route capability 不兼容，下载会显示具体错误，不会尝试安装或 fallback。

WebVPN → IEEE Xplore 在真实审计完成前只是不可用的 acceptance candidate，不在 Reader 中显示为支持项，也不会启动浏览器或读取 profile、凭据与会话数据。

## 数据与匹配

- Reference entries 只读取当前附件经过身份校验的 MinerU Markdown，不扫描其他附件或旧缓存。
- Crossref 与 DataCite 用于注册元数据和候选匹配。
- OpenCitations 用于 Citing papers。
- ACL Anthology 等可信页面的标准 citation metadata 可用于补全作者、会议、年份、DOI 和摘要。
- OpenAlex 与 Semantic Scholar 仅在用户打开缺少摘要的 DOI 论文详情时请求摘要，并验证返回 DOI 与目标完全一致。
- 只有已确认身份且落地页可达的结果才能通过 `Ctrl + 左键` 打开。

## 故障排查

- **显示 No MinerU Markdown**：先在 `llm-for-zotero` 中为当前附件生成 Markdown，再刷新本节。
- **文献长期处于 Unresolved**：检查引用文本是否包含可识别题名、作者、年份、DOI 或可信学术 URL。
- **摘要不可用**：详情卡会显示具体 provider 错误；可稍后重新打开卡片重试。
- **安装新版本后界面未变化**：完全退出所有 Zotero 进程，再重新打开。

报告问题时请附上 Zotero 版本、插件版本、可见错误文本、当前论文状态和复现步骤：[GitHub Issues](https://github.com/Woif-sha/reference-for-zotro/issues)。

## 开发与验证

```powershell
npm ci
npm test
npm run lint
npm run typecheck
npm run format:check
npm run build
```

生成的 XPI 位于 `build/reference-for-zotero.xpi`。贡献约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

Copyright © 2026 Woif-sha and contributors. Licensed under [AGPL-3.0-or-later](LICENSE).
