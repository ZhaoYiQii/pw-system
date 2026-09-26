import { parseFenString, type MoneyFen } from "../../../common/money.js";
import type { PricingDimensionField } from "./game-pricing.js";
import {
  GAME_TEMPLATE_V2_LIMITS,
  type PublishedConfigV2,
  type TemplateChoiceOptionV2,
  type TemplateComponentV2,
  type TemplateFieldComponentV2,
  type TemplateRepeatableTableV2,
} from "./game-template-config-v2.js";
import { allowsFreeInput } from "./game-template-values.js";

export const MAX_TEMPLATE_STAFFING_COUNT = 500;

export type TemplateRuntimeValues = Readonly<Record<string, unknown>>;

export interface StaffingRow {
  label: string;
  count: number;
}

export interface TemplateStaffingResult {
  totalCount: number;
  rows: StaffingRow[];
}

export class TemplateRuntimeValueError extends Error {
  constructor(
    public readonly code:
      | "TEMPLATE_VALUE_INVALID"
      | "TEMPLATE_BINDING_INVALID"
      | "TEMPLATE_PRICE_RULE_INVALID",
    public readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "TemplateRuntimeValueError";
  }
}

function activeComponents(config: PublishedConfigV2): TemplateComponentV2[] {
  const activeSectionKeys = new Set(
    config.sections
      .filter((section) => section.enabled)
      .map((section) => section.stableKey),
  );
  return config.components.filter(
    (component) =>
      component.enabled && activeSectionKeys.has(component.sectionKey),
  );
}

function assertKnownRuntimeKeys(
  components: readonly TemplateComponentV2[],
  values: TemplateRuntimeValues,
): void {
  const allowedKeys = new Set(
    components
      .filter((component) => component.kind !== "NOTE")
      .map((component) => component.stableKey),
  );
  for (const key of Object.keys(values)) {
    if (!allowedKeys.has(key)) {
      throw new TemplateRuntimeValueError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${key}`,
        `未知字段：${key}`,
      );
    }
  }
}

function assertStaffingCount(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_TEMPLATE_STAFFING_COUNT
  ) {
    throw new TemplateRuntimeValueError(
      "TEMPLATE_VALUE_INVALID",
      path,
      `人数必须为 1-${MAX_TEMPLATE_STAFFING_COUNT} 的整数`,
    );
  }
  return value;
}

function staffingTableRows(
  table: TemplateRepeatableTableV2,
  columnKey: string,
  rawRows: unknown,
): TemplateStaffingResult {
  if (!Array.isArray(rawRows)) {
    throw new TemplateRuntimeValueError(
      "TEMPLATE_VALUE_INVALID",
      `$.values.${table.stableKey}`,
      "人数表格必须按行提交",
    );
  }
  if (rawRows.length > GAME_TEMPLATE_V2_LIMITS.submittedRows) {
    throw new TemplateRuntimeValueError(
      "TEMPLATE_VALUE_INVALID",
      `$.values.${table.stableKey}`,
      `人数表格不能超过 ${GAME_TEMPLATE_V2_LIMITS.submittedRows} 行`,
    );
  }
  const columnKeys = new Set(table.columns.map((column) => column.stableKey));
  const labelColumn = table.columns.find(
    (column) => column.semanticRole === "STAFFING_LABEL",
  );
  const rows = rawRows.map((rawRow, index): StaffingRow => {
    if (
      typeof rawRow !== "object" ||
      rawRow === null ||
      Array.isArray(rawRow)
    ) {
      throw new TemplateRuntimeValueError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${table.stableKey}[${index}]`,
        "人数表格行结构无效",
      );
    }
    const row = rawRow as Readonly<Record<string, unknown>>;
    if (Object.keys(row).some((key) => !columnKeys.has(key))) {
      throw new TemplateRuntimeValueError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${table.stableKey}[${index}]`,
        "人数表格包含未知列",
      );
    }
    const count = assertStaffingCount(
      row[columnKey],
      `$.values.${table.stableKey}[${index}].${columnKey}`,
    );
    const labelValue = labelColumn ? row[labelColumn.stableKey] : undefined;
    return {
      label:
        typeof labelValue === "string" && labelValue.trim()
          ? labelValue.trim()
          : table.label,
      count,
    };
  });
  const totalCount = rows.reduce((total, row) => total + row.count, 0);
  assertStaffingCount(totalCount, `$.values.${table.stableKey}`);
  return { totalCount, rows };
}

export function calculateTemplateStaffing(
  config: PublishedConfigV2,
  values: TemplateRuntimeValues,
): TemplateStaffingResult {
  const components = activeComponents(config);
  const componentByKey = new Map(
    components.map((component) => [component.stableKey, component]),
  );
  const source = config.staffingSource;

  if (source.kind === "FIXED") {
    assertKnownRuntimeKeys(components, values);
    const count = assertStaffingCount(source.count, "$.staffingSource.count");
    return { totalCount: count, rows: [{ label: "人数", count }] };
  }

  const component = componentByKey.get(source.componentKey);
  if (!component) {
    throw new TemplateRuntimeValueError(
      "TEMPLATE_BINDING_INVALID",
      "$.staffingSource.componentKey",
      "人数来源不存在或未启用",
    );
  }
  assertKnownRuntimeKeys(components, values);

  if (source.kind === "NUMBER_FIELD") {
    if (component.kind !== "FIELD" || component.fieldType !== "NUMBER") {
      throw new TemplateRuntimeValueError(
        "TEMPLATE_BINDING_INVALID",
        "$.staffingSource.componentKey",
        "人数来源必须是数字字段",
      );
    }
    const count = assertStaffingCount(
      values[component.stableKey],
      `$.values.${component.stableKey}`,
    );
    return { totalCount: count, rows: [{ label: component.label, count }] };
  }

  if (component.kind !== "REPEATABLE_TABLE") {
    throw new TemplateRuntimeValueError(
      "TEMPLATE_BINDING_INVALID",
      "$.staffingSource.componentKey",
      "人数来源必须是可重复表格",
    );
  }
  const countColumn = component.columns.find(
    (column) => column.stableKey === source.columnKey,
  );
  if (
    !countColumn ||
    countColumn.columnType !== "NUMBER" ||
    countColumn.semanticRole !== "STAFFING_COUNT"
  ) {
    throw new TemplateRuntimeValueError(
      "TEMPLATE_BINDING_INVALID",
      "$.staffingSource.columnKey",
      "人数来源列必须是 STAFFING_COUNT 数字列",
    );
  }
  return staffingTableRows(
    component,
    source.columnKey,
    values[component.stableKey],
  );
}

function selectedOption(
  options: readonly TemplateChoiceOptionV2[],
  value: unknown,
  path: string,
  allowFreeValue: boolean,
): TemplateChoiceOptionV2 {
  if (typeof value !== "string") {
    throw new TemplateRuntimeValueError(
      "TEMPLATE_VALUE_INVALID",
      path,
      "选择字段必须提交字符串选项值",
    );
  }
  const option = options.find((candidate) => candidate.value === value);
  if (!option) {
    // ADR-0010 决定 4/6：豁免语义角色的选项是「建议」——库外值放行，
    // 合成一个无加价选项（priceDeltaFen 缺省 ⇒ optionPriceFen 返回 0n），
    // 即「未命中预设库 = 按基础价」。
    if (allowFreeValue) return { value, label: value };
    throw new TemplateRuntimeValueError(
      "TEMPLATE_VALUE_INVALID",
      path,
      `选项 ${value} 不在模板选项中`,
    );
  }
  return option;
}

function optionPriceFen(option: TemplateChoiceOptionV2, path: string): bigint {
  if (option.priceDeltaFen === undefined) return 0n;
  const price = parseFenString(option.priceDeltaFen, true);
  if (price === null) {
    throw new TemplateRuntimeValueError(
      "TEMPLATE_PRICE_RULE_INVALID",
      path,
      "选项加价必须为非负整数分字符串",
    );
  }
  return BigInt(price);
}

export function calculateTemplatePriceAdjustmentFen(
  config: PublishedConfigV2,
  values: TemplateRuntimeValues,
): MoneyFen {
  let total = 0n;

  for (const { component, options } of collectChoiceSelections(
    config,
    values,
  )) {
    const prices = options.map((option) =>
      optionPriceFen(
        option,
        `$.components.${component.stableKey}.options.${option.value}.priceDeltaFen`,
      ),
    );
    if (component.fieldType === "SINGLE_SELECT") {
      total += prices[0] ?? 0n;
      continue;
    }
    if (component.aggregationPolicy === "SUM") {
      total += prices.reduce((sum, price) => sum + price, 0n);
    } else if (component.aggregationPolicy === "MAX") {
      total += prices.reduce(
        (maximum, price) => (price > maximum ? price : maximum),
        0n,
      );
    } else {
      throw new TemplateRuntimeValueError(
        "TEMPLATE_PRICE_RULE_INVALID",
        `$.components.${component.stableKey}.aggregationPolicy`,
        "多选加价必须声明 SUM 或 MAX",
      );
    }
  }

  return total.toString();
}

/** 启用且在启用区块内的选择类字段（单选 / 多选）——加价命中的候选字段。 */
function choiceComponents(
  config: PublishedConfigV2,
): TemplateFieldComponentV2[] {
  return activeComponents(config).filter(
    (component): component is TemplateFieldComponentV2 =>
      component.kind === "FIELD" &&
      (component.fieldType === "SINGLE_SELECT" ||
        component.fieldType === "MULTI_SELECT"),
  );
}

interface TemplateChoiceSelection {
  component: TemplateFieldComponentV2;
  /** 本次提交命中的选项，顺序与提交顺序一致（多选逐项）。 */
  options: TemplateChoiceOptionV2[];
}

/**
 * 校验选择类字段的取值并返回命中的选项：
 * 未知键、选项之外的取值、多选非数组 / 超条数 / 重复都在这里被拒绝。
 */
function collectChoiceSelections(
  config: PublishedConfigV2,
  values: TemplateRuntimeValues,
): TemplateChoiceSelection[] {
  const components = choiceComponents(config);
  assertKnownRuntimeKeys(activeComponents(config), values);
  const selections: TemplateChoiceSelection[] = [];

  for (const component of components) {
    const rawValue = values[component.stableKey];
    if (rawValue === undefined) continue;
    const options = component.options ?? [];

    if (component.fieldType === "SINGLE_SELECT") {
      selections.push({
        component,
        options: [
          selectedOption(
            options,
            rawValue,
            `$.values.${component.stableKey}`,
            allowsFreeInput(component),
          ),
        ],
      });
      continue;
    }

    if (
      !Array.isArray(rawValue) ||
      rawValue.some((value) => typeof value !== "string")
    ) {
      throw new TemplateRuntimeValueError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${component.stableKey}`,
        "多选字段必须提交字符串数组",
      );
    }
    if (rawValue.length > GAME_TEMPLATE_V2_LIMITS.choiceOptions) {
      throw new TemplateRuntimeValueError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${component.stableKey}`,
        `多选字段不能超过 ${GAME_TEMPLATE_V2_LIMITS.choiceOptions} 个选项`,
      );
    }
    if (new Set(rawValue).size !== rawValue.length) {
      throw new TemplateRuntimeValueError(
        "TEMPLATE_VALUE_INVALID",
        `$.values.${component.stableKey}`,
        "多选字段不能重复选择同一选项",
      );
    }
    selections.push({
      component,
      options: rawValue.map((value) =>
        // 多选不在豁免范围（ADR-0010 决定 4）：确认库外值的豁免只给单选的三字段。
        selectedOption(
          options,
          value,
          `$.values.${component.stableKey}`,
          false,
        ),
      ),
    });
  }

  return selections;
}

/**
 * 下单时的选择类取值校验（选项成员、多选去重与条数）。
 * 定价自 ADR-0003 起收敛到规则库，这里只负责取值合法性，
 * 金额由 `resolveUnitPriceFen` / `resolveSurchargeFen` 按维度键命中计算。
 */
export function validateTemplateChoiceValues(
  config: PublishedConfigV2,
  values: TemplateRuntimeValues,
): void {
  collectChoiceSelections(config, values);
}

/**
 * 参与加价命中的模板字段：与迁移脚本 `scripts/migrate-pricing-rules.mjs`
 * 的 v2 归并口径一致（只处理 FIELD 组件，表格列选项不参与）。
 */
export function templatePricingDimensionFields(
  config: PublishedConfigV2,
): PricingDimensionField[] {
  return choiceComponents(config).map((component) => ({
    key: component.stableKey,
    optionValues: (component.options ?? []).map((option) => option.value),
  }));
}
