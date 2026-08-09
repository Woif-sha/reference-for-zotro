# 第二阶段测试 XPI 验收说明

本说明只适用于 `Reference for Zotero (Second-stage Test)` 1.1.0-beta.1。该 XPI 使用正式插件 ID 覆盖安装，但没有自动更新地址，也不对应 Git tag 或 GitHub Release。

## 安装前

- Zotero 版本为 9.0.6–9.0.x。
- 当前论文附件已有 `llm-for-zotero` 生成且可验证的 MinerU Markdown。
- UI 划词翻译验收需要 Paper Translate 1.4.1，并确认其自身翻译配置可用。
- 不要向插件、Issue、日志或验收记录提供账号、密码、验证码、cookie、token 或 browser profile。

## 首次使用

1. 运行 `npm ci`、`npm test`、`npm run build` 和 `npm run audit:scansci-xpi`，安装 `build/reference-for-zotero-second-stage-test.xpi` 后完全重启 Zotero。
2. 打开真实论文 PDF，在 Reader 的 Related Papers 区域确认 References/Citations 与第一阶段详情功能仍正常。
3. Download destination 默认是 `E:\paper`。使用 Change folder 可调用原生目录选择器；Reset 恢复默认目录，不会出现独立设置页。
4. Check environment 只探测 Python 3.11+ 和精确锁定依赖。若依赖已满足则直接 Ready；否则先显示解释器、插件私有 venv、清华镜像、完整包版本/hash、动作与取消结果。
5. 只有确认安装后才允许创建私有 venv，并固定执行清华镜像与 `--require-hashes` 安装；取消不得写环境，失败不得切换镜像、修改基础 Python 或写全局 `pip.ini`。

## Reader 与文件下载

1. 在 References 和 Citations 中只选择身份已确认的论文；unresolved/ambiguous 行必须不可选。
2. 在列表题名、元数据和详情 Abstract 中划词，确认 Paper Translate 返回的译文锚定当前选区；状态、错误、路径和控件文字不得进入翻译请求。
3. 下载一篇具有 arXiv 或 PMC 合法来源的论文，确认 UI 只显示 downloaded 或 failed；成功路径必须是 Download destination 根部的 Windows-safe canonical title 文件名。
4. 确认 `ScanSciCache` 根目录保留但本次 request 目录已清理，自动文件名、索引和中间文件没有进入 Download destination 根部。
5. 再次下载同名目标，确认失败且原文件未覆盖、未自动改名；失败不得自动重试、换 Python、换目录或放宽来源。
6. 改用一个新的自定义目录重复合法下载，并通过 Open folder 打开实际保存位置。
7. 验收前后比较 Zotero 条目、附件、collection 与 full-text index；下载不得创建或修改这些对象。

## 机构 acceptance-candidate

机构路线目前仍为 disabled，不能把 open-access smoke 冒充为机构下载。开始实现首条 test-only route 前，验收人必须提供：

- 实际可登录的机构名称；
- 目标 publisher 名称；
- 一篇当前机构订阅确实允许下载的论文 landing-page URL；
- 用户通常进入机构登录的公开入口 URL，以及是否需要 WebVPN、统一身份认证或 MFA；
- 允许进行测试的访问条款或机构说明链接。

实现后还必须单独展示并确认浏览器 runtime 的 vendor、固定下载 URL、约 200 MiB 大小、binary license、插件私有目标目录和签名校验。只有用户主动点击后才能启动可见浏览器；插件不得读取、保存或记录登录凭据及会话内容。

机构路线只有在 strict-TLS、完整 egress host allowlist、source evidence、Windows/Zotero 9 visible login 和合法单篇下载均通过后，才可在这一个测试 XPI 的 source-rules v3 中标记 enabled。
