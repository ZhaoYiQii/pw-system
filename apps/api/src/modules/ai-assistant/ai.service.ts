import type { DbTransaction, PrismaClient } from "@pw/database";
import { withTenantContext } from "@pw/database";
import { DeterministicAiProvider, RequirementFields } from "./provider.js";

const RUN_PARSE = "PARSE_REQUIREMENT";
const RUN_RECOMMEND = "RECOMMEND_PLAYERS";
const MODEL_VERSION = "deterministic-1";
const PROMPT_VERSION = "schema-v1";

export class AiAssistantService {
  constructor(
    private readonly client: PrismaClient,
    private readonly provider: DeterministicAiProvider
  ) {}

  capabilities() {
    return this.provider.capabilities();
  }

  async parseRequirement(tenantId: string, actorId: string, fields: RequirementFields) {
    const result = await this.provider.parseRequirement(fields);
    return withTenantContext(this.client, tenantId, async (tx: DbTransaction) => {
      const run = await tx.aiRun.create({
        data: { tenantId, runType: RUN_PARSE, provider: "deterministic", modelVersion: MODEL_VERSION, promptVersion: PROMPT_VERSION, requestedBy: actorId }
      });
      await tx.aiSuggestion.create({
        data: {
          tenantId,
          runId: run.id,
          suggestionType: "MISSING_FIELDS",
          confidenceBp: result.confidenceBp,
          status: result.missing.length === 0 ? "SUGGESTED" : "NEEDS_REVIEW",
          payload: { missing: result.missing, note: result.note }
        }
      });
      return { runId: run.id, missing: result.missing, confidenceBp: result.confidenceBp, status: result.missing.length === 0 ? "SUGGESTED" : "NEEDS_REVIEW", note: result.note };
    });
  }

  /** 候选过滤：AI 只能在“技能匹配 + 接单中 + 时间不冲突”的合法集合内排序（不虚构价格）。 */
  async recommendPlayers(tenantId: string, actorId: string, orderId: string) {
    return withTenantContext(this.client, tenantId, async (tx: DbTransaction) => {
      const req = await tx.orderRequirement.findFirst({ where: { tenantId, orderId } });
      const order = await tx.order.findFirst({ where: { tenantId, id: orderId }, select: { id: true, orderNo: true, status: true } });
      if (!req || !order) throw new Error("订单需求不存在");
      if (order.status !== "DISPATCHING") throw new Error("仅 DISPATCHING 订单可推荐候选");
      let gameId: string | null = null;
      if (req.serviceProductId) {
        const p = await tx.serviceProduct.findFirst({ where: { tenantId, id: req.serviceProductId }, select: { gameId: true } });
        gameId = p?.gameId ?? null;
      }
      let players = await tx.playerProfile.findMany({
        where: { tenantId, acceptingOrders: true, status: "ACTIVE" },
        select: { id: true, name: true, acceptingOrders: true },
        orderBy: { createdAt: "asc" }
      });
      if (gameId) {
        const skills = await tx.playerSkill.findMany({ where: { tenantId, gameId }, select: { playerId: true } });
        const withSkill = new Set(skills.map((s) => s.playerId));
        players = players.filter((p) => withSkill.has(p.id));
      }
      if (req.desiredStartAt && req.durationSeconds) {
        const start = req.desiredStartAt;
        const end = new Date(start.getTime() + req.durationSeconds * 1000);
        const filtered: typeof players = [];
        for (const p of players) {
          const conflict = await tx.playerAvailability.findFirst({
            where: { tenantId, playerId: p.id, endsAt: { gt: start }, startsAt: { lt: end } },
            select: { id: true }
          });
          if (!conflict) filtered.push(p);
        }
        players = filtered;
      }
      const candidates = players.slice(0, 20);
      const run = await tx.aiRun.create({
        data: { tenantId, runType: RUN_RECOMMEND, provider: "deterministic", modelVersion: MODEL_VERSION, promptVersion: PROMPT_VERSION, requestedBy: actorId }
      });
      await tx.aiSuggestion.create({
        data: {
          tenantId,
          runId: run.id,
          suggestionType: "PLAYER_CANDIDATES",
          confidenceBp: 9000,
          status: "SUGGESTED",
          payload: { orderId, orderNo: order.orderNo, candidateIds: candidates.map((c) => c.id) }
        }
      });
      return { runId: run.id, orderId: order.id, candidates };
    });
  }
}