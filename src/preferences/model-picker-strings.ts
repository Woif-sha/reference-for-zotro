const labels = {
  "pref-provider-model-select": "选择模型",
  "pref-provider-model-custom": "自定义模型…",
  "pref-provider-models-refresh": "刷新模型",
  "pref-provider-models-show-all": "显示全部",
  "pref-provider-models-fetching": "正在获取模型列表…",
  "pref-provider-models-fetch-failed": "获取模型失败，可手动添加",
  "pref-provider-models-hidden": "已隐藏 {count} 个专用模型",
  "pref-provider-models-total": "共 {count} 个模型",
  "pref-provider-models-choose": "选择模型",
  "pref-provider-models-choose-hint":
    "按接口时间从新到旧，无时间按型号排序。勾选后添加，再保存服务商。",
  "pref-provider-models-search": "搜索模型名称或 ID",
  "pref-provider-models-add-selected": "添加所选（{count}）",
  "pref-provider-model-already-added": "已添加",
  "pref-provider-models-no-match": "没有匹配的模型",
  "pref-provider-models-no-match-filtered":
    "没有匹配的模型，可开启“显示全部”查看。",
  "pref-provider-models-hidden-cleared": "已取消勾选被隐藏的模型。",
  "pref-provider-models-cancel": "取消",
};

export function getString(
  key: keyof typeof labels,
  options?: { args: { count: number } },
): string {
  return labels[key].replace("{count}", String(options?.args.count ?? ""));
}
