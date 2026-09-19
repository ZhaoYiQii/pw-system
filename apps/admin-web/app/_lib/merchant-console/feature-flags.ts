"use client";

/**
 * S5：租户级功能开关的前端读取（与后端同一个 addon key）。
 *
 * 语义与后端一致：**未开通即关闭**（opt-in）。未加载完成时按"未开通"处理，
 * 避免先渲染 v2 入口再被 403 打回（保守优先）。
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";

export const GAME_DISPATCH_TEMPLATE_V2_FEATURE =
  "addon.game_dispatch_template_v2";

export interface TenantFeatureRow {
  featureKey: string;
  enabled: boolean;
  core?: boolean;
}

/** 纯函数：给定能力位列表，判断 v2 是否开通。 */
export function isTemplateV2Enabled(
  rows: TenantFeatureRow[] | undefined,
): boolean {
  if (rows === undefined) return false;
  return rows.some(
    (row) =>
      row.featureKey === GAME_DISPATCH_TEMPLATE_V2_FEATURE && row.enabled,
  );
}

/** 读取当前门店的能力位；ready=false 表示还没拿到结果。 */
export function useTemplateV2Feature(): { enabled: boolean; ready: boolean } {
  const query = useQuery({
    queryKey: ["tenant-features"],
    queryFn: () => apiFetch<TenantFeatureRow[]>("/api/v1/tenant/features"),
    staleTime: 60_000,
  });
  return {
    enabled: isTemplateV2Enabled(query.data),
    ready: !query.isPending && !query.isError,
  };
}
