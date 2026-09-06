export type RuntimeKind = "h5" | "weapp";

export interface RuntimeInfo {
  kind: RuntimeKind;
  /** 适配实现标记，用于构建产物隔离验证（H5 产物不得含 weapp 标记，反之亦然）。 */
  label: string;
}
