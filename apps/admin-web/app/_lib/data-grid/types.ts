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
  /** 固定在左侧（横向滚动时不跟着走）。 */
  frozen?: boolean;
  /** 允许点击表头做**服务端**排序；默认允许（列自身必须属于后端排序白名单）。 */
  sortable?: boolean;
  /** 值 → 徽章（状态列用）。 */
  badge?: (
    value: unknown,
    row: T,
  ) => { label: string; tone: DataGridTone } | null;
  /** 值 → 展示文本（默认直接显示原值，空值显示 "—"）。 */
  text?: (value: unknown, row: T) => string;
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
