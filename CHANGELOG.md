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

## [2.0.0] - 2026-08-18

### 新增

- 新增“AI 推荐”标签：使用当前论文的完整 MinerU Markdown 与已有非空 Abstract 的 References / Citations，一次生成完整“优先看 / 可选看”阅读建议；模型每形成一条完整建议就立即显示，并更新“已生成 X / Y 篇”。完整结果按当前论文写入 `recommendation.json`，身份未变化时直接从本地恢复。对应 [Issue #57](https://github.com/Woif-sha/reference-for-zotro/issues/57)、[Issue #58](https://github.com/Woif-sha/reference-for-zotro/issues/58) 和 [PR #66](https://github.com/Woif-sha/reference-for-zotro/pull/66)。
- Preferences 新增推荐模型服务商卡片、活动模型选择和连接测试，支持 Codex Auth 与 HTTPS OpenAI Compatible；配置由本插件独立保存，不读取 Paper Translate 的模型设置。对应 [Issue #56](https://github.com/Woif-sha/reference-for-zotro/issues/56)。
- 打开相关论文区域后自动加载前 10 篇 Citations，并在后台依次补全 References 与已加载 Citations 的缺失摘要；OpenAlex 与 Semantic Scholar 摘要写入当前论文缓存目录的 `abstract.json`，再次打开时直接恢复。对应 [PR #63](https://github.com/Woif-sha/reference-for-zotro/pull/63)。
- Preferences 新增可选 OpenAlex API Key、免费获取入口和连接测试；连接成功后显示当日剩余可用余额。对应 [PR #64](https://github.com/Woif-sha/reference-for-zotro/pull/64)。
- 支持在 PDF 正文中对数字引用执行 `Ctrl + 右键`，自动展开相关论文区域、切换到 References 并定位高亮对应条目。对应 [PR #59](https://github.com/Woif-sha/reference-for-zotro/pull/59)。
- Reader“相关论文”标题栏新增设置快捷按钮，可直接打开插件 Preferences。对应 [PR #62](https://github.com/Woif-sha/reference-for-zotro/pull/62)。

### 调整

- AI 推荐论文复用 References / Citations 的普通左键详情、`Ctrl + 左键`落地页、右键菜单和划词翻译交互，并显示发表年份、分析数量和更清晰的标题层级。对应 [PR #66](https://github.com/Woif-sha/reference-for-zotro/pull/66)。
- 下载目录和 ScanSci Cache 路径改为分别通过原生目录选择器显式配置；未配置时显示简洁状态并阻止下载，不再使用隐式默认目录。对应 [PR #61](https://github.com/Woif-sha/reference-for-zotro/pull/61)。
- 推荐模型配置与固定版 Paper Translate 的 provider card 交互保持一致，同时保留本插件独立的配置、任务取消和传输边界。对应 [PR #61](https://github.com/Woif-sha/reference-for-zotro/pull/61)。
- 蓝色、斜体并带蓝色下划线的论文题名表示摘要已就绪；普通蓝色题名表示摘要仍在补全。对应 [PR #65](https://github.com/Woif-sha/reference-for-zotro/pull/65)。

### 修复

- 修复 OpenAlex 等来源的 Abstract 中 `\\times`、`\\sim`、`{\\rm ...}` 和 LaTeX 空格原样显示的问题。对应 [PR #60](https://github.com/Woif-sha/reference-for-zotro/pull/60)。
- 修复模型流缺少完成标记、响应被截断、输出过大或当前论文已变化时，推荐仍可能进入 UI 的问题；所有完整结果继续执行严格 schema、候选覆盖和理由长度校验。
- 修复 Codex 流把大型非文本响应事件错误计入 128 KiB 文本预算，导致分析在有效输出前失败的问题。
- 修复流式推荐与论文详情交互整合后，中间状态缺少论文集合而无法渲染的问题。
- 修复 OpenAlex Key 密码框出现重复显隐按钮的问题，只保留单一原生控制。
- 修复 Reader 设置图标尺寸过大和 Preferences 目录选择窗口退到主论文窗口之后的问题。对应 [PR #61](https://github.com/Woif-sha/reference-for-zotro/pull/61) 和 [PR #62](https://github.com/Woif-sha/reference-for-zotro/pull/62)。

### 安全

- Codex 推荐使用严格 JSON Schema，OpenAI Compatible 使用 JSON object mode；不支持结构化输出时显式失败，不降级为自由文本或自动切换服务商。
- 模型 API Key、Codex access / refresh token 和本地 `auth.json` 路径不进入模型身份、用户可见错误、推荐缓存或日志；OpenAI Compatible API Base 只接受 HTTPS。
- OpenAlex 摘要查询通过 `Authorization: Bearer` 请求头发送 API Key；仅在用户主动测试连接时按官方接口要求把 Key 作为查询参数发送给 `/rate-limit`，Key 不进入日志、诊断或摘要缓存。对应 [PR #64](https://github.com/Woif-sha/reference-for-zotro/pull/64)。
- ScanSci 下载继续强制 legal-only，当前只启用 arXiv 与 PMC；机构浏览器路由保持禁用，插件不创建 Python 环境、不安装依赖或修改全局 pip 配置。

### 工程

- 为推荐模型双传输、严格输出、缓存身份、流式进度、Reader 交互、摘要持久化、OpenAlex 连接测试和路径配置增加回归覆盖。
- 统一研究与原型的远端分支工作流，并保持构建后的 XPI 内容审计和确定性重打包。
- 完整功能、配置和 PR 说明见 [2.0.0 发布说明](https://github.com/Woif-sha/reference-for-zotro/blob/v2.0.0/docs/releases/2.0.0.md)。

## [1.1.4] - 2026-08-15

### 新增

- 暂无。

### 调整

- 暂无。

### 修复

- 修复 Reader 中已有文本选区时，第一次普通左键点击另一篇论文无反应的问题；新点击会取消旧选区并正常打开论文详情，同时保留右键、`Ctrl + 左键`和重新划词行为。

### 安全

- 暂无。

### 工程

- 增加旧文本选区后的论文点击回归测试，并验证重新划词不会误触论文操作。

## [1.1.3] - 2026-08-14

### 新增

- 暂无。

### 调整

- 未找到论文落地页的 Reference 支持左键打开详情，展示规范化后的 Canonical Reference text，并保留其中可点击的 HTTP(S) 链接。

### 修复

- 修复 Canonical Reference 规范化改造误删未解析条目详情展示的问题，同时使旧缓存按新投影版本失效。
- 修复 MinerU 间距型附加符号经 NFKC 展开后遗留孤立组合符的问题；普通词间保留空格，连字符处重新连接，并保留附着于字母的合法重音。

### 安全

- 暂无。

### 工程

- 增加未解析 Reference 详情、Canonical Reference 投影、缓存失效、真实异常条目、常见间距型附加符号和合法重音的回归测试。

## [1.1.2] - 2026-08-14

### 新增

- 暂无。

### 调整

- 详情卡继续显示在 Reader 顶层，并明确区分卡内交互与卡外关闭：卡内划词、翻译和点击保持详情打开，点击插件列表或论文页面关闭详情。

### 修复

- 修复详情卡内划词后，鼠标事件冒泡到文档级关闭监听而导致详情立即消失的问题。
- 修复只监听 Reader 外壳、未监听实际论文 iframe，导致点击原始论文页面无法关闭详情的问题；主论文视图和分屏论文视图均已覆盖。

### 安全

- 暂无。

### 工程

- Reader 交互回归测试改为经过生产文档映射，覆盖详情内划词、插件页外部点击、主论文视图和分屏论文视图。

## [1.1.1] - 2026-08-13

### 新增

- 为每篇论文建立独立的永久本地检索缓存，保存 References、Citations 及可访问的论文落地页 URL。

### 调整

- 缓存改为 `v2/papers/{libraryID}-{attachmentKey}` 下的 `manifest.json`、`references.json` 与 `citations.json`；相同论文再次打开时直接读取本地结果，仅在来源指纹或检索版本变化、缓存缺失或用户手动刷新时重新检索。

### 修复

- 修复缓存按一小时或二十四小时过期而导致重复检索的问题，并保存 Citations 的 10、30、50 条已加载上限以便继续增量查询。

### 安全

- 永久缓存不写入 Abstract、网页 HTML、Cookie 或访问令牌，仅保留书目信息、稳定标识、检索来源与落地页 URL。

### 工程

- 三个缓存文件使用同一修订标识和暂存写入；同一论文的并发读取等待当前写入完成，并以自动化测试覆盖身份失效、摘要剔除和中断写入。

## [1.1.0] - 2026-08-13

### 新增

- 在 Zotero 9 Reader 中提供 References 与 Citations 浏览、论文详情卡片、可信学术落地页跳转和按需摘要补全。
- 增加共享 MinerU Reference 规范化：首次读取时统一参考文献编号、断行、转义字符和 URL，并同步回写唯一的 `full.md`、`content_list.json` 与 `manifest.json`，供其他插件复用。
- 引入论文保存目录、ScanSci sidecar 协议和 legal-only 来源链路的基础实现；机构认证与端到端论文下载尚未配置完成，将在后续版本继续迭代。

### 调整

- 使用 DOI、题名、作者、年份、期刊或会议等证据排序候选结果，并区分已解析、匹配中、无精确结果和不可下载状态。
- 恢复正式插件名称、ID 和稳定更新地址，由 `1.1.0-beta.1` 测试包升级为 `1.1.0` 正式版本。

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
[1.1.0]: https://github.com/Woif-sha/reference-for-zotro/releases/tag/v1.1.0
[1.1.1]: https://github.com/Woif-sha/reference-for-zotro/releases/tag/v1.1.1
[1.1.2]: https://github.com/Woif-sha/reference-for-zotro/releases/tag/v1.1.2
[1.1.3]: https://github.com/Woif-sha/reference-for-zotro/releases/tag/v1.1.3
[1.1.4]: https://github.com/Woif-sha/reference-for-zotro/releases/tag/v1.1.4
[2.0.0]: https://github.com/Woif-sha/reference-for-zotro/releases/tag/v2.0.0
