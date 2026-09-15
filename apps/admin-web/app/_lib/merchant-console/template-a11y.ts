/**
 * 键盘与无障碍的纯逻辑契约（S3 Task 6）。
 *
 * 为什么单独成模块：把"顺序不变量""焦点去哪""播报什么"变成可测函数，
 * 界面只消费结果，避免这些规则散落在 JSX 里无法验证。
 */
import type { DraftConfigV2 } from "./template-draft-state";

export type MoveDirection = "up" | "down";
export type FocusTargetKind = "section" | "component";

/**
 * 顺序不变量：组件数组顺序必须等于逻辑顺序（区块按 sortOrder、区块内按 sortOrder），
 * 且同一区块内的 sortOrder 从 0 连续编号。
 * 键盘上下移动的可预期性完全依赖这个不变量。
 */
export function componentOrderIsStable(config: DraftConfigV2): boolean {
  const sections = [...config.sections].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  let cursor = 0;
  for (const section of sections) {
    const inSection = config.components.filter(
      (component) => component.sectionKey === section.stableKey,
    );
    if (inSection.length === 0) continue;
    for (const [index, component] of inSection.entries()) {
      if (config.components[cursor]?.stableKey !== component.stableKey)
        return false;
      if (component.sortOrder !== index) return false;
      cursor += 1;
    }
  }
  return cursor === config.components.length;
}

/** 键盘移动后应该回到的按钮选择器（保持焦点不跳到页面顶部）。 */
export function focusSelectorAfterMove(
  kind: FocusTargetKind,
  stableKey: string,
  direction: MoveDirection,
): string {
  const attribute =
    kind === "section" ? "data-section-key" : "data-component-key";
  return `[${attribute}="${stableKey}"] button[data-action="move-${direction}"]`;
}

/** 供 aria-live 播报的顺序变化文案（1-based 位次，方便读屏）。 */
export function announceOrderChange(
  items: ReadonlyArray<{ stableKey: string; label: string }>,
  stableKey: string,
  direction: MoveDirection,
): string {
  const index = items.findIndex((item) => item.stableKey === stableKey);
  const label = items[index]?.label ?? "内容";
  // 播报"移动之后的位次"：上移 = 当前 0-based index，下移 = index + 2
  const position = index < 0 ? 0 : direction === "up" ? index : index + 2;
  return `已把「${label}」${direction === "up" ? "上移" : "下移"}到第 ${position} 位`;
}

/** 供 aria-live 播报的问题定位文案。 */
export function announceIssue(issue: {
  code: string;
  tab: "content" | "binding";
  sectionKey?: string;
  componentKey?: string;
  message: string;
}): string {
  const where = issue.componentKey
    ? `组件 ${issue.componentKey}`
    : issue.sectionKey
      ? `区块 ${issue.sectionKey}`
      : issue.tab === "binding"
        ? "业务绑定"
        : "内容设计";
  return `已定位到${where}：${issue.message}`;
}
