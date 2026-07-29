# Zotero 9 插件架构与三仓代码复用边界

## 研究问题

在 Zotero 9.0.6 目标下，判断以下三个上游仓库中哪些代码和设计可以直接复用，哪些必须移植或重写，并确认 Reader UI 注入与跨插件翻译的可靠入口：

- [`MuiseDestiny/zotero-reference`](https://github.com/MuiseDestiny/zotero-reference/tree/4a64b65a3ad18e2d98dc2aaad93dffa8f03fde27)
- [`Woif-sha/paper-translate-for-zotero`](https://github.com/Woif-sha/paper-translate-for-zotero/tree/6bd609ba213d7cd7f1caebd03ff44a02b25cb018)
- [`yilewang/llm-for-zotero`](https://github.com/yilewang/llm-for-zotero/tree/d9724df84ac053343cf32b00c7829620a243e5b9)

研究同时以 Zotero 9.0.6 标签源码和 Zotero 官方开发文档为准。结论针对首发仅支持 Zotero 9.0.6/9.0.x、只读取已有 MinerU Markdown、插件可独立加载且翻译功能按依赖显式降级的既定范围。

## 结论

采用一个新的、独立的 Zotero 9 bootstrapped 插件，以 `paper-translate-for-zotero` 的现代脚手架和生命周期管理为工程基线；在 Reader 右侧用 Zotero 9 原生 `Zotero.ItemPaneManager.registerSection()` 注册一个 section，并在 section 内实现 `References` / `Citations` 两个 HTML 标签页。不要移植旧 `zotero-reference` 的 `ReaderTabPanel` 注入层，也不要访问 Reader 的 `_iframeWindow`、`_itemID` 等私有字段。

新插件通过一个只读 `MineruCacheAdapter` 直接读取 Zotero 数据目录中的现有缓存：

```text
<Zotero.DataDirectory.dir>/
└── llm-for-zotero-mineru/
    └── <attachmentItemID>/
        ├── _llm_source.json
        ├── full.md
        └── manifest.json
```

读取前必须用 `_llm_source.json` 的 `attachmentId`、`attachmentKey` 和（若存在）`parentItemKey` 校验当前 Reader 附件，之后只从 `full.md` 的 References 章节提取条目。缺少文件、来源不匹配或正文为空都作为明确的“无 MD 文本”状态，不调用 `llm-for-zotero`、不读取 PDF、不触发 MinerU、不做 OCR。

翻译优先通过 `Zotero.PaperTranslate.api.translate(text, { pluginID, itemID })` 调用 `paper-translate-for-zotero`。该 API 是有意暴露的跨插件入口，但当前没有独立类型包、README 契约或跨插件兼容测试，因此必须包在本插件自己的 `TranslationBridge` 后，启动和每次调用时做能力检测，并把“插件未安装 / API 不兼容”显示为功能不可用；不能让它阻止 References/Citations 加载。划词发生在本插件的 Item Pane HTML 中，`paper-translate-for-zotero` 自带的 PDF Reader 选择监听器不会接管，因此本插件仍需实现最小选择监听和译文浮层，只复用翻译执行与模型/auth 配置。

若要最大限度复制三个 AGPL 仓库中的实现代码，新插件应采用 `AGPL-3.0-or-later` 并保留来源与修改说明；否则只能复用接口事实和设计思想，对代码做独立实现。

## 证据与复用判断

### 1. Zotero 9 Reader UI：使用 `ItemPaneManager`，不移植 `ReaderTabPanel`

Zotero 7 起插件必须使用 `manifest.json` 和 bootstrapped 生命周期；插件可以在不重启 Zotero 的情况下禁用或卸载，因此 `shutdown()` 必须移除注册项和运行中任务。Zotero 官方文档还要求 `strict_max_version` 只声明到实际测试过的最新小版本。[Zotero 7 for Developers：manifest、bootstrap 与清理要求](https://www.zotero.org/support/dev/zotero_7_for_developers#plugin_changes)

Zotero 8/9 所在的新 Mozilla 平台已移除多项旧接口，包括全局 JSM 导入和 Bluebird Promise；官方建议优先使用新的插件 API，而不是手工注入 UI。[Zotero 8 for Developers：平台变化](https://www.zotero.org/support/dev/zotero_8_for_developers#platform_changes)

Zotero 9.0.6 源码中的 `ItemPaneManager` 是正式插件 API。`registerSection()` 接受 `paneID`、`pluginID`、header/sidenav、`onInit`、`onDestroy`、`onItemChange`、`onRender`、`onAsyncRender` 和 section buttons，并提供对应的 `unregisterSection()`；回调参数直接包含当前 `item`、`tabType`、section `body` 和 `setEnabled()`。[Zotero 9.0.6 `itemPaneManager.js`](https://github.com/zotero/zotero/blob/9.0.6/chrome/content/zotero/xpcom/pluginAPI/itemPaneManager.js#L31-L280)

`paper-translate-for-zotero` 已在 Zotero 9 目标代码中验证了正确模式：注册 section，在 `tabType === "reader"` 时启用，基于回调中的 item 绑定附件，在 `onDestroy` 中取消该附件任务，并在关闭插件时调用 `unregisterSection()`。[`paper-translate-for-zotero` Reader sidebar](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/modules/sidebar.ts#L62-L126)

相反，旧 `zotero-reference`：

- manifest 只声明 `strict_max_version: 7.0.*`；[`manifest.json`](https://github.com/MuiseDestiny/zotero-reference/blob/4a64b65a3ad18e2d98dc2aaad93dffa8f03fde27/addon/manifest.json#L1-L20)
- 依赖 `zotero-plugin-toolkit` 2.2.6；[`package.json`](https://github.com/MuiseDestiny/zotero-reference/blob/4a64b65a3ad18e2d98dc2aaad93dffa8f03fde27/package.json#L35-L65)
- 用 toolkit 的 `ReaderTabPanel.register()` 注入 XUL/HTML，并使用 `reader._instanceID`、`reader._itemID`、`reader._iframeWindow.wrappedJSObject` 等私有字段；[`views.ts`](https://github.com/MuiseDestiny/zotero-reference/blob/4a64b65a3ad18e2d98dc2aaad93dffa8f03fde27/src/modules/views.ts#L29-L225)
- 在启动时全局改写 `ProgressWindow.prototype.show`，扩大了与其他插件冲突的范围。[`hooks.ts`](https://github.com/MuiseDestiny/zotero-reference/blob/4a64b65a3ad18e2d98dc2aaad93dffa8f03fde27/src/hooks.ts#L11-L31)

因此，旧项目的注入层、生命周期和全局 patch 都必须放弃。可复用的是交互语义和数据展示概念：参考文献逐条列表、Ctrl/Meta+单击打开链接、鼠标进入延时展示 metadata card、异步补全信息后更新卡片。[旧项目 Ctrl+单击逻辑](https://github.com/MuiseDestiny/zotero-reference/blob/4a64b65a3ad18e2d98dc2aaad93dffa8f03fde27/src/modules/views.ts#L776-L856)；[旧项目悬浮卡逻辑](https://github.com/MuiseDestiny/zotero-reference/blob/4a64b65a3ad18e2d98dc2aaad93dffa8f03fde27/src/modules/views.ts#L634-L775)

### 2. 插件骨架：复用现代 scaffold 形态，不复制业务巨石

`paper-translate-for-zotero` 和 `llm-for-zotero` 均采用 `manifest.json + bootstrap.js + TypeScript + zotero-plugin-scaffold + zotero-plugin-toolkit 5.x`。两者的 bootstrap 都在 `startup()` 注册 chrome 资源、加载单一 bundle，并把主实例放到 `Zotero[addonInstance]`；shutdown 反注册资源。[`paper-translate-for-zotero` bootstrap](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/addon/bootstrap.js#L1-L67)；[`llm-for-zotero` bootstrap](https://github.com/yilewang/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/addon/bootstrap.js#L1-L62)

推荐从 `paper-translate-for-zotero` 复制并改名以下工程骨架：

- `addon/bootstrap.js`、`addon/manifest.json`、`addon/prefs.js`；
- `zotero-plugin.config.ts` 的构建配置；
- `src/index.ts` / `src/addon.ts` 的单实例和生命周期分层；
- Fluent 本地化、preferences 注册和 `createZToolkit()` 的最小封装；
- CI 中的测试、类型检查、格式、lint、依赖审计、XPI 解包校验与敏感/开发文件 deny-list。

该 CI 已明确拒绝把 `docs`、`output`、`test(s)`、`node_modules`、`auth.json` 和 `.env*` 打进 XPI，并校验 manifest 的插件 ID、版本和 update URL。[`paper-translate-for-zotero` CI](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/.github/workflows/ci.yml#L1-L72)

不要复制 `paper-translate-for-zotero` 的 context learning、OCR、模型供应商配置和翻译队列实现，也不要复制 `llm-for-zotero` 的 chat/agent/同步功能。它们不是 References/Citations 的职责，会形成第二套 auth、MinerU 和上下文状态。

首发 manifest 推荐：

```json
{
  "applications": {
    "zotero": {
      "strict_min_version": "9.0.6",
      "strict_max_version": "9.0.*"
    }
  }
}
```

这准确表达“以本机 9.0.6 为最低实测基线，只承诺 9.0.x”；后续每个 Zotero 小版本实测后再扩大范围。

### 3. MinerU：复用文件契约和校验规则，不运行 `llm-for-zotero` 内部模块

`llm-for-zotero` 的当前 MinerU 根目录是 `Zotero.DataDirectory.dir/llm-for-zotero-mineru`，当前附件目录以 Zotero attachment item ID 命名，标准 Markdown 文件是 `full.md`；代码仍兼容 `_content.md` 和单文件 `<id>.md` 旧路径。[`mineruCache.ts` 路径定义与读取顺序](https://github.com/yilewang/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/src/modules/contextPanel/mineruCache.ts#L16-L149)；[`readCachedMineruMd()`](https://github.com/yilewang/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/src/modules/contextPanel/mineruCache.ts#L1184-L1205)

当前来源证明文件 `_llm_source.json` 的 schema 版本为 2，记录 `attachmentId`、`attachmentKey`、`parentItemKey`、源文件名、生成/恢复来源和时间、缓存内容 hash 等。[`MineruSourceProvenance`](https://github.com/yilewang/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/src/modules/contextPanel/mineruCache.ts#L18-L55)；[来源文件构建与读取](https://github.com/yilewang/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/src/modules/contextPanel/mineruCache.ts#L1030-L1181)

`paper-translate-for-zotero` 已经独立实现了消费者侧的正确读取方式：从当前 attachment ID 计算目录，同时要求 `_llm_source.json`、`full.md`、`manifest.json` 存在，正文非空，并核对当前 Zotero attachment/parent identity；找不到时抛出明确的 MinerU Markdown unavailable 状态。[`preparePaperContext()` 的只读解析入口](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/context/runtime.ts#L194-L274)；[来源身份校验](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/context/runtime.ts#L1660-L1739)

新插件应从这段消费者逻辑提取一个更小的只读适配器，而不是导入 `llm-for-zotero` 的内部 TypeScript 模块：

```ts
interface MineruCacheAdapter {
  readForAttachment(attachment: Zotero.Item): Promise<{
    fullMd: string;
    manifest?: MineruManifest;
    source: MineruSourceProvenance;
    sourceFingerprint: string;
  }>;
}
```

边界规则：

1. 首发只认当前标准目录和 `full.md`，不采用上游的 legacy `_content.md` / `<id>.md` 回退，因为产品要求是“已有 MinerU MD”，且静默兼容旧缓存会增加第二套来源规则。
2. `_llm_source.json` 必须存在且与当前附件匹配；不能仅因 `<attachmentID>/full.md` 存在就信任。
3. `manifest.json` 可用于精确定位 References 章节，但它缺失或没有章节索引时，可以在已经验证的 `full.md` 内做标题扫描；这仍然是同一个 MD 数据源，不是 PDF/OCR 回退。
4. 新插件对 `llm-for-zotero` 零运行时调用；它是否已启用不影响读取已存在且验证通过的缓存。
5. 新插件自己的联网匹配结果放入独立版本化缓存，不能写入或改动 `llm-for-zotero-mineru`。

### 4. 翻译：存在明确入口，但要用适配器隔离契约风险

`paper-translate-for-zotero` 把插件实例公开为 `Zotero.PaperTranslate`，实例的 `api` 属性引用 `src/api.ts`。[`package.json` 中的 `addonInstance`](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/package.json#L1-L13)；[`src/index.ts` 全局注册](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/index.ts#L1-L24)；[`Addon.api`](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/addon.ts#L1-L58)

公开的 `api.translate()`：

- 要求调用方传入 `pluginID` 和当前 Reader attachment `itemID`；
- 固定翻译目标语言；
- 复用插件现有的 model/auth/context translation service；
- 以 `noDisplay: true` 执行并返回包含 `status`、`result` 等字段的 `TranslateTask`；
- 同时提供 `getVersion()` 和 `getServices()` 供能力探测。

参见 [`src/api.ts`](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/api.ts#L1-L74)。

所以跨插件翻译在代码层面可行，建议实现：

```ts
interface TranslationBridge {
  isAvailable(): boolean;
  translate(text: string, attachmentItemID: number): Promise<string>;
}

// 能力探测，而不是硬依赖或直接访问内部 data/services
const api = (Zotero as any).PaperTranslate?.api;
if (typeof api?.translate !== "function" ||
    typeof api?.getVersion !== "function") {
  // 在划词浮层中显示“请安装或更新 Paper Translate”
}
```

不要直接使用 `Zotero.PaperTranslate.data.translate.services`，也不要复制 auth.json、OpenAI-compatible client 或 task queue；这些是内部实现而非公开 API。

必须由新插件实现划词 UI。`paper-translate-for-zotero` 只监听 Zotero Reader 的 `renderTextSelectionPopup`，输入来自 PDF annotation selection；它不会收到另一个插件 section DOM 中的 `Selection`。[Reader selection listener](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/modules/reader.ts#L1-L31) 此外 `api.translate()` 明确使用 `noDisplay: true`，因此调用者必须显示返回结果。

“稳定”的限定：入口是有意发布的 API，而非偶然访问私有字段，且从首个公开版本延续至 1.4.0；但仓库尚未提供外部 TypeScript 类型包、README API 文档或跨插件契约测试。首发应把 `paper-translate-for-zotero >= 1.4.0` 作为已验证版本，通过 `getVersion()` 检测；低版本或形状不符时显式禁用翻译。后续建议在两个仓库间增加一个最小 contract test 或导出的 `.d.ts`。

### 5. 状态、并发与缓存：复用模式，不共用存储

旧 `zotero-reference` 的 `LocalStorage` 用单个 JSON、`item.key` 和延迟写入保存任意结构，读写没有 schema、版本、原子更新或跨 Reader 任务隔离，不适合作为新插件缓存。[`localStorage.ts`](https://github.com/MuiseDestiny/zotero-reference/blob/4a64b65a3ad18e2d98dc2aaad93dffa8f03fde27/src/modules/localStorage.ts#L1-L43)

可复用 `paper-translate-for-zotero` 的状态组织模式：活动 body 用集合追踪，异步 job/error/context 按 attachment ID 分桶；item 切换和 section destroy 时取消不再使用的任务；异步结果提交前再次核对 attachment identity / source hash，避免旧请求污染新论文。[sidebar 的活动 body 与 per-item maps](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/modules/sidebar.ts#L31-L126)；[上下文变更校验](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/context/runtime.ts#L1240-L1310)

推荐状态分层：

- `ReaderSectionController`：只处理 Zotero section 生命周期和标签切换；
- `PaperSessionStore`：按 `libraryID:attachmentKey` 保存当前 `sourceFingerprint`、references、citations、loading/error；
- `MineruCacheAdapter`：只读、验证并返回 MD；
- `ReferenceParser`：纯函数，从已验证 MD 生成保留原顺序的原始条目；
- `ReferenceResolver` / `CitationProvider`：独立的可取消后台服务；
- `TranslationBridge`：唯一跨插件边界；
- `PluginCacheRepository`：新插件自己的版本化磁盘缓存。

每次切换论文或手动刷新都递增 session generation 并取消前一代 `AbortController`。网络结果写回前必须同时匹配 attachment key、source fingerprint 和 generation。缓存 key 至少包括 `libraryID`、`attachmentKey`、`sourceFingerprint`、resolver/provider schema version；这样 MinerU `full.md` 更新后不会沿用旧匹配。

## 单一推荐架构

```text
Zotero 9.0.6 Reader
        │
        ▼
Zotero.ItemPaneManager.registerSection
        │
        ▼
ReaderSectionController
  ├── References tab
  └── Citations tab
        │
        ▼
PaperSessionStore (attachment identity + generation)
  ├── MineruCacheAdapter ──read only──> llm-for-zotero-mineru/<id>/
  ├── ReferenceParser
  ├── ReferenceResolver ──────────────> institution-authenticated web source
  ├── CitationProvider ───────────────> institution-authenticated web source
  ├── PluginCacheRepository ──────────> plugin-owned versioned cache
  └── TranslationBridge ──optional───> Zotero.PaperTranslate.api.translate
```

依赖方向必须是 UI → application services → narrow adapters。业务模型和解析器不得 hard-import Zotero、`llm-for-zotero` 或 `paper-translate-for-zotero` 的具体内部模块，Zotero/文件系统/网络/翻译都通过参数或接口注入，以便单元测试。

## 可直接复用、可移植、必须重写

| 来源 | 直接复用 | 按模式移植 | 必须重写或放弃 |
| --- | --- | --- | --- |
| `paper-translate-for-zotero` | scaffold/bootstrap/config、Fluent/preferences 基础、CI XPI 安全检查；运行时调用 `Zotero.PaperTranslate.api.translate` | `ItemPaneManager` lifecycle、per-attachment job/state、MinerU 来源验证 | context learning、OCR、auth/model clients、内部 queue、原有 popup/sidebar UI |
| `llm-for-zotero` | 只把现有磁盘格式当作外部只读契约 | `_llm_source.json` schema、`full.md`/manifest 路径和身份验证 | MinerU 调度、cache 写入/迁移/同步、chat/agent、PDF fallback |
| `zotero-reference` | UI/交互语义和 metadata card 信息层级 | reference view model、Ctrl/Meta+click 与 hover 延时的行为 | `ReaderTabPanel`、XUL tree、私有 Reader 字段、PDF extraction、旧 API provider 聚合、LocalStorage、全局 prototype patch |
| Zotero 9.0.6 | `ItemPaneManager`、Reader lifecycle、`Zotero.launchURL`、`Zotero.DataDirectory.dir` | 无 | DOM/iframe 私有实现不作为契约 |

## 风险

1. **Zotero 9 API 漂移**：`ItemPaneManager` 是正式 API，但 9.1+ 未测试。manifest 先限制为 `9.0.*`，扩大兼容范围前做真实 Reader smoke test。
2. **MinerU 磁盘格式不是公开跨插件 API**：上游可能改变目录或 schema。把所有知识集中在一个 adapter，并使用 `_llm_source.json.version` 明确拒绝未知主版本；不要在 UI/业务代码散布路径。
3. **附件 ID 可变化或目录残留**：必须同时校验 numeric ID 和稳定 attachment key/parent key，不能只按目录名读取。
4. **翻译 API 仍缺契约制品**：使用 `getVersion()` + function shape 检查，将支持矩阵固定到实测版本；失败只影响翻译。
5. **另一个插件 section 内的选择事件**：不能期待 `renderTextSelectionPopup` 自动工作；必须验证 Zotero Item Pane 中 `mouseup`/`Selection`、浮层定位、复制和 Ctrl+click 不冲突。
6. **旧代码许可证**：三个上游均标为 AGPL-3.0-or-later。复制实现时需采用兼容许可证并保留 NOTICE；若不接受该边界，应停止复制，只做 clean-room 实现。
7. **异步竞态与请求风暴**：论文可能有上百条 references。列表先显示原文，resolver 限流；切换附件时取消；缓存写入前核对 generation/source fingerprint。
8. **样式隔离**：旧项目使用通用 `.box`、`.grid`、`#reference-label` 等名字。新 UI 必须全量 namespace，样式限定在插件 section 根节点，避免污染 Zotero 和其他插件。

## 后续必须实机验证

以下问题不能仅靠静态源码确认，应在后续 prototype/实现票据中作为硬验收：

1. 在本机 Zotero 9.0.6 中，单个 `ItemPaneManager` section 的内部双标签、滚动、宽度变化和亮色主题表现。
2. Reader 回调传入 parent item 时，解析当前 attachment 的路径是否覆盖独立附件、无 parent 附件和多 PDF parent 三种情况。
3. 已安装 `paper-translate-for-zotero` 1.4.0 时，从本插件 section 选中文本调用 `api.translate()` 并显示结果；插件缺失、禁用、版本过低和运行中卸载时均只显式禁用翻译。
4. `_llm_source.json` 与当前附件匹配、错配、缺失，以及 `full.md` 空/缺失、manifest 缺失等 fixture。
5. section 销毁、Reader tab 切换和快速切换论文时，旧解析/网络/翻译结果不会写入新论文。
6. 构建 XPI 解包后不含 `auth.json`、`.env*`、本地 Zotero 数据路径、缓存、测试数据、docs、IDE 文件或上游仓库副本。

## 对实现票据的约束

- 不在本研究票据开始产品实现。
- 第一个 prototype 应只打通：原生 Reader section → 当前 attachment identity → 验证并读取 `full.md` → References 原文列表。
- 翻译 prototype 独立验证 `Zotero.PaperTranslate.api.translate` 和本插件浮层，不复制翻译后端。
- institution-authenticated References/Citations 查询的网络方案由专门研究票据决定；本架构只为其预留 adapter，不预设 IEEE/ACM 的具体抓取方式。
