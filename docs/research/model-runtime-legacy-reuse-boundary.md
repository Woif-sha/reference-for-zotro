# 第三阶段模型设置与 Legacy 传输的最小复用边界

研究日期：2026-08-17\
对应票据：[确定模型设置与 Legacy 传输的最小复用边界](https://github.com/Woif-sha/reference-for-zotro/issues/48)

## 结论

第三阶段应把 `paper-translate-for-zotero` 已验证的双通道模型能力移植到本插件，并由 Reference for Zotero 独立保存配置；运行时不依赖 Paper Translate，也不引入 Codex App Server。推荐边界如下：

1. 复用 provider/model 配置、显式唯一当前模型、草稿模型连接测试、设置页 provider card 交互和模型切换前取消旧任务的语义。
2. 复用 Paper Translate 的 Legacy `auth.json` 客户端，而不是从 `llm-for-zotero` 的综合 LLM client 再拆一次。前者已经把固定 Codex Responses endpoint、SSE 解析、一次 401 刷新重试、登录失效分类和刷新并发集中在一个窄模块中。[Paper Translate provider 配置](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/providers.ts#L4-L35)；[Legacy 请求与刷新入口](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/codex/legacyClient.ts#L258-L337)
3. 复用 Paper Translate 的 OpenAI Compatible `/chat/completions` endpoint 解析、最小 system/user payload、流式文本解析、错误响应上限和 API key 错误脱敏。[OpenAI Compatible client](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/openAICompatibleClient.ts#L110-L249)
4. 不复制翻译 prompt、翻译任务、OCR、图片输入、web search、引用 URL 采集、论文学习、上下文研究、侧栏或模型输出排版。推荐协议负责生成和校验推荐 JSON；模型模块只负责“一次选定模型的文本请求”。
5. 推荐应用层只认识一个 `RecommendationModelPort` seam；Legacy 与 OpenAI Compatible 的分派、认证、刷新、SSE、错误分类和活动模型快照全部隐藏在生产 adapter 内。设置页另由 `ModelSettings` 模块管理配置，不让 controller 读取 prefs、`auth.json` 或 API key。

这不是“同时保留 Paper Translate 与 llm-for-zotero 两套实现”。唯一移植源应是 Paper Translate 当前 `dev` 的窄实现；`llm-for-zotero` 只作为来源谱系和排除复杂度的对照。

## 研究基线与许可

| 仓库                       | 固定研究版本                                                                                                                                       | 用途                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Reference for Zotero       | [`ca829584668764ffdd3f830fe78f6876623ed90b`](https://github.com/Woif-sha/reference-for-zotro/tree/ca829584668764ffdd3f830fe78f6876623ed90b)        | 现有 composition root、Reader controller、MinerU 与缓存 seam |
| Paper Translate for Zotero | [`969f1350a583c45a21303aeba133ab37e488f1af`](https://github.com/Woif-sha/paper-translate-for-zotero/tree/969f1350a583c45a21303aeba133ab37e488f1af) | 唯一直接移植源                                               |
| llm-for-zotero             | [`d9724df84ac053343cf32b00c7829620a243e5b9`](https://github.com/Woif-sha/llm-for-zotero/tree/d9724df84ac053343cf32b00c7829620a243e5b9)             | Paper Translate NOTICE 固定的上游实现谱系与范围对照          |

三个仓库都声明 `AGPL-3.0-or-later`，所以向同为 AGPL-3.0-or-later 的 Reference for Zotero 移植并修改源码在许可方向上相容。[本仓库 package.json](https://github.com/Woif-sha/reference-for-zotro/blob/ca829584668764ffdd3f830fe78f6876623ed90b/package.json)；[Paper Translate package.json](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/package.json)；[llm-for-zotero package.json](https://github.com/Woif-sha/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/package.json)

实现提交仍须更新本仓库 `NOTICE`：明确记录直接移植自 Paper Translate 的固定 commit、文件范围和修改内容，并保留它已声明的 llm-for-zotero 上游谱系。Paper Translate 自己的 NOTICE 已把 Legacy 认证、多 provider、OpenAI Compatible 与连接测试的来源固定到 llm-for-zotero `d9724df...`，同时明确排除了 App Server、Copilot、Anthropic、Gemini 等分支。[Paper Translate NOTICE](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/NOTICE#L19-L48)；[本仓库现有 NOTICE](https://github.com/Woif-sha/reference-for-zotro/blob/ca829584668764ffdd3f830fe78f6876623ed90b/NOTICE)

## 必须复用、需要改名和必须排除

### 1. 模型配置与选择

| Paper Translate 实现                                                                                     | 决定       | Reference for Zotero 适配                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ModelAuthMode = "codex_auth" \| "openai_compatible"`、provider group、model entry、唯一 `activeModelId` | 复用       | 保持两种认证和一个全局当前模型，不增加第三种协议。[类型与配置 schema](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/providers.ts#L4-L35)                                                                                                                                                                                |
| provider/model 完整性、重复 ID、当前模型存在性、HTTPS API Base 校验                                      | 复用       | 错误文本改为本插件本地化文案；不添加静默默认或自动丢弃空模型行。[配置校验](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/providers.ts#L95-L168)                                                                                                                                                                         |
| `flattenRuntimeModels`、`resolveDraftRuntimeModel`、`getActiveRuntimeModel`、订阅变更                    | 复用       | 设置页连接测试继续只校验正在测试的一行，不要求未完成的 sibling model 先保存。[运行时解析](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/providers.ts#L171-L275)；[对应测试](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/test/modelProviders.test.ts#L112-L132) |
| 模型切换或当前模型关键配置变化前调用 `cancelModelTasks`                                                  | 复用语义   | 注入“取消当前推荐分析”，不能复制翻译/OCR/knowledge operation 的三个取消函数。[选择动作](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/selection.ts#L37-L66)；[翻译专属装配](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/hooks.ts#L44-L53)                  |
| 从 `paper.codexModel`、`paper.codexEffort` 迁移旧设置                                                    | 排除       | 本插件没有旧模型设置；首次运行直接创建新的默认 Codex provider，不能伪造一次不存在的迁移。[旧设置迁移](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/providers.ts#L37-L72)                                                                                                                                               |
| `paper.modelProviders`、`paper.activeModelId` pref key                                                   | 改名       | 使用本插件 prefs prefix 下的模型键；配置独立于 Paper Translate。[Paper Translate 持久化键](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/providers.ts#L42-L45)                                                                                                                                                          |
| `modelCacheIdentity`                                                                                     | 不原样复制 | 原函数未包含 `effort`；推荐缓存已决定把推理强度纳入 identity。新 identity 包含 auth mode、provider ID、model entry ID、model 名、API Base、effort，不包含 API key 明文。[现有 cache identity](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/runtime.ts#L84-L91)                                                         |

Fresh default 可以沿用 Paper Translate 当前 `gpt-5.4`、`medium` 和固定 Legacy endpoint，但应作为本插件 schema 的初始配置，而不是 migration fallback。Codex provider 不显示可编辑 API Base；OpenAI Compatible provider 必须显式填写 HTTPS API Base、API key 与 model ID。Paper Translate 的 validator 已表达这两个不同契约。[默认值与 Codex endpoint 固定](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/providers.ts#L74-L135)

### 2. Legacy `auth.json` 与 token 刷新

必须整体移植以下行为，不能只复制“读取 token + fetch”两段：

- auth 路径顺序：`CODEX_HOME/auth.json`，否则用户 home 下 `.codex/auth.json`，并保留 Zotero `PathUtils`/XPCOM home fallback。[auth 路径解析](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/codex/legacyClient.ts#L710-L747)
- 固定 `https://chatgpt.com/backend-api/codex/responses`；请求体使用文本 input、`store: false`、`stream: true`，Codex 模型才携带非 `auto` reasoning effort。[Legacy payload](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/codex/legacyClient.ts#L340-L410)
- 首次 401 后只刷新一次并以新 access token 重发；第二次 401 转换为稳定的“重新 `codex login`”错误，其他 HTTP 错误不换模型、不换 endpoint。[401 流程](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/codex/legacyClient.ts#L258-L321)
- 同一插件实例中，以 auth path 为键共享一个刷新 promise；一个调用方取消等待不取消其他调用方共享的刷新，插件 shutdown 才取消刷新任务。[共享刷新](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/codex/legacyClient.ts#L463-L505)；[等待方取消](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/codex/legacyClient.ts#L666-L678)
- OAuth 请求前重读文件；写回前再次重读并比较 access/refresh token。若 Codex CLI 或另一个插件已更新 access token，则采用新文件内容且不覆盖；若凭据被删除或发生无法解释的变化，则失败而不是恢复旧值。[刷新 compare-before-request/compare-before-write](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/codex/legacyClient.ts#L507-L635)
- 对 `refresh_token_reused`/`invalid_grant` 失败再读一次 `auth.json`；若 access token 已变化就采用它，否则只报告登录失效，不重试同一个 refresh token。[拒绝后的收敛](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/codex/legacyClient.ts#L551-L570)
- 使用 `IOUtils.write(..., { tmpPath })` 写完整 JSON，保留未知顶层字段与未知 token 字段；本插件必须把临时名改成 `.reference-for-zotero.tmp`，不能与 Paper Translate 共用 `.paper-translate.tmp`。[原子写回](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/codex/legacyClient.ts#L612-L635)

这些保护在 Paper Translate 已有针对并发请求、CLI 并发更新、reused refresh token、取消后禁止写回和 PathUtils home 的测试，移植时应把相应测试一并改名迁入，而不是只测试 happy path。[Legacy 并发与外部更新测试](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/test/codexLegacyClient.test.ts#L422-L733)；[取消与路径测试](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/test/codexLegacyClient.test.ts#L807-L1117)

`llm-for-zotero` 固定版本中的通用 client 在刷新时直接请求、再读取并覆盖 auth 文件，没有 Paper Translate 后来增加的共享刷新 job 与双重 compare，因此不应成为第二份移植源。[llm-for-zotero 旧刷新实现](https://github.com/Woif-sha/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/src/utils/llmClient.ts#L642-L741)

### 3. OpenAI Compatible

保留：

- API Base 去尾斜杠，若尚未以 `/chat/completions` 结尾则追加；只接受 HTTPS。[endpoint 解析](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/openAICompatibleClient.ts#L110-L123)
- 仅发送 `model`、system message、user message、`stream: true`；不猜测 temperature、reasoning 或 provider 私有参数。[最小 payload](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/openAICompatibleClient.ts#L125-L151)
- 按 SSE frame 读取 `choices[0].delta.content`，要求明确 `[DONE]`；到达 `[DONE]` 即取消 reader，不等待服务商关闭连接。[流解析](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/openAICompatibleClient.ts#L26-L108)；[提前结束实现](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/openAICompatibleClient.ts#L198-L232)
- 错误 body 最多 64 KiB；所有抛出路径对配置中的 API key 做递归脱敏。[错误边界与脱敏](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/openAICompatibleClient.ts#L298-L371)
- 失败原样返回给当前调用方，不自动改走 Codex。Paper Translate 的共享 runtime 已用测试固定这一点。[单路由 runtime](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/runtime.ts#L43-L62)；[无 fallback 测试](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/test/modelRuntime.test.ts#L67-L96)

排除 image data URL、`image_url` capability 错误和 web-search 参数。它们分别服务 Paper Translate 的图片取词和研究任务；本阶段输入是本插件已经持有的论文文本与候选元数据，不存在图片或联网工具请求。[OpenAI Compatible image 分支](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/openAICompatibleClient.ts#L125-L150)；[web search 拒绝分支](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/openAICompatibleClient.ts#L164-L171)

### 4. 连接测试与设置页

设置页应复用 Paper Translate 的 provider cards，而不是在 Reader 内再做一套模型配置：

- provider 可新增、删除、保存；每个 provider 可新增/删除多个 model；只能显式选择已保存模型为当前模型。
- `codex_auth` 只展示 model ID 与 effort；`openai_compatible` 展示 API Base、API key 与 model ID。[provider card UI](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/modules/preferenceWindow.ts#L135-L383)
- “测试”针对 card 中当前草稿 model，不要求先保存；新测试启动前取消旧测试，30 秒超时，设置页卸载时取消全部测试。[连接测试生命周期](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/modules/preferenceWindow.ts#L385-L418)
- Codex 与 OpenAI Compatible 都使用最小 `Reply with exactly OK` 请求。测试只证明认证、endpoint、model ID 与流解析可用，是信息性连接测试；不探测推荐 JSON 能力，也不修改配置。[连接测试路由](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/runtime.ts#L64-L81)；[OpenAI 测试上限](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/openAICompatibleClient.ts#L235-L249)
- Preference Pane 注册、注销、窗口 unload 清理的生命周期可复用，但 addon ID、pane ID、图标、FTL 与 DOM ID 全部改成本插件命名。[Preference Pane 生命周期](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/modules/preferenceWindow.ts#L22-L93)

必须删除原页面的自动翻译、源语言与固定目标语言区域；不得把 `translateSource`、`sourceLanguage`、`targetLanguage` 或 Paper Translate 服务列表带进来。[Paper Translate preferences.xhtml](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/addon/chrome/content/preferences.xhtml#L1-L37)

下载路径、cache 路径与模型设置可以出现在同一个 Reference for Zotero Preference Pane，但它们是三个独立设置区。路径模块不能写进模型配置 JSON，模型模块也不能决定 recommendation cache 的目录；UI 组合由后续 prototype/实现票决定。

## 最小深模块、interface 与 seam

### 推荐应用层的唯一模型 seam

在 recommendation use case 所在的应用层定义：

```ts
export interface RecommendationModelPort {
  complete(
    request: Readonly<{
      instructions: string;
      prompt: string;
      signal: AbortSignal;
    }>,
  ): Promise<
    Readonly<{
      text: string;
      modelIdentity: string;
    }>
  >;
}
```

生产 adapter `ConfiguredTextModel` 每次调用只做一次活动模型快照，然后隐藏以下 implementation：

1. 读取并验证独立模型配置；
2. 形成不含 secret、但含 effort 的 `modelIdentity`；
3. 在 Legacy 与 OpenAI Compatible 两个内部 transport 中选择且只选择一个；
4. 完成认证、刷新、请求、SSE、响应大小限制、取消和错误分类；
5. 返回完整文本，不返回 transport、token、stream event 或 Paper Translate 的 `usedWebSearch`/`citedUrls`。

测试提供一个 in-memory adapter，因此这是一个真实 seam；controller 和推荐协议测试都通过同一 interface，不直接 mock `fetch` 或 `auth.json`。Legacy/OpenAI 两个 transport 是 `ConfiguredTextModel` 内部用于 transport 测试的 internal seam，不应泄漏到 recommendation controller。

这个 interface 有意不包含：

- provider/model/auth/API key 参数：调用方只能使用一次点击时已经选定的活动模型；
- `onDelta`：首版没有逐 token 展示；Reader 只需要“分析中/成功/失败”；
- image、web search、tool、conversation/thread、temperature：本需求都不存在；
- JSON schema：推荐协议负责构造指令、解析和校验结果；transport 只传文本；
- fallback provider：一次调用只有一条可解释路由。

删除该模块会迫使认证、刷新、两种 payload、SSE、错误处理和模型 identity 回流到 controller，所以它具有足够 Depth，而不是 pass-through。

### 设置页的配置模块

设置页只通过一个 `ModelSettings` interface 使用配置模块：

```ts
type ModelSettings = Readonly<{
  read(): ModelProviderConfiguration;
  save(
    providers: readonly ModelProviderGroup[],
    activeModelId: string,
  ): ModelProviderConfiguration;
  select(modelId: string): RuntimeModel;
  testDraft(
    provider: ModelProviderGroup,
    model: ProviderModel,
    signal: AbortSignal,
  ): Promise<string>;
  subscribe(listener: () => void): () => void;
}>;
```

`testDraft` 内部复用同一 transport implementation；不能创建“设置页测试 client”。`select`/`save` 在活动模型的运行配置发生变化时，先调用由 composition root 注入的 `cancelRecommendationAnalysis`，再提交新配置。Paper Translate 已用 `runtimeConfigurationKey` 固定了“哪些字段变化需要取消”的语义，移植时把取消目标替换为推荐分析即可。[运行配置变化判断](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/models/selection.ts#L48-L89)

### 与现有模块的连接位置

本仓库现有 `RelatedPapersController` 已通过 `RelatedPapersPorts` 注入 MinerU、检索、abstract、cache、翻译和下载能力，并用 session token/AbortSignal 阻止旧论文的晚到结果提交。[现有 controller ports](https://github.com/Woif-sha/reference-for-zotro/blob/ca829584668764ffdd3f830fe78f6876623ed90b/src/application/related-papers-controller.ts#L25-L95)；[session 建立](https://github.com/Woif-sha/reference-for-zotro/blob/ca829584668764ffdd3f830fe78f6876623ed90b/src/application/related-papers-controller.ts#L348-L452)

因此推荐分析应沿用这个 seam：

- composition root 创建一个 `ConfiguredTextModel`，以 adapter 形式注入 recommendation use case；
- controller 只把点击时已有的候选快照和当前 session signal 交给 recommendation use case；
- 模型 transport 不读取 Reader state、不重新检索 References/Citations、不加载 abstract，也不解析 `full.md`；
- 当前论文正文是否作为隐式上下文、候选筛选、推荐 JSON schema 和缓存命中由其他第三阶段票据决定，不进入模型 transport。

本仓库 composition root 已集中创建 MinerU、provider、translation 与 cache adapter，新增模型 adapter 也应在同一位置装配，不在 Reader DOM 或平台文件中 `new` transport。[现有 composition root](https://github.com/Woif-sha/reference-for-zotro/blob/ca829584668764ffdd3f830fe78f6876623ed90b/src/composition-root.ts#L72-L108)

## 并发、取消与已知风险

### 必须成立的并发不变量

1. 一次分析开始时快照活动模型；运行中修改 prefs 不得把同一个请求切到另一个模型。
2. 切换模型或修改当前模型的 auth mode、API Base、API key、model 或 effort，必须先取消当前分析，再保存配置。无效草稿不得取消正在运行的分析。
3. 连续点击分析由 recommendation controller 处理：复用有效缓存，或在真正发起新请求前取消旧请求；transport 不维护第二份 Reader generation。
4. Preference Pane 关闭和插件 shutdown 必须取消连接测试；插件 shutdown 还要取消当前分析与活动 auth refresh。[Paper Translate shutdown 清理](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/hooks.ts#L102-L111)
5. 一次 transport 失败必须原样失败，不得自动换 provider、换 model、改 endpoint 或删减 prompt 后重试。

### `auth.json` 的跨插件风险

Paper Translate 的 `authRefreshJobs` 是模块内 `Map`，只能合并同一个插件实例的并发刷新；Reference for Zotero、Paper Translate、llm-for-zotero 各自加载后不会共享这个 `Map`。[刷新 job 定义](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/codex/legacyClient.ts#L73-L84)

双重重读与 rejected-refresh 后采用新 access token 已覆盖大部分跨插件/CLI 竞争，但它不是文件锁。两个插件仍可能同时读取同一个 refresh token、同时通过 compare、随后都发 OAuth 请求；极端时还可能都在任一方写回前完成第二次 compare。首版建议：

- 完整保留 Paper Translate 的 compare-and-adopt 逻辑；
- 使用本插件独有 tmpPath，避免临时文件名冲突；
- 不再复制 llm-for-zotero 的直接覆盖式刷新；
- 不在本阶段引入 OS 文件锁、常驻 broker 或跨插件全局协议；这些会要求同步修改其他插件，超出“独立移植”的范围；
- 将极少数未收敛的 reused/invalid grant 明确显示为 `codex login` 提示，不能静默重试同一个 refresh token。

若实测出现稳定可复现的跨插件刷新冲突，应另开结构性票据，让三个插件共同采用一个共享 refresh coordinator；不能只在 Reference for Zotero 内加第二层循环重试。

## 明确排除的 llm-for-zotero / Paper Translate 能力

| 排除项                                                                                                            | 原因与来源                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex App Server、Claude Code、Copilot、web sync                                                                  | 用户已决定只使用 Legacy 与 OpenAI Compatible；Paper Translate NOTICE 也明确其窄实现不复制这些分支。[Paper Translate NOTICE](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/NOTICE#L35-L48)                                                                                                                                                                                                                                                                   |
| provider preset、protocol inference、model catalog/discovery、provider capability、temperature/reasoning fallback | llm-for-zotero 为通用 Agent 支持多协议；本插件只需固定 Legacy Responses 与 generic Chat Completions。其配置模型同时包含多种 auth mode 与 provider protocol，直接搬运会重建一套无用矩阵。[llm-for-zotero provider 类型](https://github.com/Woif-sha/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/src/utils/modelProviders.ts#L31-L78)；[transport protocol 路由](https://github.com/Woif-sha/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/src/utils/providerTransport.ts#L225-L282) |
| Agent tools、conversation/thread、chat history、MCP、附件上传、PDF/image transport                                | 推荐是一次结构化文本分析，不是通用对话或 Agent 运行时。                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Paper Translate 的 translation backend、translation prompt、自动翻译、source/target language、格式恢复            | 都属于翻译领域，与相关论文排序无关。[翻译模型调用与排版](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/backends/translator.ts#L71-L99)；[翻译专属 prompt 调用](https://github.com/Woif-sha/paper-translate-for-zotero/blob/969f1350a583c45a21303aeba133ab37e488f1af/src/backends/translator.ts#L101-L133)                                                                                                                                               |
| OCR/image selection、图片 input、MinerU 图片 cache                                                                | 本插件第三阶段只分析已有文本信息；模型 adapter 不需要视觉能力。                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| web search、URL citations 与 `requireWebSearch`                                                                   | References/Citations 已由本插件现有检索结果提供，模型不得再次获取候选。                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Paper Translate knowledge/research/context learning cache                                                         | 当前论文正文只是 recommendation protocol 的可选隐式上下文，不能让模型 transport 再学习或维护论文状态。                                                                                                                                                                                                                                                                                                                                                                                                             |
| 模型自动 fallback                                                                                                 | 会让缓存 identity、成本、错误解释和用户选定模型失真；Paper Translate runtime 已明确单路由。                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 建议实现切片与验证

本票只形成规划，不实现代码。后续最小切片按以下顺序，每一步都必须能独立验证：

1. **配置切片**：移植并改名 provider schema、持久化、选择与设置页 cards；验证 fresh default、保存/重开、无效配置显式失败、唯一 active model 和草稿测试不保存。
2. **OpenAI Compatible 切片**：移植文本-only transport；验证 endpoint、最小 payload、SSE `[DONE]`、取消、输出/错误大小限制、API key 不出现在错误中、失败不 fallback。
3. **Legacy 切片**：移植文本-only Legacy client 与全部 auth refresh 测试；验证 401 只刷新一次、同插件并发只刷新一次、CLI 竞争不覆盖、取消后不写、唯一 tmpPath 和 shutdown 清理。
4. **深模块切片**：实现 `ConfiguredTextModel` 与 `RecommendationModelPort`；用 fake adapter 从 recommendation use case interface 测成功、失败、取消和 model identity，不从 controller 直接 mock transport。
5. **生命周期切片**：把 preference registration、分析取消和 auth refresh shutdown 接入 composition root；验证 Reader/session 切换后旧结果不能提交。
6. **来源切片**：更新 `NOTICE`，记录 Paper Translate `969f135...` 的直接移植范围及 llm-for-zotero `d9724df...` 的上游谱系；构建 XPI 后确认源码与许可文件仍随项目公开。

验收时应保留 Paper Translate 已有模型 provider、selection、runtime、OpenAI Compatible、Legacy client 与 Preference Pane 测试的行为覆盖，但测试名称和 fixture 必须改成本插件语义。不要同时保留“移植模块的细粒度旧测试”和穿透其内部的 controller mocks；推荐 use case 只从 `RecommendationModelPort` interface 测试，transport 细节只在模型模块内部测试。

## 本票不决定

- 哪些当前论文正文进入 prompt，以及正文长度预算；
- 只纳入已有 abstract 的候选、Reference/Citation 去重与排序规则；
- “优先看/可选看”JSON schema、prompt 版本和解析失败语义；
- recommendation cache 文件 schema 与命中规则；
- Reader 推荐视图的具体位置和视觉样式；
- 下载路径、cache 路径设置控件的最终布局。

这些问题分别属于分析协议、缓存与 UI prototype 票。本模型模块只保证：用用户明确选择的一个模型，把上层已经准备好的文本发送一次，并返回可验证来源 identity 的完整文本结果。
