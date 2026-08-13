# Changelog

All notable changes to Reference for Zotero are documented in this file.

## 未发布

### 新增

- 暂无。

### 调整

- 暂无。

### 修复

- 暂无。

### 安全

- 暂无。

### 工程

- 暂无。

## [1.2.0] - 2026-08-13

### 新增

- 在 Zotero 9 Reader 中提供 References 与 Citations 浏览、论文详情卡片、可信学术落地页跳转和按需摘要补全。
- 增加共享 MinerU Reference 规范化：首次读取时统一参考文献编号、断行、转义字符和 URL，并同步回写唯一的 `full.md`、`content_list.json` 与 `manifest.json`，供其他插件复用。
- 引入论文保存目录、ScanSci sidecar 协议和 legal-only 来源链路的基础实现；机构认证与端到端论文下载尚未配置完成，将在后续版本继续迭代。

### 调整

- 使用 DOI、题名、作者、年份、期刊或会议等证据排序候选结果，并区分已解析、匹配中、无精确结果和不可下载状态。
- 恢复正式插件名称、ID 和稳定更新地址，由 `1.1.0-beta.1` 测试包升级为 `1.2.0` 正式版本。

### 修复

- 修复长参考文献截断、MinerU 多块 Reference 合并、缺失单个标号时的条目恢复，以及 Reader 切换论文后的界面和交互状态。
- 修复详情卡关闭、右键菜单、选择翻译定位、Windows 下载路径校验和 XPI 审计在不同平台上的一致性问题。

### 安全

- 下载基础链路限制为已审计来源、严格 TLS 和插件自有 sidecar 协议；拒绝身份冲突、越界路径和不兼容运行时，不静默安装依赖或切换环境。
- 机构浏览器认证候选在真实环境验收前保持禁用，不读取用户凭据、浏览器会话或机构配置。

### 工程

- 增加 TypeScript、Python、sidecar 合约、Reader 生命周期、MinerU 缓存和 XPI 内容审计，并纳入统一发布校验。

## [1.1.0-beta.1] - 2026-08-09

### Test build

- Integrated References/Citations selection, audited legal-only single/batch downloads through the versioned plugin-owned sidecar, and the Zotero 9-validated Paper Translate UI flow.
- Removed Reader-owned Python selection, private-environment installation, dependency installation and institution configuration; compatible runtimes are now discovered automatically and accepted only through sidecar `probe`.
- Marked the artifact as a second-stage test build, retained the update URL required by Zotero's bootstrap-addon manifest validation, and published no update metadata, tag or release.
- Added an isolated real-Zotero installability check for the generated XPI.
- Kept the institution-browser route disabled until a user-provided institution and publisher acceptance candidate completes strict-TLS, source, egress and installed-Zotero validation.

## [1.0.1] - 2026-08-03

### Fixed

- Reconstructed complete Crossref paper titles from separate `title` and `subtitle` metadata fields.
- Removed encoded inline emphasis markup from Crossref title segments before matching and display.
- Invalidated cached provider queries so references previously rejected because of missing subtitles are resolved again.

## [1.0.0] - 2026-08-02

### Highlights

- Added a Zotero 9 Reader section with References and Citations views.
- Preserved Reference entry order from validated MinerU Markdown.
- Added conservative multi-provider resolution using DOI, trusted scholarly URLs, bibliographic metadata, Crossref and DataCite.
- Added cumulative Citing papers retrieval through OpenCitations with 10, 30 and 50 result limits.
- Added anchored paper detail cards with citation counts, reference counts, DOI, author, venue, year and Abstract fields.
- Added on-demand Abstract enrichment through OpenAlex with Semantic Scholar fallback and exact DOI verification.
- Added optional selection translation through the public Paper Translate API.

### Correctness and safety

- Restricted browser opening to confirmed, reachable scholarly landing pages.
- Isolated asynchronous work and cache writes by Reader paper generation.
- Versioned persistent caches by attachment identity, MinerU fingerprint, provider schema and query version.
- Prevented stale responses and aborted writes from replacing current paper state.
- Added XHTML/XUL-safe Reader rendering for Zotero 9.
- Fixed long bibliography entries such as ACL Anthology references so only the paper title appears in the list while authors, venue, year, DOI and Abstract remain available as metadata.
- Removed provider provenance rows from the user-facing paper list and detail card.

### Compatibility and validation

- Supports Zotero `9.0.6` through `9.0.x`.
- Requires valid MinerU Markdown generated for the current attachment by the user's `llm-for-zotero` workflow.
- Validated with 106 automated tests, TypeScript checks, ESLint, Prettier, production XPI builds and installed-XPI testing in Zotero 9.

[1.0.1]: https://github.com/Woif-sha/reference-for-zotro/releases/tag/v1.0.1
[1.0.0]: https://github.com/Woif-sha/reference-for-zotro/releases/tag/v1.0.0
[1.2.0]: https://github.com/Woif-sha/reference-for-zotro/releases/tag/v1.2.0
