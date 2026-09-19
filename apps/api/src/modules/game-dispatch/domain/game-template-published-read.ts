/**
 * S4 新建派单的只读领域逻辑：该游戏「可派单模板」的筛选与排序，以及发布配置的安全读取。
 *
 * 约束（设计规格 §8.2 / §10 / §18）：
 * - 只有未归档且存在生效版本的模板可以派单；
 * - 默认模板优先，其次按最近使用，未使用过的再按最近更新，最后按 id 保证顺序稳定；
 * - 发布配置必须通过 v2 发布校验；无法解析的历史数据返回 null，由调用方映射成
 *   TEMPLATE_VERSION_UNAVAILABLE，禁止猜测或降级成草稿配置。
 *
 * 本文件是纯领域模块：不依赖 NestJS、Prisma 或任何平台 SDK。
 */
import {
  type PublishedConfigV2,
  validatePublishedConfigV2,
} from "./game-template-config-v2.js";

/** 模板表上参与判定与排序的列（由 repository 投影提供）。 */
export interface PublishedTemplateCandidate {
  id: string;
  gameId: string | null;
  name: string;
  description: string | null;
  activeVersionId: string | null;
  activeVersionNo: number | null;
  isDefault: boolean;
  lastUsedAt: Date | null;
  updatedAt: Date;
  archivedAt: Date | null;
}

/** 派单选择阶段需要的模板摘要：不含 config，不含草稿字段。 */
export interface PublishedTemplateSummary {
  templateId: string;
  name: string;
  description: string | null;
  versionId: string;
  versionNo: number;
  isDefault: boolean;
  lastUsedAt: Date | null;
}

/** 该游戏可派单的模板：先过滤，再按业务优先级排序（不修改入参）。 */
export function selectPublishedTemplates(
  candidates: readonly PublishedTemplateCandidate[],
): PublishedTemplateSummary[] {
  return candidates
    .filter(
      (row) =>
        row.archivedAt === null &&
        row.activeVersionId !== null &&
        row.activeVersionNo !== null,
    )
    .slice()
    .sort(compareCandidates)
    .map(toSummary);
}

function compareCandidates(
  a: PublishedTemplateCandidate,
  b: PublishedTemplateCandidate,
): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;

  const lastUsed = compareLastUsed(a.lastUsedAt, b.lastUsedAt);
  if (lastUsed !== 0) return lastUsed;

  const updated = b.updatedAt.getTime() - a.updatedAt.getTime();
  if (updated !== 0) return updated;

  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** 用过的时间越新越靠前；从未使用过的排在已使用过的之后。 */
function compareLastUsed(a: Date | null, b: Date | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b.getTime() - a.getTime();
}

function toSummary(row: PublishedTemplateCandidate): PublishedTemplateSummary {
  return {
    templateId: row.id,
    name: row.name,
    description: row.description,
    versionId: row.activeVersionId as string,
    versionNo: row.activeVersionNo as number,
    isDefault: row.isDefault,
    lastUsedAt: row.lastUsedAt,
  };
}

/** 读取并校验发布配置；不合法（含旧 schemaVersion）时返回 null。 */
export function readPublishedConfig(raw: unknown): PublishedConfigV2 | null {
  if (validatePublishedConfigV2(raw).length > 0) return null;
  return raw as PublishedConfigV2;
}

/** 派单表单读取结果：锁定到具体发布版本，配置来自该版本快照。 */
export interface PublishedTemplateForm {
  templateId: string;
  gameId: string | null;
  versionId: string;
  versionNo: number;
  config: PublishedConfigV2;
}

/**
 * 客户侧「可下单游戏」的候选行（repository 投影：一条模板一行，按游戏去重后传入）。
 * 与模板摘要一样，这里只带判定所需的最小列，不含任何配置内容。
 */
export interface PublishedGameCandidate {
  gameId: string | null;
  gameName: string | null;
  archivedAt: Date | null;
  activeVersionId: string | null;
}

/**
 * 客户选择阶段需要的游戏摘要：只够渲染"先选哪个游戏"，
 * 不透露模板数量、报价或任何字段内容。
 */
export interface PublishedGameSummary {
  gameId: string;
  name: string;
}

/**
 * 客户可下单的游戏列表的硬上限：这是「一个门店的游戏」这种有界集合，
 * 用固定上限约束响应体，避免无界列表（api-and-interface-design 的列表边界要求）。
 */
export const PUBLISHED_GAME_LIMIT = 50;

/**
 * 该店可下单的游戏：至少有一个「未归档且有生效版本」的模板。
 *
 * - 未归类模板（game_id 为空）不属于任何游戏，天然排除；
 * - 游戏被停用（games.enabled = false）由 repository 过滤掉：客服端「新建派单」的
 *   游戏选择器本来就只列启用游戏，两个入口口径保持一致，客户不能给已停用的游戏下单；
 * - 按游戏名排序，同名时按 id 升序，保证返回顺序稳定。
 */
export function selectPublishedGames(
  candidates: readonly PublishedGameCandidate[],
): PublishedGameSummary[] {
  const byGameId = new Map<string, PublishedGameSummary>();
  for (const row of candidates) {
    if (row.archivedAt !== null) continue;
    if (row.activeVersionId === null) continue;
    if (row.gameId === null || row.gameName === null) continue;
    if (!byGameId.has(row.gameId)) {
      byGameId.set(row.gameId, { gameId: row.gameId, name: row.gameName });
    }
  }
  return [...byGameId.values()]
    .sort(comparePublishedGames)
    .slice(0, PUBLISHED_GAME_LIMIT);
}

function comparePublishedGames(
  a: PublishedGameSummary,
  b: PublishedGameSummary,
): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.gameId === b.gameId) return 0;
  return a.gameId < b.gameId ? -1 : 1;
}
