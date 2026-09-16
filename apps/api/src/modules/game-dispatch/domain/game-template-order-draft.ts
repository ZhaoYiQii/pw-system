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
  calculateTemplatePriceAdjustmentFen,
  calculateTemplateStaffing,
  TemplateRuntimeValueError,
} from "./game-template-calculations.js";
import type { PublishedConfigV2 } from "./game-template-config-v2.js";
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

/** 按发布快照生成订单草稿所需的人数、价格调整与自动文案。 */
export function buildTemplateOrderDraft(
  config: PublishedConfigV2,
  values: TemplateOrderValues,
): TemplateOrderDraft {
  try {
    const staffing = calculateTemplateStaffing(config, values);
    const priceAdjustmentFen = calculateTemplatePriceAdjustmentFen(
      config,
      values,
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
