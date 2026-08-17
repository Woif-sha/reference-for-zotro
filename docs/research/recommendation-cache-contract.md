# 第三阶段推荐缓存身份、失效与路径契约

研究日期：2026-08-17

对应票据：[确定推荐缓存身份、失效与路径契约](https://github.com/Woif-sha/reference-for-zotro/issues/49)

## 结论

第三阶段使用一个独立的 `recommendation.json`，与现有三份文献缓存放在同一论文目录，但不加入它们的 manifest 或三文件提交批次：

```text
<Cache 根目录>\v2\papers\<libraryID>-<attachmentKey>\
├─ manifest.json
├─ references.json
├─ citations.json
└─ recommendation.json
```

`recommendation.json` 只保存一个当前有效回答。正常点击先读它；身份完全命中时直接显示，不调用模型。本阶段没有“重新分析”入口。若当前论文、当前已有候选快照、Reference/Citing paper 来源归属、当前已知 Abstract、模型运行身份或提示词版本发生变化，则视为正常 miss，重新分析成功后原子替换旧文件。

跨重启命中不能要求重新取得 Abstract。现有文献缓存会主动删除 `abstract`、`abstractSource` 及其加载状态，因此推荐缓存必须保存“当时实际分析了哪些候选”和各自的 Abstract 指纹；重启后 Abstract 尚未重新加载不构成失效，但当前已经加载出的新 Abstract 必须参与一致性检查。[文献缓存序列化实现](../../src/cache/cache-repository.ts#L209-L221)

Cache 路径设置表示 **`reference-for-zotero-cache` 容器目录本身**。默认值仍为：

```text
<Zotero Data Directory>\reference-for-zotero-cache
```

例如用户选择：

```text
E:\ZoteroData\reference-for-zotero-cache
```

则论文 `libraryID=1`、`attachmentKey=2NLUMKUB` 的推荐文件为：

```text
E:\ZoteroData\reference-for-zotero-cache\v2\papers\1-2NLUMKUB\recommendation.json
```

修改 Cache 根目录后只切换后续读写位置，不迁移、不复制、不删除旧目录；切回旧根目录时，只要其中回答仍通过当前身份校验，就可以再次命中。

## 已有实现的约束

### 论文目录和文献缓存是一条既有合同

当前目录名只由 `libraryID` 与 `attachmentKey` 组成；两者在进入路径前分别限制为非负整数和字母数字字符串。[目录键实现](../../src/cache/cache-key.ts#L33-L43)

当前 `manifest.json`、`references.json`、`citations.json` 使用独立的 literature cache schema `2`。读取时先比较完整的 literature identity，再要求三个文件存在且 `updatedAt` 完全一致；身份不一致是 miss，文件缺失、格式错误或 revision 混杂是显式错误。[读取合同](../../src/cache/cache-repository.ts#L53-L88)

现有 Zotero storage 把根目录固定为 `reference-for-zotero-cache/v2/papers`，按论文目录串行写入，并依次 stage 三个文件后 move 到最终文件；`manifest.json` 最后提交。[Zotero storage](../../src/platform/zotero-runtime.ts#L82-L151)

本机只读样本 `E:\ZoteroData\reference-for-zotero-cache\v2\papers\1-2NLUMKUB` 与代码一致：2026-08-17 检查时包含三份文件，三者 `updatedAt` 均为 `2026-08-17T02:08:55.638Z`，manifest 为 schema `2`，论文目录身份为 `libraryID=1`、`attachmentID=126`、`attachmentKey=2NLUMKUB`。样本包含 19 个 Reference entries、0 个 Citing papers，且 citations 的 `loadedLimit=10`。

因此推荐缓存不得：

- 把 `recommendation.json` 加入现有 `LiteratureCacheFileName`；
- 修改 literature manifest 的 `updatedAt` 或 schema；
- 因写推荐结果而重写 `references.json` 或 `citations.json`；
- 假设现有 literature cache 会在重启后恢复 Abstract；
- 清理论文目录中的“未知文件”。

### MinerU 已提供所需的正文身份

MinerU adapter 在一次已校验读取中同时返回 `fullMarkdown`、`fullMdSha256` 和由 `_llm_source.json`、正文、manifest、content list 共同产生的 `sourceFingerprint`，不需要推荐模块重新读取或解析正文。[MinerU 返回合同](../../src/mineru/mineru-adapter.ts#L52-L59) [指纹计算](../../src/mineru/mineru-adapter.ts#L118-L157)

推荐缓存沿用：

- `sourceFingerprint`：复用当前 paper session 的来源身份和陈旧提交保护；
- `contextSha256`：对**实际发送给模型的规范化正文上下文**计算 SHA-256。

首版若发送完整的 `fullMarkdown`，`contextSha256` 就等于现有 `fullMdSha256`。若模型传输研究最终规定了确定性裁剪，hash 必须针对裁剪后的实际文本，且裁剪规则变化必须同时提升 `promptVersion`。正文只提供上下文，候选始终来自控制器已有数据；缓存模块不得从正文再次发现 Reference entry 或 Citing paper。

### Paper Translate 的模型身份可复用，但需补入 effort

计划移植的 Paper Translate runtime 已把 `authMode`、provider/model 配置项、真实模型名与 API Base 组成模型缓存身份，并且不会把 API key 放进去。[Paper Translate `modelCacheIdentity`](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/runtime.ts#L84-L92)

但 Codex 请求的 `effort` 会实际进入请求体，[Paper Translate model runtime](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/runtime.ts#L45-L62)；其 OCR 缓存也把 `model`、`effort` 和 `promptVersion` 一起纳入输入身份。[Paper Translate OCR cache](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/ocr/cache.ts#L82-L96)

因此推荐缓存的模型身份必须包含 `effort`。不得包含 `apiKey`、`auth.json` 路径、access token、refresh token 或服务商显示名称；凭据轮换和纯显示名变化不会改变模型输出合同，也不得让秘密进入磁盘回答。

## `recommendation.json` schema v1

首版文件采用以下精确形状：

```json
{
  "schemaVersion": 1,
  "paper": {
    "libraryID": 1,
    "attachmentID": 126,
    "attachmentKey": "2NLUMKUB",
    "parentItemKey": "PARENT01",
    "sourceFingerprint": "64-char-lowercase-sha256",
    "contextSha256": "64-char-lowercase-sha256"
  },
  "snapshot": {
    "visibleCandidatesSha256": "64-char-lowercase-sha256",
    "analyzedCandidates": [
      {
        "candidateKey": "doi:10.1234/example",
        "origins": ["citation", "reference"],
        "abstractSha256": "64-char-lowercase-sha256"
      }
    ]
  },
  "model": {
    "authMode": "codex_auth",
    "providerId": "provider-codex",
    "modelId": "model-codex-gpt-5-4",
    "model": "gpt-5.4",
    "apiBase": "https://chatgpt.com/backend-api/codex/responses",
    "effort": "medium"
  },
  "promptVersion": "related-paper-recommendation-v1",
  "generatedAt": "2026-08-17T03:00:00.000Z",
  "result": {
    "priority": [
      {
        "candidateKey": "doi:10.1234/example",
        "reason": "直接扩展了当前论文的核心方法，并在更新数据上验证了同一问题。"
      }
    ],
    "optional": []
  }
}
```

字段合同：

- `schemaVersion` 只描述 `recommendation.json`，与同目录 literature schema `2` 相互独立。
- `paper` 必须与当前 `PaperIdentity` 一致；`contextSha256` 额外绑定实际模型正文输入。
- `visibleCandidatesSha256` 绑定点击时控制器中已有的完整 Reference/Citing paper 快照，包括当时没有 Abstract、因而不能参加分析的条目。
- `analyzedCandidates` 只包含当时 Abstract 已就绪、实际发给模型的去重候选；`origins` 只能是 `citation`、`reference` 或固定顺序的二者组合。
- `abstractSha256` 对发送给模型的规范化 Abstract 计算，不保存 Abstract 正文。
- `model` 是一次分析开始时的不可变运行快照。`apiBase` 使用设置模块已经规范化、移除末尾 `/` 的值；OpenAI Compatible 的 `effort` 固定为空字符串。
- `promptVersion` 同时版本化 system instructions、候选序列化、推荐分组规则、结果解析规则和任何正文裁剪规则；上述任一语义变化都必须提升版本。
- `generatedAt` 只用于审计，不参与命中，不设置 TTL。
- `priority` 和 `optional` 的数组顺序就是展示顺序，不另存 `rank` 或相关度分数。
- `priority` 最多 5 条；每个已分析 candidate 必须且只能出现在一个组中，不能遗漏、重复或凭空增加候选。
- `reason` 必须是非空的直接联系说明。文件不保存模型原始响应、思维过程或未解析文本。

每个论文目录只保存一个回答。模型、提示词或候选变化后，新分析成功才替换旧回答；分析失败保留旧文件原样，但旧文件仍因身份不匹配而不可显示。

## 候选快照与指纹

### 先形成一份规范化快照，再同时用于 prompt 和 hash

不得分别实现“prompt 候选转换”和“cache key 候选转换”。分析模块先把控制器已有的 References 与 Citing papers 整合为一份规范化候选快照，prompt builder 与 cache repository 共同消费它。这样新增或修改一个模型输入字段时，不会漏掉缓存失效。

去重沿用现有 `sameReaderPaperIdentity` 的稳定标识符语义，不在缓存层新增标题相似度兜底。[Reader identity](../../src/reader/mountReaderSection.ts#L87-L98)

一个合并组的 `candidateKey` 按以下顺序选取：

1. 规范化 DOI：`doi:<lowercase-doi>`；
2. 规范化 arXiv ID：`arxiv:<normalized-id>`；
3. 规范化 PMCID：`pmcid:<uppercase-pmcid>`；
4. 都不存在时使用 `reader:<ReaderPaper.id>`。

若组内同时存在多个标识符，选择上述优先级最高者。存在相互冲突的稳定标识符时不得合并。首版不使用标题、作者或年份猜测同一论文。

`origins` 是关系来源，不是元数据 provider：

- 只来自 References：`["reference"]`；
- 只来自 Citing papers：`["citation"]`；
- 两边都有：`["citation", "reference"]`。

这里的 “来源变化导致失效” 明确定义为 `origins` 变化。Crossref、OpenAlex 等 provider 名称只有在最终模型请求实际包含它们时才进入快照；不因后台 provider 显示名变化制造无意义 miss。

### `visibleCandidatesSha256`

hash 输入是按 `candidateKey` 升序排列的全部规范化候选，每条固定包含：

```text
candidateKey
origins
status
title
authors | null
venue | null
year | null
doi | null
arxivID | null
pmcid | null
citationCount | null
referenceCount | null
```

不包含 `ordinal`、当前 tab、选中状态、Abstract 加载中/错误文案、下载状态、详情卡开关、`retrievedAt`、landing URL 或 literature cache 的 `updatedAt`。这些字段既不应影响模型判断，也不应让等价候选快照失效。

规范化规则只有一份：字符串 trim、换行统一为 `\n`、缺失值写为 JSON `null`、标识符使用现有 identifier normalizer、`origins` 使用固定顺序、对象属性按上述固定顺序构造。对该 UTF-8 JSON 计算 SHA-256 小写十六进制。模型请求必须从同一快照生成，而不是再次读取或转换 `ReaderPaper`。

### Abstract 一致性与跨重启恢复

分析时对每个非空 Abstract 使用与 prompt 相同的 trim/换行规范化，然后写入 `abstractSha256`。读取有效缓存时：

1. 每个 `analyzedCandidates.candidateKey` 都必须仍存在于当前 visible snapshot，且 `origins` 相同；
2. 当前已经有 Abstract 的候选，如果在旧 `analyzedCandidates` 中，则其 Abstract hash 必须相同；
3. 当前已经有 Abstract、但不在旧 `analyzedCandidates` 中，说明现在多了一篇可分析论文，cache miss；
4. 旧回答分析过、但当前 Abstract 尚未加载的候选不失效；这是跨重启直接恢复所必需的唯一“未知值”规则；
5. `visibleCandidatesSha256` 不同始终 miss，不能用第 4 条掩盖候选增删、元数据或关系来源变化。

这不是用其他元数据替代 Abstract。cache miss 时仍只分析当前确实持有非空 Abstract 的论文；缺失或加载中的 Abstract 直接跳过，不等待、不补全、不提示逐篇跳过状态。

## 命中、失效与错误分类

### 正常 miss：允许调用模型

以下情况返回 miss，不修改旧文件：

- `recommendation.json` 不存在；
- 当前 `paper` 任一身份字段不一致；
- `visibleCandidatesSha256` 不一致；
- 按上节规则发现已知 Abstract 或可分析候选集合变化；
- `model` 任一非秘密运行字段变化，包括 `effort`；
- `promptVersion` 变化。

miss 后，若当前至少有一篇 Abstract 已就绪候选，则调用当前显式选择的模型；成功并通过结果校验后原子替换文件。若一篇也没有，只显示“当前结果中暂无可分析的论文”，不调用模型、不写空回答，也不删除旧文件。

### 有效 hit：禁止调用模型

正常点击的顺序必须是：

1. 固定当前 paper、候选和模型快照；
2. 尝试读取并校验 `recommendation.json`；
3. 命中则直接恢复统一榜单，即使重启后 Abstract 尚未重新加载；
4. 只有 miss 后才检查当前 Abstract 是否足以启动新分析。

先检查 “现在有没有 Abstract” 再读取 cache 会破坏已确认的跨重启目标，禁止采用。

### 结构错误：显式失败，不静默重算

以下不是 miss，而是可见的 recommendation cache read error：

- JSON、UTF-8 或顶层对象无效；
- `schemaVersion` 不支持；
- 必需字段类型、枚举、时间或 SHA-256 格式无效；
- analyzed candidate key 重复、来源非法；
- result 引用不存在候选、重复/遗漏候选、`priority` 超过 5 条或 reason 为空；
- recommendation 文件是目录或底层读取出现权限、设备等 I/O 错误。

结构错误时不删除、不自动覆盖、不偷偷调用模型。这样与现有 literature cache 对“不完整、格式错误、revision 混杂”的显式失败保持一致，也避免付费模型请求掩盖磁盘损坏。

## 原子写入与陈旧提交

`recommendation.json` 是单文件事务，使用独立的 `RecommendationCacheRepository` 和 storage port：

1. 按最终文件路径串行化写操作；
2. 模型结果先完成 schema 与候选完备性校验；
3. 写前确认分析时的 paper session token、模型快照、候选快照和 Cache 根目录仍为当前值；
4. 使用 `IOUtils.write(finalPath, bytes, { tmpPath })` 在同目录临时文件完成后替换最终文件；
5. 写失败向界面暴露原始错误，不产生内存成功，也不修改旧的完整文件。

Mozilla 的 `IOUtils` 合同明确说明：指定 `tmpPath` 时先写中间文件，完成后以 move 覆盖目的地，因此适合单文件安全替换。[IOUtils `WriteOptions.tmpPath`](https://searchfox.org/firefox-main/source/dom/chrome-webidl/IOUtils.webidl)

现有项目已经以相同机制写 MinerU 规范化文件，并为 literature 三文件事务额外使用 staged paths。[MinerU 写入](../../src/platform/zotero-runtime.ts#L53-L63) [literature staged commit](../../src/platform/zotero-runtime.ts#L118-L148)

推荐写入不与三份 literature 文件组成四文件事务；两套 repository 只共享论文目录。literature rewrite 不删除 `recommendation.json`，recommendation write 也不触碰其他三份文件。即使进程在两套写入之间退出，下次也会根据当前 paper 和候选 fingerprint 把旧回答判为 hit 或 miss，不会把不同 revision 当成有效结果。

分析期间若切换 Reader/current paper、刷新结果、更换模型或修改 Cache 根目录，必须取消本次分析或使最终 `canCommit` 失败；陈旧响应不得显示，也不得写入旧根目录或新根目录。

## 可配置 Cache 根目录

### 设置值和派生路径

新增 preference 保存容器根目录，例如：

```text
extensions.referenceforzotero.cacheRoot
```

没有设置时，运行时从当前 Zotero data directory 派生默认根目录；不要把展开后的默认路径写入 preference，以便用户以后移动 Zotero data directory 时默认值随之变化。

设置值复用现有 `validateWindowsAbsolutePath` 的规则：trim、`/` 转 `\`、拒绝 `\\?\`/`\\.\` device path、接受盘符绝对路径或合法 UNC 根、删除非盘符根末尾斜杠。[现有 Windows 路径校验](../../src/application/download-settings.ts#L156-L169)

派生路径固定为：

```text
<cacheRoot>\v2\papers\<validated libraryID>-<validated attachmentKey>\<fixed filename>
```

用户不能配置 `v2`、`papers`、论文目录名或文件名；这些是 schema/layout 合同，不是自由路径片段。

### 路径切换

- 保存新根目录后，所有新 cache operation 使用新根目录；已打开 Reader 中的旧 repository 不能继续固定在旧根。
- 设置变更通知当前分析 controller，使在途分析失去提交资格。
- 不扫描、迁移、合并、复制或删除旧根目录。
- 新根目录中已有同论文缓存时按正常规则校验，不无条件覆盖。
- 切回旧根目录时允许再次命中仍有效的回答。
- “恢复默认”只清除 preference，不删除任一路径中的数据。

### 路径状态与错误

| 状态                                               | 行为                                           |
| -------------------------------------------------- | ---------------------------------------------- |
| preference 缺失                                    | 使用 Zotero data directory 下的默认根          |
| 用户取消 folder picker                             | 不改变设置和当前操作                           |
| 输入不是受支持的 Windows 绝对路径                  | 拒绝保存并在设置页显示原始校验错误             |
| 根目录或论文目录尚不存在                           | read 为 miss；首次成功 write 创建 ancestors    |
| 根路径实际是文件、不可读、不可写、权限不足、磁盘满 | 显式暴露 I/O 错误，不回退默认根                |
| 配置值被外部破坏                                   | 设置页和 Reader 显示配置错误，不静默使用默认根 |

禁止在路径错误时 fallback 到默认根：这会让用户误以为正在使用所选 Cache，且可能错误显示另一个根中的旧回答。

## 与现有 schema 的共存边界

| 文件                  | 所有者                          | schema | revision/身份                                 | 推荐功能能否修改 |
| --------------------- | ------------------------------- | ------ | --------------------------------------------- | ---------------- |
| `manifest.json`       | `LiteratureCacheRepository`     | `2`    | literature identity + shared `updatedAt`      | 否               |
| `references.json`     | `LiteratureCacheRepository`     | `2`    | shared `updatedAt`                            | 否               |
| `citations.json`      | `LiteratureCacheRepository`     | `2`    | shared `updatedAt` + `loadedLimit`            | 否               |
| `recommendation.json` | `RecommendationCacheRepository` | `1`    | paper/context/candidate/model/prompt identity | 是，仅此文件     |

`v2` 是当前磁盘布局版本，不等于四个文件必须共用一个 schema。推荐 schema 将来升级时先提升 `recommendation.json.schemaVersion`；只有目录结构本身不兼容时才考虑新的 layout version。本阶段不提供旧 recommendation schema migration，也不修改已有 literature schema。

## 实现阶段的最小接口边界

规划建议的接口只有两层，不把缓存规则散入 Reader：

```ts
type RecommendationCacheLookup =
  { kind: "hit"; value: RecommendationResult } | { kind: "miss" };

interface RecommendationCacheRepository {
  read(
    input: RecommendationCacheLookupInput,
  ): Promise<RecommendationCacheLookup>;
  write(
    input: RecommendationCacheWriteInput,
    result: RecommendationResult,
    signal: AbortSignal,
  ): Promise<void>;
}
```

`RecommendationCacheLookupInput` 接收分析模块已经形成的 current paper、规范化候选快照、当前已知 Abstract hashes、模型快照和 prompt version；repository 不访问 Reader state、不读取 MinerU 正文、不获取 Abstract、不重新检索论文，也不决定 Citation 优先级。

Reader/controller 只负责正常点击状态流和把有效 hit 映射到当前候选标题。模型响应校验、候选全覆盖、最多 5 篇“优先看”等语义由分析模块形成一次确定结果，repository 在持久化边界再次验证磁盘 schema。

## 必须验证的行为

正式实现票至少覆盖：

1. 默认根目录和自定义根目录都派生到同一 `v2/papers/<libraryID>-<attachmentKey>` 结构；
2. 写 recommendation 不改动三份 literature 文件的 bytes/mtime；literature rewrite 不删除 recommendation；
3. 有效 hit 在 Abstract 未恢复时直接显示且模型调用次数为 0；
4. 新增一个已就绪 Abstract、修改已知 Abstract、增删候选或改变 `origins` 均 miss；
5. 缺失 Abstract 不触发补全、等待或额外 Citations 加载；
6. current paper/context、模型名/API Base/effort、promptVersion 任一变化均 miss；API key/token 变化不影响身份且不落盘；
7. miss 且没有 Abstract 时展示空状态，不调用模型、不写文件；
8. 模型失败、结果 schema 错误、陈旧 session 或路径切换都不覆盖旧文件；
9. 单文件写中断后旧完整回答仍可读，临时文件不会被当成缓存；
10. 非法/损坏 recommendation 是显式错误，普通身份不匹配是 miss；
11. 修改或恢复 Cache 根目录不迁移、不删除旧数据，切回旧根可重新命中；
12. UI 不提供绕过有效缓存的“重新分析”动作。

## 不采用的方案

- **把回答并入 literature manifest 或四文件原子批次**：会耦合两个生命周期，并让一次模型回答改写稳定的文献缓存 revision。
- **只用论文目录名作为 cache key**：无法识别正文、候选、模型和提示词变化。
- **以 Abstract 当前是否存在决定 cache hit**：会让重启后已缓存回答无法恢复。
- **持久化完整候选 Abstract**：重复保存外部元数据且无展示需要；hash 足以决定复用或失效。
- **使用 literature `updatedAt` 作为候选身份**：相同内容被重新持久化也会制造 miss；应比较规范化内容。
- **把 API key/token 写入身份**：既无助于判断模型输出合同，也会泄露秘密并在凭据轮换时制造无意义 miss。
- **路径错误后静默使用默认目录**：会形成两个不可见的数据源。
- **自动迁移或清理旧根目录**：超出用户授权且存在大范围文件操作风险。
- **增加强制重新分析**：已由用户明确留待后续，不属于第三阶段首版。
