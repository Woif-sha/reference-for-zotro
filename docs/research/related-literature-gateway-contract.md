# 第一阶段 Related-literature Gateway 与 Primary result 契约

研究日期：2026-07-30
对应票据：[确定第一阶段多数据库检索与 Primary result 契约](https://github.com/Woif-sha/reference-for-zotro/issues/7)

## 结论

第一阶段在“不要求用户配置 API key、可随测试 XPI 分发、只访问正式 API”的约束下采用：

1. **Crossref REST API**：Crossref DOI 的精确元数据，以及期刊、会议、图书等传统出版物的书目候选搜索。
2. **DataCite REST API**：DataCite DOI 的精确元数据，以及数据集、软件、预印本、报告等研究产物的书目候选搜索。
3. **OpenCitations Index v2 + Meta v1**：DOI/PMID 的 incoming citation edges，以及这些 edge 所指论文的开放书目元数据。
4. **DOI Proxy (`doi.org`)**：DOI 的规范解析和 Paper landing page 可达性验证。

首发不使用 OpenAlex、Semantic Scholar、Crossref Cited-by、Google Scholar 或出版商页面抓取：

- OpenAlex 当前 `works` API 把 `api_key` 标为必需，因此不满足“无需用户密钥”。[OpenAlex List works](https://developers.openalex.org/api-reference/works/list-works)
- Semantic Scholar 虽允许大部分 endpoint 匿名访问，但所有匿名请求共享一个池，重载时还会进一步限流；更重要的是，当前 API License 将默认使用限制为内部、非商业研究/教育，公开展示还要求回链、名称和 logo。公开分发的通用 Zotero 插件不应在未取得明确许可前内置该来源。[Semantic Scholar API access](https://www.semanticscholar.org/product/api)；[Semantic Scholar API License](https://api.semanticscholar.org/license/)
- Crossref 公共 API只公开 citation count；完整 citing-work 列表属于需要成员凭据的 Cited-by 服务。[Crossref Cited-by](https://www.crossref.org/documentation/cited-by/)
- OpenCitations token 是自愿而非强制，数据为 CC0，API 当前按 IP 限制为 180 requests/minute，因此适合作为无密钥首发 citation provider。[OpenCitations token and license](https://opencitations.net/accesstoken/)；[OpenCitations Index API v2](https://api.opencitations.net/index/v2)

这份合同不承诺“全世界完整的 Citations”。OpenCitations 的成功空响应只表示“该来源当前没有返回 citation edges”，不得显示成“确定没有 Citing papers”。只有来源返回且成功规范化的记录才进入列表。

## Provider 路由与调用顺序

### Reference resolution

先执行本地稳定标识符规则；本地规则不是数据库 provider：

1. DOI、arXiv ID、PMID/PMCID、明确 publisher identifier 或可信论文 URL；
2. 规范化标识符并形成确定性 URL；
3. 有稳定标识符的候选优先走精确 lookup，不进入模糊文本搜索。

有 DOI 时，以两个注册机构 API 做**并行、独立、受限的精确 lookup**：

```text
GET https://api.crossref.org/v1/works/{percentEncodedDoi}
GET https://api.datacite.org/dois/{percentEncodedDoi}
```

通常只有实际注册机构返回 200，另一方返回 404。404 是该 provider 的 `no_candidate`，不是服务失败。若两方都返回相同 DOI，保留两份 provenance，匹配身份仍以 DOI 为准，再按下文 Primary result 规则选择元数据记录。Crossref 和 DataCite 均正式支持无认证公共读取。[Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)；[DataCite Public API](https://support.datacite.org/docs/api)

没有稳定标识符时，先依据引用文本中的 publication channel 决定本轮 provider 集合，不能因某个来源失败而临时静默换源：

| Channel 信号                                    | 本轮 provider             |
| ----------------------------------------------- | ------------------------- |
| journal、conference、book、chapter、standard    | Crossref                  |
| dataset、software、preprint、repository、report | DataCite                  |
| 缺少 channel 或无法分类                         | Crossref 与 DataCite 并行 |

Crossref 搜索合同：

```text
GET https://api.crossref.org/v1/works
  ?query.bibliographic={title + year + venue}
  &query.author={firstAuthorFamilyName}
  &rows=5
```

- `query.author` 仅在能可靠解析第一作者姓氏时发送。
- venue 可靠时可增加 `query.container-title`。
- 不发送已废弃的 `query.title`。
- 不使用 API 返回顺序确认论文；只把最多 5 条结果交给本地 matcher。

Crossref 的正式 REST API/OpenAPI 暴露 `query.bibliographic`、`query.author`、`query.container-title` 等字段查询参数；查询默认按 relevance 返回，但本项目不把 relevance order 当身份依据。旧的 `CrossRef/rest-api-doc` 仓库已经标记 deprecated，不作为首发契约依据。[Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)；[Crossref REST API OpenAPI](https://api.crossref.org/swagger-ui/index.html)

DataCite 搜索合同：

```text
GET https://api.datacite.org/dois
  ?query=titles.title:"{title}" AND creators.familyName:"{firstAuthor}" AND publicationYear:{year}
  &page[size]=5
```

- 缺少作者或年份时省略对应子句，不写空值。
- title 不能可靠抽取时不发请求，返回 `invalid_query_input`。
- DataCite 使用 OpenSearch query string，支持 `titles.title`、`creators.familyName`、`publicationYear` 和布尔操作。[DataCite query guide](https://support.datacite.org/docs/queries)

### Citing papers

只有当前论文具有 DOI 或 PMID 时才启动首发 citation retrieval：

```text
GET https://api.opencitations.net/index/v2/citations/{scheme}:{value}
  ?sort=desc(creation)
```

OpenCitations v2 的 `citations/{id}` 正式支持 DOI、PMID、OMID，返回 `oci`、`citing`、`cited`、`creation` 等字段；`creation` 是 citing entity 的 publication date。[OpenCitations Index API v2](https://api.opencitations.net/index/v2)

Index v2 的 `oci`、`citing`、`cited`、`creation` 等字段可能带 `[index name] =>` 前缀；同一 citation 被多个 OpenCitations indexes 收录时，一个字段还可能包含以 `;` 分隔的多段来源值。首发解析必须：

- 逐段解析并去掉 transport prefix 后再规范化 DOI、PMID、OMID 和日期；
- 将每个 index name 与原始段写入 `rawProvenance`，不得只保留最后一段；
- 多段稳定标识符相互冲突时返回 `provider_contract_error`，不得任选一段；
- 相同 citation 的多 index 记录按稳定标识符合并，但保留所有 index provenance。

这是 OpenCitations v2 的正式响应合同，不是可选的展示格式。[OpenCitations Index API v2 fields](https://api.opencitations.net/index/v2)

OpenCitations Index v2 没有文档化的 limit/cursor 分页。首发因此每个 current paper 只取一次完整 edge 响应，在本地去重、排序，最多水合前 50 个唯一 citing works。响应超过 10 MiB、解析超时或 schema 不符时显式失败为 `provider_response_too_large` 或 `provider_contract_error`，不得截断后伪装成完整成功。

元数据用 OpenCitations Meta 批量水合：

```text
GET https://api.opencitations.net/meta/v1/metadata/{id1}__{id2}__...__{idN}
```

每批最多 20 个 ID，这是本项目为限制 URL 长度和失败重试范围设定的客户端上限，不是声称 provider 只支持 20 个。Meta 正式支持双下划线分隔多个 ID，并返回 title、author、pub_date、venue、type 等字段。[OpenCitations Meta API](https://api.opencitations.net/meta/v1)

若 current paper 是 DataCite DOI，精确 DataCite record 中的 `relationships.citations` 可作为第二个 edge 来源，与 OpenCitations 结果取并集；每条边保留来源，不能覆盖 OpenCitations provenance。DataCite 正式定义 `relationships.citations` 和 citation DOI。[DataCite single DOI response](https://support.datacite.org/docs/api-get-doi)

只有 arXiv ID、publisher-local ID 或题名而没有 DOI/PMID 时，首发返回 `citation_identifier_unsupported`。不得调用 OpenAlex/Semantic Scholar，也不得抓取 publisher、Google Scholar 或网页搜索结果来假装补齐。

## 统一请求与结果模型

Provider request 必须包含：

```ts
type QueryContext = {
  libraryID: number;
  attachmentKey: string;
  sourceFingerprint: string;
  generation: number;
  requestedAt: string;
  signal: AbortSignal;
};
```

规范化 candidate 至少包含：

```ts
type ScholarlyCandidate = {
  source:
    "crossref" | "datacite" | "opencitations-index" | "opencitations-meta";
  sourceRecordID: string;
  retrievedAt: string;
  identifiers: {
    doi?: string;
    arxiv?: string;
    pmid?: string;
    pmcid?: string;
    omid?: string;
  };
  title: string | null;
  authors: Array<{ family: string; given?: string }>;
  publicationDate: string | null;
  publicationYear: number | null;
  venue: string | null;
  abstract: string | null;
  abstractSource?:
    | "crossref"
    | "datacite"
    | "openalex"
    | "opencitations-meta"
    | "semantic-scholar";
  referenceCount: number | null;
  citationCount: number | null;
  canonicalURL: string | null;
  landingURL: string | null;
  matchedFields: string[];
  rawProvenance: string[];
};
```

`source`、`sourceRecordID`、`retrievedAt`、`matchedFields` 永远必填。成为 Resolved reference 或 Citing paper 还要求：

- 非空 title；
- 至少一个可确认身份的稳定标识符；
- 一个 HTTPS Paper landing page；
- `reachability = reachable`。

authors、date/year、venue 缺失时可保留候选，但标记 `incomplete_metadata`。abstract 和 counts 是可选展示字段，不是身份确认字段。Crossref 明确说明 abstract 可能受 publisher/author copyright；不持久缓存来源为 Crossref 的 abstract，也不把 abstract 纳入 Primary result 得分。用户打开详情卡且已确认 DOI 的记录没有 abstract 时，才依次通过 OpenAlex、Semantic Scholar Academic Graph API 延迟补全并显示；每次返回都必须与请求 DOI 完全一致，该补全不参与身份确认或 Primary result 选择。[Crossref metadata rights](https://www.crossref.org/documentation/retrieve-metadata/)；[OpenAlex API](https://developers.openalex.org/)；[Semantic Scholar Academic Graph API](https://www.semanticscholar.org/product/api)

## 规范化、去重与匹配

### 规范化

- DOI：去掉 `doi:`、`https://doi.org/`，percent-decode，Unicode NFKC，转小写。
- title：Unicode NFKC，HTML entity decode，转小写，标点转空格，折叠空白；原文另存。
- author：优先 family name；Unicode NFKC，转小写，去句点和多余空白。
- year：只接受四位整数；完整日期优先于 year。
- URL：只接受 HTTPS；移除 fragment，不移除有语义的 query。

### 去重

按以下键从强到弱合并：

1. canonical DOI；
2. PMID/PMCID/arXiv 等同 scheme 的稳定标识符；
3. 同一 provider 的 `sourceRecordID`。

没有共同稳定标识符时，题名、作者和年份只能用于候选聚类，不能单独证明多个 provider record 是同一论文。身份确认只使用下述统一规则；作者始终是辅助证据，不构成联合出版或其他记录的例外。

### 确认规则

有稳定标识符时：

- 输入和候选的同 scheme identifier 完全一致即为 exact match；
- 输入含多个标识符而候选出现任一冲突时，候选拒绝；
- 同一 identifier 命中的多个 provider record 必须在其他稳定标识符上也不冲突，并共同形成一个连通的稳定身份；否则保持 `ambiguous_candidate`；
- exact match 优先于任何书目文本证据。

无稳定标识符时，只接受唯一、无竞争的 exact normalized title + exact year：

- title 按上文 NFKC、HTML entity decode、大小写与标点规则规范化后必须完全一致；
- year 必须存在且完全一致；
- author 仅记录辅助证据，不能补偿非 exact title 或 year；
- 多个 exact title + year 候选只有在全部稳定标识符共同证明一个身份时才能共同确认，否则保持 `ambiguous_candidate`；
- 没有合格候选时返回 `no_candidate`。

Issue #38 与 #40 已取代早期 fuzzy score、近似年份和候选分差阈值方案；provider relevance score、返回顺序和作者相似度均不参与身份确认。

## Primary result

只有已经确认是同一论文的 candidate 才参与 Primary result 选择。

### Authority

元数据 authority 从高到低：

1. 与 DOI 精确一致的 Crossref 或 DataCite 注册记录；
2. OpenCitations Meta 聚合记录；
3. 其他记录不进入首发。

Crossref 元数据由其成员和可信来源沉积；DataCite single DOI 返回完整注册元数据；OpenCitations Meta 是 citation index 关联文献的聚合元数据。[Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)；[DataCite single DOI](https://support.datacite.org/docs/api-get-doi)；[OpenCitations Meta](https://api.opencitations.net/meta/v1)

### Completeness

对同一 authority 层的 confirmed candidate 计算：

```text
title                 2
authors non-empty     2
publication date/year 2
venue                 1
DOI                   1
reference count       0.5
citation count        0.5
HTTPS landing page    1
```

abstract 不计分。先排除 unreachable，再按 authority 降序；同一 authority 下优先选择 provider 明确给出安全 HTTPS version-of-record PDF 的记录，然后按 completeness 降序、source 名称和 sourceRecordID 升序稳定打破平局。全文 URL 只作为可下载原文的选择证据，UI 仍打开 Paper landing page。数据库返回顺序不是 tie-break。

### Reachability

DOI candidate 的 canonical URL 固定为 `https://doi.org/{doi}`。DOI Foundation 规定 DOI Proxy 通过 HTTPS GET 将 DOI 重定向到当前 URL；项目不使用已废弃的 `dx.doi.org`。[DOI Handbook](https://www.doi.org/doi-handbook/html/)

验证合同：

- 使用 GET，不使用 HEAD；
- 10 秒超时，最多 5 次 redirect；
- 不发送 cookie、认证 token 或机构凭据；
- 禁止 HTTPS 降级到 HTTP；
- 最终响应必须为 2xx，或为已安全跳转到出版社 HTTPS 页后的 401/403；最终 URL 必须为 HTTPS；
- `Content-Type` 明确是 PDF 或最终 URL 是直接文件下载时拒绝；
- 每次最多读取 64 KiB，验证完成即停止，不解析正文；
- DOI 已安全跳转到最终出版社 HTTPS 页面后，401/403 可确认落地页存在，但只视为受访问控制；404、410、429、5xx、循环 redirect、超时均不是 `reachable`。

保存 `canonicalURL` 和最终 `landingURL`。已解析论文的 Ctrl+左键只打开已经验证的 `landingURL`；未解析、歧义或落地页不可达的条目只显示解析出的论文题名，Ctrl+左键打开 `https://www.google.com/search?q=<encoded title>`。Google 搜索只是用户显式触发的题名检索，不得伪装成 Primary result。无法验证时保留 candidate provenance，但不得成为 Primary result。

## Citations 排序与 10/30/50

排序键固定为：

1. OpenCitations edge 的 `creation` 降序；
2. 缺少 creation 时使用水合后的 publicationDate/year 降序；
3. 仍相同或缺失时按 canonical DOI、PMID、OMID、sourceRecordID 升序。

OpenCitations 定义 `creation` 为 citing entity publication date，因此在水合前即可形成稳定前缀。[OpenCitations Index API v2](https://api.opencitations.net/index/v2)

一次 session 最多保留排序后的 50 条：

- 初次显示 `[0, 10)`；
- 10→30 只水合并追加 `[10, 30)`；
- 30→50 只水合并追加 `[30, 50)`；
- 降低显示数量不删除 session 中已水合记录；
- 同一 generation 内不得因晚到 metadata 改写 edge 排序；
- refresh 创建新 generation，允许形成一套新的稳定顺序。

## 限流、重试与失败映射

### 客户端预算

| Provider                   | 首发客户端限制                                                   | 官方依据                                                                                                           |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Crossref single            | public 5 req/s，concurrency 1                                    | [Crossref 2025-12 implemented rate limits](https://community.crossref.org/t/updates-to-rest-api-rate-limits/14872) |
| Crossref list              | 项目保守 1 req/s，concurrency 1；低于当前 public pool 的 5 req/s | 同上                                                                                                               |
| DataCite                   | 80 req/min，concurrency 2；低于官方 anonymous 500/5 min          | [DataCite rate limits](https://support.datacite.org/docs/rate-limit)                                               |
| OpenCitations Index + Meta | 合并 120 req/min，concurrency 2；低于官方 180/min/IP             | [OpenCitations Index API](https://api.opencitations.net/index/v2)                                                  |
| DOI Proxy reachability     | 2 req/s，concurrency 2                                           | 本项目保守限制                                                                                                     |

Crossref 2025 年 11 月最初公告过按 single/list 区分的限额，但 2025 年 12 月实际部署时改为 public pool 统一 5 req/s、concurrency 1，polite pool 统一 10 req/s、concurrency 5。上表仍把 list 主动压到 1 req/s，是项目的保守预算，不是对当前官方上限的陈述。

若正式构建提供一个能接收邮件的项目联系地址，可通过 User-Agent/mailto 使用 Crossref/DataCite identified 或 polite pool；联系地址不是用户 API key。没有真实维护地址时不得填假邮箱，应使用上述 public/unidentified 限制。Crossref 和 DataCite 都要求以实时 rate-limit headers 为准。[Crossref access](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)；[DataCite API guide](https://support.datacite.org/docs/api)

### HTTP 映射

| 情况                              | 领域错误                   | 重试                                                              |
| --------------------------------- | -------------------------- | ----------------------------------------------------------------- |
| exact singleton 404               | `no_candidate`             | 否                                                                |
| successful search, empty items    | `no_candidate`             | 否                                                                |
| successful citations, empty edges | `no_citations_from_source` | 否；不得解释为全局零引用                                          |
| 400/422                           | `invalid_provider_query`   | 否                                                                |
| 401/403                           | `source_access_denied`     | 否                                                                |
| 429                               | `rate_limited`             | 按 `Retry-After`；缺失时 2s、4s，最多 2 次                        |
| 500/502/503/504                   | `source_unavailable`       | 1s、2s 加 jitter，最多 2 次                                       |
| 其他 5xx                          | `provider_failure`         | 最多 1 次                                                         |
| DNS/TLS/timeout                   | `source_unavailable`       | 最多 2 次                                                         |
| JSON/schema 不符                  | `provider_contract_error`  | 否                                                                |
| required metadata 缺失            | `incomplete_metadata`      | 可换同一已计划 provider 的其他 confirmed record；不可静默增加来源 |
| landing probe 失败                | `unreachable_landing_page` | 仅 refresh 或 TTL 后                                              |

Crossref 要求检查标准 HTTP code，429/403 表示临时或永久阻断；DataCite 明确用 429 表示限流并建议 incremental backoff。[Crossref Swagger](https://api.crossref.org/swagger-ui/index.html)；[DataCite rate limits](https://support.datacite.org/docs/rate-limit)

多个 provider 结果汇总时保留每个 provider outcome。一个来源失败、另一个成功可以显示成功记录，但 UI provenance 必须真实，失败来源仍进入诊断状态；不得把“另一个来源成功”改写成“全部来源成功”。

## 缓存合同

所有数据只写新插件自己的版本化缓存，绝不修改 `llm-for-zotero-mineru`。

cache identity：

```text
libraryID
attachmentKey
MinerU sourceFingerprint
gatewaySchemaVersion
provider
providerQueryVersion
normalized request key
```

默认 TTL：

| 内容                                 | TTL      |
| ------------------------------------ | -------- |
| Crossref/DataCite exact DOI metadata | 7 days   |
| bibliographic search candidates      | 24 hours |
| OpenCitations citation edges         | 24 hours |
| OpenCitations Meta hydration         | 7 days   |
| successful landing reachability      | 24 hours |
| exact singleton 404                  | 6 hours  |
| search `no_candidate`                | 1 hour   |
| `no_citations_from_source`           | 1 hour   |

429、5xx、网络错误、schema 错误不得 negative-cache；只保存 `Retry-After` 或短期 circuit-breaker 截止时间。过期 cache 不得显示成当前成功结果。它可以保留在磁盘供诊断或在明确标记 `stale` 的错误 UI 中引用，但不能进入 Resolved/Citations 成功列表。

manual refresh：

- 创建新 generation 并 abort 旧请求；
- 绕过 negative cache；
- 重新验证 positive cache；
- 旧 generation 即使晚到也不得写 UI 或 cache 当前指针。

任何提交必须同时满足 `libraryID + attachmentKey + sourceFingerprint + generation` 仍匹配。MinerU Markdown 或 provenance 改变后，旧 results 因 sourceFingerprint 变化自然失效。gateway/provider schema 改变时必须递增相应 version。

## Zotero 9 首发集成边界

Gateway 是网络与决策边界，不是第二个“当前条目”状态源。Zotero 9 首发固定以下集成契约：

- Reader/controller 显式传入 `libraryID`、`attachmentKey`、`sourceFingerprint`、`generation` 和 `AbortSignal`；gateway 不得从全局 Reader 或选择状态推断当前论文。
- Reader 关闭、切换附件、MinerU 来源改变或 manual refresh 时立即 abort 旧 generation；晚到响应只能保留作诊断，不得更新当前 UI 或当前 cache pointer。
- 缓存只写 Zotero data directory 下本插件自己的版本化命名空间；不得写 Zotero item fields、attachment files 或 `llm-for-zotero-mineru`。
- 每个展示结果都带实际产生它的 provider/source record 和 retrieval time；Zotero 条目元数据可以是 query input，但不得改标成 provider provenance。
- 首发不提供用户 credential UI。后续若引入必须使用用户或项目 key 的 provider，应另作契约决策，不得以隐藏配置或静默 fallback 加入。

这些规则把 Zotero 9 Reader 生命周期与 cache commit 收束到同一个 identity invariant，避免旧论文结果显示到新激活的 Reader。

## 首发验收边界

首发可以承诺：

- 无用户 API key 的 Crossref/DataCite 真实 Reference resolution；
- DOI/PMID 范围内、基于 OpenCitations 当前开放覆盖的 Citing papers；
- 明确 provenance、保守唯一匹配、可达 Primary result；
- 显式区分无候选、歧义、来源不可用、限流、不完整元数据、不可达和“该来源无 citation edges”。

首发不能承诺：

- Google Scholar、Scopus、Web of Science、IEEE、ACM 或所有学科的完整 cited-by 集合；
- 只有 arXiv ID 时的自动 Citations；
- OpenAlex 或 Semantic Scholar 的匿名机会性结果；
- Crossref 公共 API 提供 citing-work 列表；
- provider 失败时静默抓网页、换未记录来源或用 stale cache 假成功。

因此完整 Citations 的真实产品语义是“OpenCitations 当前明确返回并成功水合的 Citing papers”，不是“当前论文的全部 Citing papers”。如果后续要求更完整覆盖，必须另开决策，允许用户/项目 API key、取得 Semantic Scholar 明确许可，或引入有运维责任的后端；不能在本合同下伪装实现。
