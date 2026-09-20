/**
 * S4 创建派单的领域编排：按发布快照校验值、计算人数与价格调整、生成自动文案。
 *
 * 约束（设计规格 §8.2 / §8.3 / §18）：
 * - 人数只能来自发布配置的 staffingSource，价格只能来自选项的整数分加价；
 * - 客户端提交的未知稳定键（包括伪造的最终人数或价格）一律拒绝；
 * - 自动文案由发布快照生成，不读当前模板、不执行任意表达式。
 *
 * 纯领域模块：不依赖 NestJS、Prisma 或平台 SDK。
 */
import { GenericTemplateError } from "./errors.js";
import {
  calculateTemplateStaffing,
  templatePricingDimensionFields,
  TemplateRuntimeValueError,
  validateTemplateChoiceValues,
} from "./game-template-calculations.js";
import {
  pricingDimensionKeys,
  resolveSurchargeFen,
  type PricingRuleItem,
} from "./game-pricing.js";
import type {
  PublishedConfigV2,
  TemplateAudienceV2,
} from "./game-template-config-v2.js";
import {
  billingComponentsHiddenFromV2,
  partitionValuesV2,
  visibleConfigV2,
} from "./game-template-config-v2.js";
import {
  renderDispatchDocument,
  type DispatchDocumentV1,
  TemplateDocumentError,
} from "./game-template-document.js";

export type TemplateOrderValues = Readonly<Record<string, unknown>>;

export interface TemplateOrderStaffing {
  total: number;
  rows: { label: string; count: number }[];
}

export interface TemplateOrderDraft {
  staffing: TemplateOrderStaffing;
  priceAdjustmentFen: string;
  document: DispatchDocumentV1;
}

/** 写入侧的端口过滤结果：真正落库的值 + 被丢弃的键（V-5）。 */
export interface TemplateOrderDraftOutcome {
  draft: TemplateOrderDraft;
  storedValues: Record<string, unknown>;
  droppedKeys: string[];
}

/**
 * 运行时值错误 → 受控模板块错误：
 * 值与结构问题归到 TEMPLATE_COMPONENT_INVALID，绑定与价格问题保留原语义。
 */
function mapRuntimeError(
  error: TemplateRuntimeValueError,
): GenericTemplateError {
  const code =
    error.code === "TEMPLATE_BINDING_INVALID"
      ? "TEMPLATE_BINDING_INVALID"
      : error.code === "TEMPLATE_PRICE_RULE_INVALID"
        ? "TEMPLATE_PRICE_RULE_INVALID"
        : "TEMPLATE_COMPONENT_INVALID";
  return new GenericTemplateError(code, error.message, { path: error.path });
}

/**
 * 按发布快照生成订单草稿所需的人数、加价合计与自动文案。
 *
 * 加价自 ADR-0003 起唯一来源是该游戏的规则库（`game_pricing_rules`）：
 * 命中键 = 模板字段 stableKey + 选项值，模板选项里的 priceDeltaFen 不再参与定价
 * （旧字段保留只读一个版本）。取值合法性仍在这里校验。
 */
export function buildTemplateOrderDraft(
  config: PublishedConfigV2,
  values: TemplateOrderValues,
  pricingRuleItems: readonly PricingRuleItem[] = [],
): TemplateOrderDraft {
  try {
    const staffing = calculateTemplateStaffing(config, values);
    validateTemplateChoiceValues(config, values);
    const priceAdjustmentFen = resolveSurchargeFen(
      pricingDimensionKeys({
        fields: templatePricingDimensionFields(config),
        values,
      }),
      pricingRuleItems,
    );
    const document = renderDispatchDocument(config, values);
    return {
      staffing: {
        total: staffing.totalCount,
        rows: staffing.rows.map((row) => ({
          label: row.label,
          count: row.count,
        })),
      },
      priceAdjustmentFen,
      document,
    };
  } catch (error) {
    if (error instanceof TemplateRuntimeValueError)
      throw mapRuntimeError(error);
    if (error instanceof TemplateDocumentError) {
      throw new GenericTemplateError(
        "TEMPLATE_COMPONENT_INVALID",
        error.message,
        {
          path: error.path,
        },
      );
    }
    throw error;
  }
}

/**
 * 按写入方端口生成订单草稿（V-5 / V-6 / V-10）：
 * 先把手里的配置与提交值都收敛到该端口可见的部分，再交给上面的纯计算——
 * 于是"看不见的字段"既不参与必填校验（V-10），它的值也不会落库或进文案。
 *
 * 注意：配置里根本不存在的键不在这里丢弃，继续走既有的未知字段拒绝（422）。
 */
export function buildTemplateOrderDraftForAudience(
  config: PublishedConfigV2,
  values: TemplateOrderValues,
  audience: TemplateAudienceV2,
  pricingRuleItems: readonly PricingRuleItem[] = [],
): TemplateOrderDraftOutcome {
  // 参与算价或人数的内容若对这个端口不可见，宁可不写这单，也不静默少算
  // （发布校验已阻断这类配置；这里是给"规则上线前发布的历史版本"兜底）。
  const hiddenBilling = billingComponentsHiddenFromV2(config, audience);
  if (hiddenBilling.length > 0) {
    const names = hiddenBilling
      .map((component) => `「${component.label}」`)
      .join("、");
    throw new GenericTemplateError(
      "TEMPLATE_COMPONENT_INVALID",
      `${names}参与算价或人数，却被标成对写入端口不可见，无法下单：请先改标记并重新发布`,
      { path: `$.components.${hiddenBilling[0]?.stableKey ?? ""}.audiences` },
    );
  }
  const { visible, droppedKeys } = partitionValuesV2(config, values, audience);
  return {
    draft: buildTemplateOrderDraft(
      visibleConfigV2(config, audience),
      visible,
      pricingRuleItems,
    ),
    storedValues: visible,
    droppedKeys,
  };
}
