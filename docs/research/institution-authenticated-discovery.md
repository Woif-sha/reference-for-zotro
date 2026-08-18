# 机构认证下的论文匹配与 Citations 数据链路

研究日期：2026-07-29\
对应问题：[确定机构认证下的论文匹配与 Citations 数据链路](https://github.com/Woif-sha/reference-for-zotro/issues/4)

## 结论

在“不采用通用学术 API/API Key，只使用 IEEE、ACM 等出版商的机构认证”的约束下：

1. **Reference entry 的确定性落地页跳转可行，但自动在线匹配只对原始引文中已有稳定标识符的条目成立。** 本地提取 DOI、arXiv ID 或 IEEE article number 后，可以直接生成 DOI、arXiv 或 IEEE Xplore 落地页；只含题名/作者的条目，不能在不调用 API、也不自动抓取搜索页面的前提下可靠确认匹配。
2. **自动获取并在插件内展示 Citing papers 的 10/30/50 条列表不可作为合规首发能力。** IEEE Xplore 的文章页面确实提供 “Cites in Papers” 列表，但 IEEE 明确禁止使用 robots 或 intelligent agents 访问、搜索或系统化下载站内内容；ACM 也明确禁止 robots 或 intelligent agents，并可能暂停订阅或封禁机构 IP。机构认证只解决“用户是否有权访问”，不赋予插件自动抓取、重排和缓存页面数据的权利。
3. **`scansci-pdf` 不能直接提供所需 Citations 数据。** 它可借鉴的部分是可见浏览器中由用户完成 SSO、保持同一浏览器上下文，以及持久化 profile/cookie/localStorage 的会话思路；其 citation 模块实际是 Crossref 元数据到 BibTeX/RIS/EndNote 的导出，其 search 模块明确使用 OpenAlex、Semantic Scholar 和 Crossref，均违反本票据“不采用通用学术 API”的约束。
4. **首发推荐方案必须明确缩小能力边界。** References 页先做“本地标识符识别 + 直接落地页”；未识别条目显示未匹配，Ctrl+单击仅由用户主动打开 Google 搜索。Citations 页在未取得出版商书面许可或正式许可接口前，只能提供“在默认浏览器打开该论文的 IEEE/ACM Citations 页面”入口，不能在 Zotero 侧自动抽取、缓存或声称已获得 10/30/50 条结果。

这不是技术上的“暂时没找到选择器”，而是当前约束与出版商明示政策之间的冲突。不得用隐藏接口、DOM 抓取、cookie 重放或无头浏览器把冲突包装成成功。

## 一、`scansci-pdf` 实际提供了什么

以下结论基于 `Rimagination/scansci-pdf` 的固定提交 [`5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5`](https://github.com/Rimagination/scansci-pdf/tree/5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5)。

### 1.1 可复用的机构会话模式

`scansci-pdf` 的 `PersistentBrowser` 明确采用以下模式：

- 启动可见的 CloakBrowser；
- 登录一次后保持同一 browser/context/page 活跃，以维持 WebVPN 会话；
- 重启后尝试恢复 cookie 和 localStorage；
- 将浏览器状态写入本地 JSON/Netscape cookie 文件。

源码证据：

- [`browser_login.py` 第 22–67 行](https://github.com/Rimagination/scansci-pdf/blob/5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5/src/scansci_pdf/browser_login.py#L22-L67)
- [`browser_login.py` 第 69–150 行](https://github.com/Rimagination/scansci-pdf/blob/5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5/src/scansci_pdf/browser_login.py#L69-L150)
- [`browser_cookies.py` 第 285–334 行](https://github.com/Rimagination/scansci-pdf/blob/5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5/src/scansci_pdf/browser_cookies.py#L285-L334)

其出版商目录对 IEEE 和 ACM 都建议使用 persistent browser profile；IEEE 条目还记录了 “IEEE Xplore 页面内 Institutional Sign In → Access Through Your Institution → OpenAthens/机构 SSO → 返回文章页” 的交互链路，并警告直接打开 WAYF servlet 会丢失 SeamlessAccess 上下文：

- [IEEE 配置，第 423–462 行](https://github.com/Rimagination/scansci-pdf/blob/5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5/src/scansci_pdf/data/publisher_access_catalog.json#L423-L462)
- [ACM 配置，第 153–191 行](https://github.com/Rimagination/scansci-pdf/blob/5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5/src/scansci_pdf/data/publisher_access_catalog.json#L153-L191)

IEEE 官方说明与上述流程一致：IEEE Xplore 的 Institutional Sign In 使用 SeamlessAccess，用户选择机构后跳转到机构登录页面；机构选择保存在浏览器 local storage 中，但登录信息、邮箱或个人信息不由 SeamlessAccess 保存。[IEEE Xplore Institutional Sign In](https://ieeexplore.ieee.org/Xplorehelp/authentication-and-access/institutional-sign-in)

ACM 官方用户指南给出的机构访问方式包括 IP 认证、Shibboleth/Federated access 和机构 IdP SSO；其中 federated access 使用机构凭据完成单点登录。[ACM Digital Library User Guide](https://libraries.acm.org/binaries/content/assets/libraries/acm-digital-library-user-guide.pdf)

### 1.2 不能复用为 Citations 数据源

`scansci-pdf` 名为 citation 的模块只通过 Crossref API 取 DOI 元数据并生成 BibTeX/RIS/EndNote，不查询“哪些论文引用当前论文”：

- [`citation.py` 第 1–22 行](https://github.com/Rimagination/scansci-pdf/blob/5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5/src/scansci_pdf/citation.py#L1-L22)

其搜索模块开头即声明使用 OpenAlex、Semantic Scholar 和 Crossref，并以并行请求合并结果：

- [`search.py` 第 1–50 行](https://github.com/Rimagination/scansci-pdf/blob/5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5/src/scansci_pdf/search.py#L1-L50)

因此，对当前项目只能借鉴会话生命周期设计，不能把 `scansci-pdf` 描述成现成的机构认证 Citations 后端。

## 二、机构认证如何承载

### 2.1 出版商支持的认证形式

IEEE 官方支持：

- 机构 IP 自动识别；
- SAML；
- Shibboleth/OpenAthens/SeamlessAccess；
- 机构用户名密码（机构不使用上述联盟时）。

官方资料：

- [IEEE Xplore Institutional Sign In](https://ieeexplore.ieee.org/Xplorehelp/authentication-and-access/institutional-sign-in)
- [IEEE Xplore SAML Authentication](https://ieeexplore.ieee.org/Xplorehelp/authentication-and-access/saml-authentication)
- [IEEE Xplore Getting Started Guide](https://ieeexplore.ieee.org/Xplorehelp/administrators-and-librarians/getting-started-guide)

ACM 官方用户指南列出 IP、Shibboleth/Federated access 和 IdP SSO，并称 federated access 是学术机构的推荐方式。[ACM Digital Library User Guide](https://libraries.acm.org/binaries/content/assets/libraries/acm-digital-library-user-guide.pdf)

### 2.2 Zotero 9 内的可行承载边界

Zotero 插件具有平台内部访问能力，并可在窗口中操作 DOM；Zotero 7+ 插件使用 `manifest.json` 和 bootstrapped lifecycle。官方同时说明，旧的 `Zotero.Browser` 已迁移为 `HiddenBrowser.jsm`，未承诺一个与系统浏览器共享登录态的稳定插件 API。[Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers)

因此首发不应：

- 读取 Chrome/Edge/Firefox 的 cookie 数据库；
- 从 `scansci-pdf` 的 JSON/Netscape cookie 文件导入 IEEE/ACM 会话；
- 将机构密码、SAML assertion、2FA 结果或 session cookie 保存到插件自己的业务缓存；
- 假设 Zotero 内嵌浏览器与用户默认浏览器、CloakBrowser 或校园 VPN 自动共享 session。

可接受的边界是：

1. 插件用系统默认浏览器打开 DOI/出版社落地页；
2. 用户在浏览器里自行完成机构登录；
3. 插件不接触凭据和认证 token；
4. 只有未来确实需要内嵌页面，才在同一可见浏览器上下文中让用户手工登录，并把“关闭或过期即失效”作为显式状态；不能把 cookie 导出后重放视为完整会话。

这与 `scansci-pdf` 自身的政策文件一致：cookie store 只适合 HTTP preflight，完整状态还可能依赖浏览器 fingerprint、内存状态、WAF challenge、TLS/session 和页面生成 token。[`institutional_identity_policy.json`](https://github.com/Rimagination/scansci-pdf/blob/5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5/src/scansci_pdf/data/institutional_identity_policy.json)

## 三、Reference entry 到论文落地页

### 3.1 可确定匹配

Reference parser 只在本地处理 MinerU Markdown 中已经存在的信息，按如下顺序识别：

1. DOI：规范化 `doi:`、`https://doi.org/` 等形式，落地页为 `https://doi.org/<DOI>`；
2. arXiv ID：落地页为 `https://arxiv.org/abs/<ID>`；
3. IEEE article number：仅当原始文本或已有 URL 明确给出时，落地页为 `https://ieeexplore.ieee.org/document/<arnumber>`；
4. 原始引文中已有的 `https://dl.acm.org/doi/...`、IEEE Xplore 或其他出版社 URL。

这些规则不要求机构认证，也不需要自动读取出版商页面。机构认证只在用户打开落地页并访问订阅内容时生效。

可安全展示的字段：

- 原始 reference 文本；
- 本地解析到的 DOI/arXiv ID/article number；
- 确定生成的 canonical landing URL；
- 从原始引文自身解析到的题名、作者、年份、venue；
- `matched_by = doi | arxiv | ieee_article_number | source_url`；
- `match_status = deterministic`。

不能因为 DOI 跳转成功就推断订阅全文可用，也不能把最终 200 响应当作机构认证成功；落地页、登录页、购买页和 challenge 页都可能返回成功状态码。

### 3.2 题名型条目

只有题名/作者的条目，在当前约束下不得后台抓取 IEEE、ACM 或 Google 搜索结果来确认：

- 显示原始引文；
- 状态为 `unresolved_no_identifier`；
- 悬浮卡明确显示“未找到可验证的论文标识符”；
- Ctrl+单击由用户主动打开 Google 搜索 URL；
- 不把搜索结果第一条静默记为匹配。

若用户未来手工确认某个落地页，可单独记录 `matched_by = user_confirmed`，并保留确认时间和原始引文 hash；这不是首发自动匹配的替代品。

## 四、Citing papers 是否可获得

### 4.1 IEEE：页面上有，但自动抽取不被允许

IEEE Xplore 的文章 Citations 页面公开展示 “Cites in Papers”，并将 IEEE 与 Other Publishers 分开；条目包含作者、题名、venue、页码、年份以及 “Show Article/Google Scholar” 入口。示例：[IEEE Xplore Citations 页面](https://ieeexplore.ieee.org/abstract/document/10136722/citations?tabFilter=papers)。

这证明用户可以在网页中查看 citing papers，但不等于允许插件自动抽取。IEEE 官方 Legal Information 明确：

- 授权用户可以查看和搜索 IEEE Xplore；
- 不得使用 robots 或 intelligent agents 访问、搜索或系统下载 IEEE Xplore 的任何部分；
- 可疑活动可导致个人和订阅机构的服务被暂停，持续违规可取消订阅。

来源：[IEEE Xplore Legal Information / Bot Policy](https://ieeexplore.ieee.org/Xplorehelp/overview-of-ieee-xplore/legal-information)

IEEE 还明确把自动搜索导向其 API Portal，并要求申请 API key；这正是本票据排除的路径。[IEEE Xplore Getting Started Guide](https://ieeexplore.ieee.org/Xplorehelp/administrators-and-librarians/getting-started-guide)

### 4.2 ACM：认证可行，但自动抽取同样不被允许

ACM 的机构认证形式是明确的，但 ACM 的 End-user Policy 同样要求：

- 不使用 robots 或 intelligent agents；
- 系统化下载可能导致订阅暂停/取消；
- ACM 可封禁发起此类活动的 IP。

来源：[ACM DL End-user Policy](https://www.acm.org/publications/policies/usage-old)

ACM 页面当前还可能对非浏览器请求返回 Cloudflare/403；即使技术上用可见浏览器绕过，也不能把反爬绕过当成合规数据接口。

### 4.3 10/30/50 条与日期倒序

需求中的选择框可保留为未来获批数据源的 UI 规格：

- 可选值固定为 `10 | 30 | 50`；
- 默认 `10`；
- 排序键优先使用完整 `publication_date`，否则用 `publication_year`；
- 日期相同时使用稳定次序，例如规范化 DOI/落地 URL；
- 缺日期的记录置于有日期记录之后，并显式标记。

但在当前来源约束下，不能声称以下能力已实现或可验证：

- IEEE/ACM 页面支持稳定的 10/30/50 分页参数；
- Citations 页面提供稳定、公开、允许自动调用的 JSON 接口；
- 页面默认顺序永远等于日期倒序；
- “Other Publishers” 覆盖完整引用集合；
- ACM 与 IEEE 的 cited-by 集合可以无损合并、去重。

通过 DOM 或私有 XHR 逆向实现上述功能会同时带来选择器漂移、WAF/403、机构封禁和条款风险，因此不是首发方案。

## 五、字段、失败语义与缓存边界

### 5.1 建议内部字段

Reference match：

```text
referenceIndex
sourceText
sourceTextHash
parsedTitle?
parsedAuthors?
parsedYear?
identifierType?
identifierValue?
landingUrl?
matchedBy
matchStatus
checkedAt
failureCode?
```

未来合法的 Citation record（仅为接口边界，不代表当前已有来源）：

```text
title
authors[]
publicationDate?
publicationYear?
venue?
doi?
landingUrl
publisherScope
sourceUrl
retrievedAt
```

### 5.2 必须显式区分的失败

- `unresolved_no_identifier`：原始引文无可确定标识符；
- `invalid_identifier`：DOI/arXiv/article number 格式无效；
- `landing_redirect_failed`：用户打开时 DOI/URL 解析失败；
- `authentication_required`：落地页要求机构登录；
- `session_expired`：可见浏览器会话已过期；
- `publisher_challenge`：CAPTCHA、Cloudflare、WAF 或 403；
- `automation_not_permitted`：来源政策不允许插件自动抓取；
- `citation_source_unavailable`：没有获批的 Citations 数据源；
- `metadata_incomplete`：合法来源返回记录但缺少日期/落地页等必需字段。

禁止：

- 把空列表解释为“没有论文引用”；
- 把登录页或 challenge 页解释为“未找到论文”；
- IEEE 失败后静默抓 ACM、Google Scholar 或其他来源；
- 用缓存旧值掩盖当前认证/来源失败。

### 5.3 可缓存与不可缓存

可持久缓存：

- MinerU reference 原文 hash；
- 本地解析出的标识符；
- 确定性 landing URL；
- 用户手工确认的匹配；
- 上次状态、失败码和时间；
- 未来获批数据源允许缓存的最小元数据（以其许可条款为准）。

不可写入业务缓存或仓库：

- 机构用户名、密码、2FA；
- SAML assertion、OpenAthens token；
- session cookie、localStorage、浏览器 profile；
- 为规避页面限制而保存的私有 XHR 地址或 token；
- 通过未获许可自动抓取的 Citations 列表、摘要或页面快照。

会话材料如果未来必须由浏览器 profile 管理，应放在 Zotero profile 下的受限运行时目录，明确可删除，并加入 `.gitignore`；绝不能进入插件源码、XPI、日志、CI artifact 或 GitHub Release。

## 六、首发决策

### References

可交付：

- 从 MinerU Markdown 原样列出全部 references；
- 本地识别 DOI/arXiv/article number/已有 URL；
- 对确定性匹配显示链接样式；
- Ctrl+单击在默认浏览器打开论文落地页；
- 无标识符时显示“未找到可验证标识符”，Ctrl+单击打开 Google 搜索；
- 不后台抓取 IEEE/ACM/Google 页面，不静默补全简介。

如悬浮信息卡需要摘要、完整作者或 venue，只能展示 MinerU 原文已有字段；在未采用获批元数据源前，不承诺在线补全。

### Citations

当前只能交付：

- 当前论文有 IEEE article number 或 ACM DOI 时，提供“在浏览器查看 Citations”入口；
- 用户在默认浏览器中自行完成机构认证和查看；
- Zotero 侧明确显示 `citation_source_unavailable`，说明自动 10/30/50 列表需要获批数据源。

当前不能交付：

- 自动抽取 IEEE/ACM Cites in Papers；
- 自动聚合 10/30/50 条；
- 自动按日期重排；
- 自动缓存和跨出版商合并。

若完整 Citations 标签页仍是 XPI 的硬性验收项，则必须先改变至少一个约束：

1. 获得 IEEE/ACM 对该插件场景的书面自动访问许可及稳定接口；或
2. 允许使用出版商正式 API/授权数据服务；或
3. 将 Citations 改为纯网页入口，不在插件内展示记录。

在约束未改变前，研究结论是 **不可行**，不能进入“按原需求实现”的开发票据。

## 七、验证与风险审计要求

未来若来源获得许可，实机验证至少要覆盖：

- Zotero 9.0.6，独立测试 profile；
- 校园 IP、校外 SSO、session 过期、2FA、取消登录；
- IEEE/ACM 各至少一篇有 citation 和无 citation 的论文；
- 10/30/50 三个值、日期缺失和同日排序；
- 403/429/CAPTCHA 不产生空列表假成功；
- 缓存不会保存 cookie/token，日志会脱敏；
- `.gitignore`、XPI contents、CI artifact 和 git history 不含浏览器 profile、cookie、HAR、下载论文或机构信息。

## 来源清单

- [`Rimagination/scansci-pdf` 固定提交](https://github.com/Rimagination/scansci-pdf/tree/5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5)
- [IEEE Xplore Institutional Sign In](https://ieeexplore.ieee.org/Xplorehelp/authentication-and-access/institutional-sign-in)
- [IEEE Xplore SAML Authentication](https://ieeexplore.ieee.org/Xplorehelp/authentication-and-access/saml-authentication)
- [IEEE Xplore Getting Started Guide](https://ieeexplore.ieee.org/Xplorehelp/administrators-and-librarians/getting-started-guide)
- [IEEE Xplore Legal Information / Bot Policy](https://ieeexplore.ieee.org/Xplorehelp/overview-of-ieee-xplore/legal-information)
- [IEEE Xplore Citations 页面示例](https://ieeexplore.ieee.org/abstract/document/10136722/citations?tabFilter=papers)
- [ACM Digital Library User Guide](https://libraries.acm.org/binaries/content/assets/libraries/acm-digital-library-user-guide.pdf)
- [ACM DL End-user Policy](https://www.acm.org/publications/policies/usage-old)
- [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers)
