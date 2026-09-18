/**
 * 通用派单模板 v2 的租户级功能开关（S5）。
 *
 * 取值必须与 `apps/api/src/modules/entitlements/domain/features.ts` 的 addon 目录一致；
 * 语义与其他 addon 相同：**未开通即关闭**（opt-in）。因此：
 * - 上线时所有租户默认关闭，按 runbook 逐步开通；
 * - 回退时把该租户置为 false 即可停用 v2 入口，不删除草稿/版本/订单快照。
 */
export const GAME_DISPATCH_TEMPLATE_V2_FEATURE =
  "addon.game_dispatch_template_v2" as const;
