/**
 * S5-1 / ADR-0008：门店数据表格壳的列定义类型。
 *
 * 页面只声明"这一列是什么"（字段、标题、宽度、金额/徽章/文本怎么渲染、能不能排序），
 * 排序、筛选、分页、导出、区域选择、复制粘贴这些交互由 `<DataManager>` 统一提供。
 * 新增列表 = 加一份列定义，不再各页手写表格。
 */

export type DataGridTone = "ok" | "wait" | "bad" | "muted";

export interface DataGridColumn<T> {
  /** 数据字段名（必须与后端返回的字段一致）。 */
  key: Extract<keyof T, string>;
  title: string;
  width?: number;
  minWidth?: number;
  /** 金额列：值按**分**（十进制字符串）渲染成 ¥ 两位小数，并在合计行求和。 */
  money?: boolean;
  /** 右对齐（金额/数字）。 */
  numeric?: boolean;
  /** 固定列（横向滚动时不跟着走）；表头会带「🔒固定」提示与浅灰底。 */
  frozen?: boolean;
  /**
   * 允许点击表头做**服务端**排序；默认允许。
   * 注意：列必须落在后端排序白名单里，否则点击会 400——不在白名单的列请显式写 `false`。
   */
  sortable?: boolean;
  /** 值 → 徽章（状态列用）。 */
  badge?: (
    value: unknown,
    row: T,
  ) => { label: string; tone: DataGridTone } | null;
  /** 值 → 展示文本（默认直接显示原值，空值显示 "—"）。 */
  text?: (value: unknown, row: T) => string;
  /**
   * 第二行文本（设计稿：创建时间合成一列两行，第一行创建、第二行"支付 …"）。
   * 传了它，单元格就渲染成上下两行。
   */
  subtext?: (value: unknown, row: T) => string;
  /** 等宽字体（支付单号这类机器码）；金额列已自带等宽。 */
  mono?: boolean;
  /**
   * 表头显示漏斗图标（设计稿的"按此列筛选"入口）。
   * S5-2 之前只是标示，不做假的筛选动作。
   */
  filterHint?: boolean;
}

/** 行动作（表格最右侧「操作」列里的一个动作）。 */
export interface DataGridRowAction<T> {
  key: string;
  label: string;
  /** 点这一行的动作；由页面自己决定做什么（例如把支付单号填进退款表单）。 */
  onClick: (row: T) => void;
  /** 只有满足条件的行才给入口；不满足的行显示 "—"。 */
  when?: (row: T) => boolean;
}

export interface DataGridFilterOption {
  value: string;
  label: string;
}

export interface DataGridPage<T> {
  rows: T[];
  /** 同一筛选条件下的总行数。 */
  total: number;
  page: number;
  pageSize: number;
}

export interface DataManagerProps<T> {
  /** 列表资源路径，例如 `/api/v1/tenant/payments/orders`。 */
  resource: string;
  columns: readonly DataGridColumn<T>[];
  /** 行动作：非空时表格最右侧多一列「操作」（标题默认「操作」）。 */
  actions?: readonly DataGridRowAction<T>[];
  actionTitle?: string;
  /** 服务端筛选器（参数名 + 选项），第一项为空值表示"全部"。 */
  statusParam?: string;
  statusOptions?: readonly DataGridFilterOption[];
  searchPlaceholder?: string;
  pageSize?: number;
  height?: number | string;
  /** 服务端 CSV 导出路径（不传则不显示导出按钮）。 */
  exportPath?: string;
  exportFileName?: string;
  emptyHint?: string;
}
