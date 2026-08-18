# MinerU Markdown 与 Reference entries 首发契约

## 结论

首发只接受当前 Reader PDF 附件对应的、经过来源校验的 MinerU `full.md`。定位路径固定为：

```text
<Zotero.DataDirectory.dir>/llm-for-zotero-mineru/<当前附件 itemID>/
├── _llm_source.json
├── full.md
└── manifest.json
```

三个文件缺一不可。插件不得读取 `_content.md`、根目录下的旧 `<itemID>.md`，不得调用 `llm-for-zotero`、MinerU、PDF 文本、OCR 或其他来源补救。`manifest.json` 只承担缓存完整性校验；References 章节必须直接从 `full.md` 的 Markdown 标题定位，不能依赖 manifest 的 sections。

这是首发的单一契约，不提供猜测路径、旧格式兼容或静默回退。

## 证据

### 上游缓存格式

`llm-for-zotero` 把缓存根目录命名为 `llm-for-zotero-mineru`，优先使用 Zotero data directory，并以附件数值 item ID 建立子目录；规范 Markdown 文件名为 `full.md`。[源码：缓存根与附件目录](https://github.com/yilewang/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/src/modules/contextPanel/mineruCache.ts#L19-L24) [源码：data directory、根目录和 item 目录](https://github.com/yilewang/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/src/modules/contextPanel/mineruCache.ts#L120-L142)

上游仍能读取旧 `_content.md` 和根目录 `<itemID>.md`，但写入新缓存时会生成 `full.md` 和 manifest，并清理旧文件。这说明旧路径是兼容入口，不是当前缓存契约。[源码：旧路径兼容读取](https://github.com/yilewang/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/src/modules/contextPanel/mineruCache.ts#L1184-L1204) [源码：规范写入与旧文件清理](https://github.com/yilewang/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/src/modules/contextPanel/mineruCache.ts#L1206-L1268)

`_llm_source.json` 的当前 provenance kind 为 `llm-for-zotero/mineru-cache-source`、version 为 `2`，记录附件 ID、附件 key、父条目 key、来源文件名以及 parsed/restored 来源。[源码：provenance schema](https://github.com/yilewang/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/src/modules/contextPanel/mineruCache.ts#L21-L46) [源码：从 Zotero 条目生成 provenance](https://github.com/yilewang/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/src/modules/contextPanel/mineruCache.ts#L1123-L1144)

### 已有消费者的验证方式

`paper-translate-for-zotero` 已实现了符合本项目需求的严格消费者：从 Reader attachment 解析 bibliographic parent，取 live `attachment.id`、`attachment.key` 和 `parent.key`，再构造同一个 MinerU 目录。[源码：Reader 条目身份](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/context/runtime.ts#L1713-L1745) [源码：三文件路径](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/context/runtime.ts#L196-L215)

它把三文件全部缺失与部分缺失分为 `not-generated` 和 `incomplete-cache`，拒绝空 `full.md`，并校验 provenance 与 live Zotero 身份完全一致。[源码：缺失和空文件处理](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/context/runtime.ts#L216-L240) [源码：provenance 校验](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/context/paperContext.ts#L81-L117)

它还校验 manifest 的 `totalChars` 必须等于 JavaScript 字符串的 UTF-16 `length`，并拒绝越界、重叠或乱序 section range；准备期间若三文件发生变化则立即失败。[源码：manifest 完整性](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/context/paperContext.ts#L119-L161) [源码：读取一致性屏障](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/context/runtime.ts#L260-L284)

### References 章节的真实结构

`llm-for-zotero` 的 manifest 构建器只扫描一级标题 `^# heading`。[源码：manifest 标题扫描](https://github.com/yilewang/llm-for-zotero/blob/d9724df84ac053343cf32b00c7829620a243e5b9/src/modules/contextPanel/mineruCache.ts#L1363-L1382) 相比之下，`paper-translate-for-zotero` 在 manifest 无 sections 时会从 `#` 到 `####` 的 Markdown 标题重建 section。[源码：Markdown section 回退](https://github.com/Woif-sha/paper-translate-for-zotero/blob/6bd609ba213d7cd7f1caebd03ff44a02b25cb018/src/context/paperContext.ts#L413-L457)

2026-07-29 对本机 `E:\ZoteroData\llm-for-zotero-mineru` 做了只读、去标识化结构检查，没有记录标题、作者、引文或正文：

- 共 10 个数值附件目录；10 个都具有三文件，provenance kind/version、附件目录 ID、8 位附件 key、8 位父条目 key 及 manifest `totalChars` 均通过结构检查。
- 9 个 `full.md` 含 References；9 个标题均为 `## References`，因此 9 个对应 manifest 的 References section 数均为 0。
- 9 个 References 均以行首 `[n]` 开始条目；其中 5 个存在续行或额外非 marker 行。
- 1 个样本的 marker 遇见顺序为 `1…8, 10, 9`。因此数字标签不能作为排序依据，只有 Markdown 中的字符顺序能代表原始展示顺序。
- 1 个样本没有可识别的 References 标题；不得把全文尾部猜作参考文献。

## 首发读取契约

### 1. 当前论文身份

输入必须是当前 Reader 的附件 item ID：

1. `Zotero.Items.get(itemID)` 必须存在且 `isAttachment()` 为真。
2. 附件必须有 `parentItemID`。
3. 父条目必须存在且不是 attachment。
4. 固定身份快照为 `{ libraryID, parentItemKey, attachmentID, attachmentKey }`。

任一条件不满足，返回 `unsupported-reader-item`，不搜索其他附件。

### 2. 路径与必需文件

只构造：

```text
root = Zotero.DataDirectory.dir
cacheDir = root / "llm-for-zotero-mineru" / String(attachmentID)
```

要求 `_llm_source.json`、`full.md`、`manifest.json` 同时存在。路径必须由已验证的数值 `attachmentID` 构造，不能接受 provenance 或 Markdown 提供的路径片段。

状态：

- 三文件全部不存在：`md-not-generated`，用户文案为“无 MD 文本”。
- 只缺部分文件：`md-cache-incomplete`，列出缺失文件名，但 UI 不展示绝对路径。

### 3. 来源与完整性验证

并行读取三文件后按以下顺序校验：

1. `full.md` 按 UTF-8 解码，`trim()` 后不得为空。
2. provenance 必须是 JSON object。
3. `kind === "llm-for-zotero/mineru-cache-source"`。
4. `version === 2`。
5. `attachmentId === live attachmentID`。
6. `attachmentKey === live attachmentKey`。
7. `parentItemKey === live parentItemKey`。
8. `origin` 只能是 `parsed` 或 `restored`。
9. `recordedAt` 必须存在且能解析为日期。
10. manifest 必须是 JSON object。
11. `manifest.totalChars` 必须是整数，且严格等于 `full.md` 的 JavaScript UTF-16 `length`。
12. 每个 manifest section 的 `charStart/charEnd` 必须为有序、不重叠、在 `full.md.length` 内的整数范围。

校验完成后计算 `full.md` SHA-256，作为本插件解析及联网匹配缓存的内容版本。显示解析结果前重新确认 live Zotero 身份未变；异步联网结果落盘前还必须确认 `{identity, fullMdSha256}` 与任务启动时一致。任何不一致都丢弃旧任务结果并重新加载，不把结果写到另一篇论文。

### 4. References 章节定位

不能使用 `manifest.sections` 查找 References。直接扫描 `full.md`：

```regex
^(#{1,6})[ \t]+(references|reference|bibliography|literature cited)[ \t]*$
```

匹配规则为 Unicode 文本、逐行、忽略大小写，标题两端先 trim。首发不做模糊语义匹配。

- 0 个匹配：`references-heading-missing`。
- 多于 1 个匹配：`references-heading-ambiguous`，不得自行选择。
- 恰好 1 个：section 从标题行结束后开始，到下一个“级别小于或等于当前标题”的 Markdown 标题开始前结束；若没有则到 EOF。
- section 去掉首尾空白后为空：`references-section-empty`。

这样能覆盖样本中的 `## References`，也能正确停止在其后的同级 Appendix、Acknowledgements 等章节。

### 5. Reference entries 拆分

首发支持两种确定性 marker，按行首识别：

```regex
^\s*\[(\d+)\]\s*
^\s*(\d+)[.)]\s+
```

拆分规则：

1. 扫描 section 中的 marker；以首次出现的 marker 风格锁定整段风格。
2. 另一种风格随后出现时返回 `references-marker-mixed`，不拼出不可信列表。
3. 每个 entry 从当前 marker 的字符位置开始，到下一 marker 前结束。
4. marker 后的换行、空行和续行都属于当前 entry；只 trim entry 首尾空白，不改写内部字符。
5. entry 输出：

   ```ts
   type ReferenceEntry = {
     ordinal: number; // Markdown 遇见顺序，从 0 开始
     sourceLabel: string; // marker 中的原始数字文本
     rawMarkdown: string; // 含 marker 的原始切片
     lookupText: string; // 去掉 marker、trim 后的检索文本
     charStart: number; // 相对 full.md
     charEnd: number; // 相对 full.md
   };
   ```

6. UI、缓存和后台检索队列一律按 `ordinal/charStart` 排列；不得按 `sourceLabel` 排序、去重或补号。
7. 重号、跳号和倒序编号不是解析失败；保留原顺序和标签，供调试与用户核对。
8. 首个 marker 前若有非空内容，返回 `references-prefix-unparsed`；最后一个 entry 后的内容归入该 entry，不凭内容猜测页脚。
9. 没有任一支持 marker 时返回 `references-entry-structure-unsupported`。首发不把空行段落猜作独立文献，也不把整节伪装成一条文献。

`rawMarkdown` 是展示与审计的源；联网元数据只能作为该 entry 的附加字段，不能覆盖或删除原始条目。

## 失败契约

所有失败都必须显式，不允许进入 PDF/OCR/全文尾部猜测或网络反向重建 references：

| code                                     | 用户状态                                | 是否允许联网匹配 |
| ---------------------------------------- | --------------------------------------- | ---------------- |
| `md-not-generated`                       | 无 MD 文本                              | 否               |
| `md-cache-incomplete`                    | MinerU MD 缓存不完整                    | 否               |
| `md-cache-invalid`                       | MinerU MD 与当前论文不匹配或已损坏      | 否               |
| `unsupported-reader-item`                | 当前 Reader 条目不是带父条目的附件      | 否               |
| `references-heading-missing`             | MD 中未找到 References 章节             | 否               |
| `references-heading-ambiguous`           | MD 中存在多个 References 章节，无法确定 | 否               |
| `references-section-empty`               | References 章节为空                     | 否               |
| `references-marker-mixed`                | References 编号结构混杂，无法可靠拆分   | 否               |
| `references-prefix-unparsed`             | 首条参考文献前存在无法归属的内容        | 否               |
| `references-entry-structure-unsupported` | References 结构暂不支持逐条解析         | 否               |

开发日志可以记录 code、附件 item ID、文件名和范围；不得记录论文正文、完整 reference 文本或绝对 data directory。UI 不显示绝对路径。

## 复用建议

实现时优先复用 `paper-translate-for-zotero` 的身份解析、三文件要求、provenance 校验、manifest 校验与读取一致性屏障的行为和测试结构，不调用其运行时接口。References 定位必须新写成独立纯函数，因为现有 manifest 无法覆盖真实的二级标题。

若直接复制或改写上游代码，需在实现票据中同时完成许可证兼容与归属检查；本研究只确定行为契约，不作许可证结论。

## 测试样例类别

### 身份与缓存

- Reader item 不存在、不是 attachment、无父条目、父条目异常。
- 三文件全缺、分别缺一个、只存在一个。
- 空白 `full.md`、非 UTF-8、非法 JSON。
- provenance kind/version/origin 错误。
- attachment ID、attachment key、parent key 各自不匹配。
- manifest `totalChars` 按 UTF-16 验证，覆盖 emoji 或非 BMP 字符。
- section 越界、倒序、重叠。
- 读取期间切换 Reader、替换 `full.md` 或变更 provenance/manifest。

### section 定位

- `#` 到 `######` 六级 References 标题，大小写与允许的四种准确名称。
- References 后有更深子标题：仍属于 References。
- References 后有同级或更高标题：正确截断。
- References 为全文末节。
- 无标题、空节、多个准确标题。
- 正文中出现 “references” 单词但不是 Markdown 标题：不得命中。
- manifest 无 References、但 `full.md` 有 `## References`：必须成功。

### entry 拆分与顺序

- `[1]` 单行、多行、空行续写。
- `1.` 与 `1)` 两种数字 marker。
- marker 混用。
- 单条 reference。
- 首 marker 前有非空内容。
- 重号、跳号、`1…8, 10, 9`：输出顺序必须与字符顺序一致。
- marker 内数字很大；只作为 label，不分配同等长度数组。
- 无 marker 的段落式 bibliography：显式返回 unsupported。
- 包含 Markdown emphasis、URL、DOI、反斜杠和 HTML entity：`rawMarkdown` 不改写。

### 禁止回退

- 每一种失败都断言 PDF reader、OCR、MinerU API、`llm-for-zotero` 插件接口及网络 reference 重建调用次数为 0。
- 只有 entries 全部解析成功后，才允许把 `lookupText` 交给后续联网匹配模块。
