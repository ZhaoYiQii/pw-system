/**
 * 算价模型（商家端）接口封装：加价规则库 + 陪玩×游戏底价。
 * 走既有 apiFetch（自动带 Bearer、解包 { data }、401 清 token）。
 */
import { ApiError, apiFetch } from "../api";

export interface GamePricingRuleItemView {
  id: string;
  kind: "SURCHARGE" | "FIXED";
  dimensionKey: string;
  amountFen: string;
  sortOrder: number;
}

export interface GamePricingRuleView {
  gameId: string;
  enabled: boolean;
  items: GamePricingRuleItemView[];
  updatedAt: string | null;
}

export interface PlayerGameBaseView {
  playerId: string;
  gameId: string;
  basePricePerHourFen: string | null;
  fallbackBasePricePerHourFen: string | null;
  status: "ACTIVE" | "INACTIVE" | null;
}

export interface SaveGamePricingRuleBody {
  enabled?: boolean;
  items: {
    kind: "SURCHARGE" | "FIXED";
    dimensionKey: string;
    amountFen: string;
    sortOrder?: number;
  }[];
}

export interface SavePlayerGameBaseBody {
  basePricePerHourFen: string;
  status?: "ACTIVE" | "INACTIVE";
}

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

export async function fetchGamePricingRule(
  gameId: string,
): Promise<GamePricingRuleView> {
  return apiFetch<GamePricingRuleView>(
    `/api/v1/tenant/game-pricing/games/${encodeId(gameId)}`,
  );
}

export async function saveGamePricingRule(
  gameId: string,
  body: SaveGamePricingRuleBody,
): Promise<GamePricingRuleView> {
  return apiFetch<GamePricingRuleView>(
    `/api/v1/tenant/game-pricing/games/${encodeId(gameId)}`,
    { method: "PUT", body: JSON.stringify(body) },
  );
}

export async function fetchPlayerGameBase(
  playerId: string,
  gameId: string,
): Promise<PlayerGameBaseView> {
  return apiFetch<PlayerGameBaseView>(
    `/api/v1/tenant/game-pricing/players/${encodeId(playerId)}/games/${encodeId(gameId)}/base`,
  );
}

export async function savePlayerGameBase(
  playerId: string,
  gameId: string,
  body: SavePlayerGameBaseBody,
): Promise<PlayerGameBaseView> {
  return apiFetch<PlayerGameBaseView>(
    `/api/v1/tenant/game-pricing/players/${encodeId(playerId)}/games/${encodeId(gameId)}/base`,
    { method: "PUT", body: JSON.stringify(body) },
  );
}

/** 受控错误文案：ApiError 用后端 message，未知错误给中性兜底。 */
export function describePricingError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "请求失败，请重试";
}
