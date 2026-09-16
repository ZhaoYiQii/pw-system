/**
 * S4 订单文案面板的纯逻辑（不依赖 React）。
 *
 * 边界：文案全部来自订单自身快照（服务端返回的 document）；旧订单没有 v2 文案时
 * 回退到历史 copyText，不做任何前端拼装或模板猜测。
 */
export interface OrderDocumentView {
  schemaVersion: number;
  rendererVersion: number;
  rows: { sectionLabel: string; fieldLabel: string; value: string }[];
  plainText: string;
  generatedFromSnapshotAt: string;
}

/** 复制按钮要复制的内容：优先 v2 文案，其次历史文案。 */
export function orderDocumentCopyPayload(
  document: OrderDocumentView | null,
  fallbackText: string,
): string {
  if (document !== null && document.plainText.trim() !== "") {
    return document.plainText;
  }
  return fallbackText;
}

/** 是否有结构化行可供展示（旧订单没有）。 */
export function hasStructuredRows(document: OrderDocumentView | null): boolean {
  return document !== null && document.rows.length > 0;
}

/** 面板标题下方的来源说明。 */
export function orderDocumentSourceLabel(
  document: OrderDocumentView | null,
): string {
  return document === null
    ? "历史订单：显示旧文案，不包含结构化表格"
    : `按订单快照生成（渲染器 v${document.rendererVersion}）`;
}
