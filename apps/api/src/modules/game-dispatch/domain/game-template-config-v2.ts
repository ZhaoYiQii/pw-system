import { parseFenString, type MoneyFen } from "../../../common/money.js";
import {
  GAME_TEMPLATE_SEMANTIC_ROLES,
  type GameTemplateSemanticRole,
} from "./game-template.js";

export const GAME_TEMPLATE_V2_LIMITS = {
  sections: 20,
  components: 100,
  tableColumns: 10,
  defaultRows: 50,
  submittedRows: 50,
  choiceOptions: 100,
  draftBytes: 256 * 1024,
  labelCharacters: 50,
  helpTextCharacters: 500,
} as const;

export type TemplateConfigSchemaVersion = 1 | 2;

export const TEMPLATE_FIELD_TYPES_V2 = [
  "TEXT",
  "TEXTAREA",
  "NUMBER",
  "MONEY_FEN",
  "DATETIME",
  "SINGLE_SELECT",
  "MULTI_SELECT",
] as const;

export type TemplateFieldTypeV2 = (typeof TEMPLATE_FIELD_TYPES_V2)[number];

export const TEMPLATE_TABLE_COLUMN_TYPES_V2 = [
  "TEXT",
  "NUMBER",
  "SINGLE_SELECT",
] as const;

export type TemplateTableColumnTypeV2 =
  (typeof TEMPLATE_TABLE_COLUMN_TYPES_V2)[number];

/**
 * 端口可见性（设计规格 v0.1，V-1）：本版只区分客服与客户，陪玩 / 老板端各自立项。
 * 缺省不写就是「继承」：组件 → 分组 → 两个端口全选（V-3 / V-4 / V-8）。
 */
export const TEMPLATE_AUDIENCES_V2 = ["CS", "CUSTOMER"] as const;

export type TemplateAudienceV2 = (typeof TEMPLATE_AUDIENCES_V2)[number];

/**
 * 能"填写下单"的端口：本版只有客服（客户侧 v2 下单面尚未立项）。
 *
 * 产品规则：值类内容（字段 / 可重复表格）必须对至少一个可写入端口可见，
 * 否则没有任何界面能填它；参与算价或人数的内容更是不能对写入端口不可见——
 * 那会让订单静默少算。说明类（NOTE）只影响预览，允许只给客户看。
 * 客户侧下单面立项后，把 CUSTOMER 加进这个集合，规则即自动放宽。
 */
export const TEMPLATE_WRITABLE_AUDIENCES_V2: readonly TemplateAudienceV2[] = [
  "CS",
];

export interface TemplateSectionV2 {
  stableKey: string;
  label: string;
  description?: string;
  audiences?: TemplateAudienceV2[];
  enabled: boolean;
  sortOrder: number;
  layout: {
    columns: 1 | 2 | 3 | 4;
    density?: "comfortable" | "compact";
    align?: "left" | "center";
  };
}

export interface TemplateComponentLayoutV2 {
  colSpan: 1 | 2 | 3 | 4;
  rowBreakBefore: boolean;
}

export interface TemplateChoiceOptionV2 {
  value: string;
  label: string;
  priceDeltaFen?: MoneyFen;
}

interface TemplateComponentBaseV2 {
  stableKey: string;
  sectionKey: string;
  label: string;
  description?: string;
  audiences?: TemplateAudienceV2[];
  enabled: boolean;
  sortOrder: number;
  layout: TemplateComponentLayoutV2;
}

export interface TemplateFieldComponentV2 extends TemplateComponentBaseV2 {
  kind: "FIELD";
  fieldType: TemplateFieldTypeV2;
  semanticRole: GameTemplateSemanticRole;
  required: boolean;
  placeholder?: string;
  options?: TemplateChoiceOptionV2[];
  aggregationPolicy?: "SUM" | "MAX";
}

export interface TemplateRepeatableTableColumnV2 {
  stableKey: string;
  label: string;
  columnType: TemplateTableColumnTypeV2;
  semanticRole: GameTemplateSemanticRole;
  required: boolean;
  options?: TemplateChoiceOptionV2[];
}

export interface TemplateRepeatableTableV2 extends TemplateComponentBaseV2 {
  kind: "REPEATABLE_TABLE";
  columns: TemplateRepeatableTableColumnV2[];
  defaultRows: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

export interface TemplateNoteComponentV2 extends TemplateComponentBaseV2 {
  kind: "NOTE";
  text: string;
}

export type TemplateComponentV2 =
  | TemplateFieldComponentV2
  | TemplateRepeatableTableV2
  | TemplateNoteComponentV2;

export type StaffingSourceV2 =
  | { kind: "FIXED"; count: number }
  | { kind: "NUMBER_FIELD"; componentKey: string }
  | {
      kind: "REPEATABLE_TABLE_SUM";
      componentKey: string;
      columnKey: string;
    };

export interface LegacyUnboundPriceRuleV2 {
  label: string;
  priceDeltaFen: MoneyFen;
  sortOrder: number;
}

export interface DraftConfigV2 {
  schemaVersion: 2;
  sections: TemplateSectionV2[];
  components: TemplateComponentV2[];
  staffingSource: StaffingSourceV2;
  legacyCompatibility?: {
    unboundPriceRules: LegacyUnboundPriceRuleV2[];
  };
}

export type PublishedConfigV2 = Omit<DraftConfigV2, "legacyCompatibility"> & {
  documentRendererVersion: 1;
};

export type TemplateConfigIssueCode =
  | "TEMPLATE_COMPONENT_INVALID"
  | "TEMPLATE_BINDING_INVALID"
  | "TEMPLATE_PRICE_RULE_INVALID"
  | "TEMPLATE_LEGACY_REVIEW_REQUIRED";

export interface TemplateConfigIssue {
  code: TemplateConfigIssueCode;
  path: string;
  componentKey?: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const STABLE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const FIELD_TYPE_SET = new Set<string>(TEMPLATE_FIELD_TYPES_V2);
const TABLE_COLUMN_TYPE_SET = new Set<string>(TEMPLATE_TABLE_COLUMN_TYPES_V2);
const SEMANTIC_ROLE_SET = new Set<string>(GAME_TEMPLATE_SEMANTIC_ROLES);
const CHOICE_FIELD_TYPES = new Set<string>(["SINGLE_SELECT", "MULTI_SELECT"]);
const AUDIENCE_SET = new Set<string>(TEMPLATE_AUDIENCES_V2);

/**
 * 端口标记的合法性（V-2）：缺省合法（继承）；否则必须是数组、元素属于枚举、
 * 去重后至少一个。重复项按去重处理，空数组即非法。
 */
function validAudiences(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !AUDIENCE_SET.has(item)) return false;
    seen.add(item);
  }
  return seen.size >= 1;
}

/** 读一份声明：非法或不是数组时按「没有声明」处理（错误由校验层报告）。 */
function declaredAudiences(value: unknown): TemplateAudienceV2[] | null {
  if (!validAudiences(value) || value === undefined) return null;
  return [...new Set(value as TemplateAudienceV2[])];
}

/**
 * 解析某个组件真正生效的端口（V-3 / V-8）：组件显式声明即覆盖分组，
 * 否则继承分组，分组也没有则两个端口全选。
 */
export function resolveAudiencesV2(
  component: { audiences?: TemplateAudienceV2[] } | undefined,
  section: { audiences?: TemplateAudienceV2[] } | undefined,
): TemplateAudienceV2[] {
  return (
    declaredAudiences(component?.audiences) ??
    declaredAudiences(section?.audiences) ?? [...TEMPLATE_AUDIENCES_V2]
  );
}

/**
 * 该端口能看到的组件（V-5）：组件显式声明覆盖分组，未声明继承分组，
 * 都没有则两个端口全选（V-8）。停用与否不改变可见性判定，停用仍由渲染层处理。
 */
export function visibleComponentsV2(
  config: Pick<PublishedConfigV2, "sections" | "components">,
  audience: TemplateAudienceV2,
): TemplateComponentV2[] {
  const sectionByKey = new Map(
    config.sections.map((section) => [section.stableKey, section]),
  );
  return config.components.filter((component) =>
    resolveAudiencesV2(
      component,
      sectionByKey.get(component.sectionKey),
    ).includes(audience),
  );
}

/**
 * 按端口过滤整份配置（V-6：服务端是过滤权威）。
 * 只保留该端口可见的组件，以及「还有可见组件」的分组；其余属性原样带回。
 */
export function visibleConfigV2(
  config: PublishedConfigV2,
  audience: TemplateAudienceV2,
): PublishedConfigV2 {
  const components = visibleComponentsV2(config, audience);
  const visibleSectionKeys = new Set(
    components.map((component) => component.sectionKey),
  );
  return {
    ...config,
    sections: config.sections.filter((section) =>
      visibleSectionKeys.has(section.stableKey),
    ),
    components,
  };
}

/**
 * 按端口拆分提交值（V-5）：键对应「配置里存在、但对这个端口不可见」的组件时丢弃，
 * 并回报被丢弃的键供上层记录受控事件。
 *
 * 配置里根本不存在的键**不在这里处理**——它继续走既有的未知字段拒绝（422）路径。
 */
export function partitionValuesV2(
  config: Pick<PublishedConfigV2, "sections" | "components">,
  values: Readonly<Record<string, unknown>>,
  audience: TemplateAudienceV2,
): { visible: Record<string, unknown>; droppedKeys: string[] } {
  const visibleKeys = new Set(
    visibleComponentsV2(config, audience).map(
      (component) => component.stableKey,
    ),
  );
  const knownKeys = new Set(
    config.components.map((component) => component.stableKey),
  );
  const visible: Record<string, unknown> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!knownKeys.has(key) || visibleKeys.has(key)) {
      visible[key] = value;
    } else {
      droppedKeys.push(key);
    }
  }
  return { visible, droppedKeys };
}

/** 这条内容承载"值"，必须有人能填；说明类只影响预览。 */
function carriesValueV2(component: TemplateComponentV2): boolean {
  return component.kind === "FIELD" || component.kind === "REPEATABLE_TABLE";
}

/** 值类内容里，对给定端口全都看不见的那些（发布校验用）。 */
export function unwritableValueComponentsV2(
  config: Pick<PublishedConfigV2, "sections" | "components">,
  writable: readonly TemplateAudienceV2[],
): TemplateComponentV2[] {
  const sectionByKey = new Map(
    config.sections.map((section) => [section.stableKey, section]),
  );
  return config.components.filter((component) => {
    if (!carriesValueV2(component)) return false;
    const audiences = resolveAudiencesV2(
      component,
      sectionByKey.get(component.sectionKey),
    );
    return !writable.some((audience) => audiences.includes(audience));
  });
}

/**
 * 参与算价或人数的组件（运行期兜底用）：带整数分加价的选项字段，
 * 以及人数来源指向的组件（表格来源还要求它确实带 STAFFING_COUNT 列）。
 */
export function billingComponentsV2(
  config: Pick<PublishedConfigV2, "components" | "staffingSource">,
): TemplateComponentV2[] {
  const source = config.staffingSource;
  return config.components.filter((component) => {
    if (
      component.kind === "FIELD" &&
      (component.options ?? []).some(
        (option) => option.priceDeltaFen !== undefined,
      )
    ) {
      return true;
    }
    if (
      (source.kind === "NUMBER_FIELD" ||
        source.kind === "REPEATABLE_TABLE_SUM") &&
      component.stableKey === source.componentKey
    ) {
      return true;
    }
    return false;
  });
}

/** 参与算价/人数、却对该端口不可见的组件：下单时必须报错而不是静默丢值。 */
export function billingComponentsHiddenFromV2(
  config: Pick<PublishedConfigV2, "sections" | "components" | "staffingSource">,
  audience: TemplateAudienceV2,
): TemplateComponentV2[] {
  const sectionByKey = new Map(
    config.sections.map((section) => [section.stableKey, section]),
  );
  return billingComponentsV2(config).filter(
    (component) =>
      !resolveAudiencesV2(
        component,
        sectionByKey.get(component.sectionKey),
      ).includes(audience),
  );
}

function validateChoiceOptions(
  options: unknown,
  path: string,
  componentKey: string | undefined,
  addIssue: (
    code: TemplateConfigIssueCode,
    path: string,
    message: string,
    componentKey?: string,
  ) => void,
): void {
  if (!Array.isArray(options) || options.length === 0) {
    addIssue(
      "TEMPLATE_COMPONENT_INVALID",
      path,
      "选择字段必须至少有一个选项",
      componentKey,
    );
    return;
  }

  const values = new Set<string>();
  options.forEach((option, index) => {
    const optionPath = `${path}[${index}]`;
    if (
      !isRecord(option) ||
      typeof option.value !== "string" ||
      !STABLE_KEY_PATTERN.test(option.value) ||
      !validLabel(option.label)
    ) {
      addIssue(
        "TEMPLATE_COMPONENT_INVALID",
        optionPath,
        "选择项结构无效",
        componentKey,
      );
      return;
    }
    if (values.has(option.value)) {
      addIssue(
        "TEMPLATE_COMPONENT_INVALID",
        `${optionPath}.value`,
        "选择项 value 必须唯一",
        componentKey,
      );
    }
    values.add(option.value);
    if (
      option.priceDeltaFen !== undefined &&
      parseFenString(option.priceDeltaFen, true) === null
    ) {
      addIssue(
        "TEMPLATE_PRICE_RULE_INVALID",
        `${optionPath}.priceDeltaFen`,
        "选项加价必须为非负整数分字符串",
        componentKey,
      );
    }
  });
}

function validLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= GAME_TEMPLATE_V2_LIMITS.labelCharacters
  );
}

function validHelpText(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" &&
      value.length <= GAME_TEMPLATE_V2_LIMITS.helpTextCharacters)
  );
}

export function validateDraftConfigV2(config: unknown): TemplateConfigIssue[] {
  if (
    !isRecord(config) ||
    config.schemaVersion !== 2 ||
    !Array.isArray(config.sections) ||
    !Array.isArray(config.components) ||
    !isRecord(config.staffingSource)
  ) {
    return [
      {
        code: "TEMPLATE_COMPONENT_INVALID",
        path: "$",
        message: "通用模板草稿结构无效",
      },
    ];
  }

  const issues: TemplateConfigIssue[] = [];
  const addIssue = (
    code: TemplateConfigIssueCode,
    path: string,
    message: string,
    componentKey?: string,
  ): void => {
    issues.push({
      code,
      path,
      message,
      ...(componentKey === undefined ? {} : { componentKey }),
    });
  };
  const addSizeIssue = (path: string, message: string): void =>
    addIssue("TEMPLATE_COMPONENT_INVALID", path, message);

  try {
    if (
      new TextEncoder().encode(JSON.stringify(config)).byteLength >
      GAME_TEMPLATE_V2_LIMITS.draftBytes
    ) {
      addSizeIssue("$", "模板草稿体积超过 256 KiB");
    }
  } catch {
    addSizeIssue("$", "模板草稿必须可以序列化为 JSON");
  }

  if (config.sections.length > GAME_TEMPLATE_V2_LIMITS.sections) {
    addSizeIssue("$.sections", "模板区块数量超过上限");
  }
  if (config.components.length > GAME_TEMPLATE_V2_LIMITS.components) {
    addSizeIssue("$.components", "模板组件数量超过上限");
  }

  const stableKeys = new Set<string>();
  const sectionKeys = new Set<string>();
  const activeSectionKeys = new Set<string>();
  const claimedRoles = new Set<string>();
  const componentByKey = new Map<string, Record<string, unknown>>();
  const claimStableKey = (value: unknown, path: string): void => {
    if (typeof value !== "string" || !STABLE_KEY_PATTERN.test(value)) {
      addIssue("TEMPLATE_COMPONENT_INVALID", path, "stableKey 格式无效");
      return;
    }
    if (stableKeys.has(value)) {
      addIssue("TEMPLATE_COMPONENT_INVALID", path, "stableKey 必须全局唯一");
      return;
    }
    stableKeys.add(value);
  };
  const claimSemanticRole = (value: unknown, path: string): void => {
    if (typeof value !== "string" || value === "CUSTOM") return;
    if (claimedRoles.has(value)) {
      addIssue("TEMPLATE_COMPONENT_INVALID", path, "业务语义角色必须唯一");
      return;
    }
    claimedRoles.add(value);
  };

  config.sections.forEach((section, index) => {
    if (!isRecord(section)) {
      addIssue(
        "TEMPLATE_COMPONENT_INVALID",
        `$.sections[${index}]`,
        "区块结构无效",
      );
      return;
    }
    claimStableKey(section.stableKey, `$.sections[${index}].stableKey`);
    const layout = isRecord(section.layout) ? section.layout : undefined;
    if (
      !validLabel(section.label) ||
      !validHelpText(section.description) ||
      typeof section.enabled !== "boolean" ||
      typeof section.sortOrder !== "number" ||
      !Number.isInteger(section.sortOrder) ||
      section.sortOrder < 0 ||
      !layout ||
      ![1, 2, 3, 4].includes(layout.columns as number) ||
      (layout.density !== undefined &&
        layout.density !== "comfortable" &&
        layout.density !== "compact") ||
      (layout.align !== undefined &&
        layout.align !== "left" &&
        layout.align !== "center")
    ) {
      addIssue(
        "TEMPLATE_COMPONENT_INVALID",
        `$.sections[${index}]`,
        "区块名称、说明、状态、顺序或布局无效",
      );
    }
    if (!validAudiences(section.audiences)) {
      addIssue(
        "TEMPLATE_COMPONENT_INVALID",
        `$.sections[${index}].audiences`,
        "端口可见性标记必须是非空数组，且元素只能是 CS 或 CUSTOMER",
      );
    }
    if (
      typeof section.stableKey === "string" &&
      STABLE_KEY_PATTERN.test(section.stableKey)
    ) {
      sectionKeys.add(section.stableKey);
      if (section.enabled === true) activeSectionKeys.add(section.stableKey);
    }
  });

  config.components.forEach((component, index) => {
    if (!isRecord(component)) {
      addIssue(
        "TEMPLATE_COMPONENT_INVALID",
        `$.components[${index}]`,
        "组件结构无效",
      );
      return;
    }
    const componentKey =
      typeof component.stableKey === "string" ? component.stableKey : undefined;
    const componentLayout = isRecord(component.layout)
      ? component.layout
      : undefined;
    if (
      !validLabel(component.label) ||
      !validHelpText(component.description) ||
      typeof component.enabled !== "boolean" ||
      typeof component.sortOrder !== "number" ||
      !Number.isInteger(component.sortOrder) ||
      component.sortOrder < 0 ||
      !componentLayout ||
      ![1, 2, 3, 4].includes(componentLayout.colSpan as number) ||
      typeof componentLayout.rowBreakBefore !== "boolean"
    ) {
      addIssue(
        "TEMPLATE_COMPONENT_INVALID",
        `$.components[${index}]`,
        "组件名称、说明、状态、顺序或布局无效",
        componentKey,
      );
    }
    if (!validAudiences(component.audiences)) {
      addIssue(
        "TEMPLATE_COMPONENT_INVALID",
        `$.components[${index}].audiences`,
        "端口可见性标记必须是非空数组，且元素只能是 CS 或 CUSTOMER",
        componentKey,
      );
    }
    claimStableKey(component.stableKey, `$.components[${index}].stableKey`);
    if (typeof component.stableKey === "string") {
      componentByKey.set(component.stableKey, component);
    }
    if (
      typeof component.sectionKey !== "string" ||
      !sectionKeys.has(component.sectionKey)
    ) {
      addIssue(
        "TEMPLATE_BINDING_INVALID",
        `$.components[${index}].sectionKey`,
        "组件引用的区块不存在",
        componentKey,
      );
    }
    if (component.kind === "FIELD") {
      claimSemanticRole(
        component.semanticRole,
        `$.components[${index}].semanticRole`,
      );
      if (
        typeof component.fieldType !== "string" ||
        !FIELD_TYPE_SET.has(component.fieldType) ||
        typeof component.semanticRole !== "string" ||
        !SEMANTIC_ROLE_SET.has(component.semanticRole) ||
        typeof component.required !== "boolean" ||
        !validHelpText(component.placeholder)
      ) {
        addIssue(
          "TEMPLATE_COMPONENT_INVALID",
          `$.components[${index}]`,
          "字段类型、语义角色或必填设置无效",
          componentKey,
        );
      } else if (CHOICE_FIELD_TYPES.has(component.fieldType)) {
        validateChoiceOptions(
          component.options,
          `$.components[${index}].options`,
          componentKey,
          addIssue,
        );
        if (
          component.fieldType === "MULTI_SELECT" &&
          component.aggregationPolicy !== "SUM" &&
          component.aggregationPolicy !== "MAX"
        ) {
          addIssue(
            "TEMPLATE_COMPONENT_INVALID",
            `$.components[${index}].aggregationPolicy`,
            "多选字段必须声明 SUM 或 MAX 聚合策略",
            componentKey,
          );
        }
      } else if (component.options !== undefined) {
        addIssue(
          "TEMPLATE_COMPONENT_INVALID",
          `$.components[${index}].options`,
          "非选择字段不能配置选项",
          componentKey,
        );
      }
    } else if (component.kind === "REPEATABLE_TABLE") {
      if (
        !Array.isArray(component.columns) ||
        !Array.isArray(component.defaultRows)
      ) {
        addIssue(
          "TEMPLATE_COMPONENT_INVALID",
          `$.components[${index}]`,
          "可重复表格必须包含列和默认行数组",
          componentKey,
        );
      }
    } else if (component.kind === "NOTE") {
      if (
        typeof component.text !== "string" ||
        component.text.length > GAME_TEMPLATE_V2_LIMITS.helpTextCharacters
      ) {
        addIssue(
          "TEMPLATE_COMPONENT_INVALID",
          `$.components[${index}].text`,
          "说明组件必须包含纯文本",
          componentKey,
        );
      }
    } else {
      addIssue(
        "TEMPLATE_COMPONENT_INVALID",
        `$.components[${index}].kind`,
        "未知组件类型",
        componentKey,
      );
    }
    if (
      component.kind === "REPEATABLE_TABLE" &&
      Array.isArray(component.columns) &&
      component.columns.length > GAME_TEMPLATE_V2_LIMITS.tableColumns
    ) {
      addSizeIssue(`$.components[${index}].columns`, "可重复表格列数超过上限");
    }
    if (
      component.kind === "REPEATABLE_TABLE" &&
      Array.isArray(component.defaultRows) &&
      component.defaultRows.length > GAME_TEMPLATE_V2_LIMITS.defaultRows
    ) {
      addSizeIssue(
        `$.components[${index}].defaultRows`,
        "可重复表格默认行数超过上限",
      );
    }
    if (
      component.kind === "FIELD" &&
      Array.isArray(component.options) &&
      component.options.length > GAME_TEMPLATE_V2_LIMITS.choiceOptions
    ) {
      addSizeIssue(`$.components[${index}].options`, "字段选项数量超过上限");
    }
    if (
      component.kind === "REPEATABLE_TABLE" &&
      Array.isArray(component.columns)
    ) {
      const columns = component.columns;
      const columnKeys = new Set<string>();
      const columnByKey = new Map<string, Record<string, unknown>>();
      columns.forEach((column, columnIndex) => {
        if (!isRecord(column)) {
          addIssue(
            "TEMPLATE_COMPONENT_INVALID",
            `$.components[${index}].columns[${columnIndex}]`,
            "表格列结构无效",
            componentKey,
          );
          return;
        }
        claimStableKey(
          column.stableKey,
          `$.components[${index}].columns[${columnIndex}].stableKey`,
        );
        if (typeof column.stableKey === "string") {
          columnKeys.add(column.stableKey);
          columnByKey.set(column.stableKey, column);
        }
        claimSemanticRole(
          column.semanticRole,
          `$.components[${index}].columns[${columnIndex}].semanticRole`,
        );
        if (
          typeof column.columnType !== "string" ||
          !TABLE_COLUMN_TYPE_SET.has(column.columnType) ||
          typeof column.semanticRole !== "string" ||
          !SEMANTIC_ROLE_SET.has(column.semanticRole) ||
          typeof column.required !== "boolean" ||
          !validLabel(column.label)
        ) {
          addIssue(
            "TEMPLATE_COMPONENT_INVALID",
            `$.components[${index}].columns[${columnIndex}]`,
            "表格列类型、语义角色或必填设置无效",
            componentKey,
          );
        } else if (column.columnType === "SINGLE_SELECT") {
          validateChoiceOptions(
            column.options,
            `$.components[${index}].columns[${columnIndex}].options`,
            componentKey,
            addIssue,
          );
        } else if (column.options !== undefined) {
          addIssue(
            "TEMPLATE_COMPONENT_INVALID",
            `$.components[${index}].columns[${columnIndex}].options`,
            "非选择表格列不能配置选项",
            componentKey,
          );
        }
      });
      if (Array.isArray(component.defaultRows)) {
        component.defaultRows.forEach((row, rowIndex) => {
          if (
            !isRecord(row) ||
            Object.keys(row).some((key) => !columnKeys.has(key))
          ) {
            addIssue(
              "TEMPLATE_COMPONENT_INVALID",
              `$.components[${index}].defaultRows[${rowIndex}]`,
              "默认行只能包含已定义的表格列",
              componentKey,
            );
            return;
          }

          columns.forEach((column) => {
            if (
              isRecord(column) &&
              column.required === true &&
              typeof column.stableKey === "string" &&
              row[column.stableKey] === undefined
            ) {
              addIssue(
                "TEMPLATE_COMPONENT_INVALID",
                `$.components[${index}].defaultRows[${rowIndex}].${column.stableKey}`,
                "默认行缺少必填列",
                componentKey,
              );
            }
          });

          Object.entries(row).forEach(([key, value]) => {
            const column = columnByKey.get(key);
            if (!column) return;

            const validValue =
              (column.columnType === "TEXT" && typeof value === "string") ||
              (column.columnType === "NUMBER" &&
                typeof value === "number" &&
                Number.isInteger(value)) ||
              (column.columnType === "SINGLE_SELECT" &&
                typeof value === "string" &&
                Array.isArray(column.options) &&
                column.options.some(
                  (option) => isRecord(option) && option.value === value,
                ));

            if (!validValue) {
              addIssue(
                "TEMPLATE_COMPONENT_INVALID",
                `$.components[${index}].defaultRows[${rowIndex}].${key}`,
                "默认行的值与表格列类型不匹配",
                componentKey,
              );
            }
          });
        });
      }
    }
  });

  if (config.legacyCompatibility !== undefined) {
    const compatibility = config.legacyCompatibility;
    if (
      !isRecord(compatibility) ||
      !Array.isArray(compatibility.unboundPriceRules)
    ) {
      addIssue(
        "TEMPLATE_PRICE_RULE_INVALID",
        "$.legacyCompatibility",
        "旧价格规则结构无效",
      );
    } else {
      compatibility.unboundPriceRules.forEach((rule, ruleIndex) => {
        if (
          !isRecord(rule) ||
          !validLabel(rule.label) ||
          parseFenString(rule.priceDeltaFen, true) === null ||
          typeof rule.sortOrder !== "number" ||
          !Number.isInteger(rule.sortOrder) ||
          rule.sortOrder < 0
        ) {
          addIssue(
            "TEMPLATE_PRICE_RULE_INVALID",
            `$.legacyCompatibility.unboundPriceRules[${ruleIndex}]`,
            "旧价格规则的名称、金额或排序无效",
          );
        }
      });
    }
  }

  const staffingSource = config.staffingSource;
  if (staffingSource.kind === "FIXED") {
    if (
      typeof staffingSource.count !== "number" ||
      !Number.isInteger(staffingSource.count) ||
      staffingSource.count <= 0
    ) {
      addIssue(
        "TEMPLATE_BINDING_INVALID",
        "$.staffingSource.count",
        "固定人数必须为正整数",
      );
    }
  } else if (staffingSource.kind === "NUMBER_FIELD") {
    const component =
      typeof staffingSource.componentKey === "string"
        ? componentByKey.get(staffingSource.componentKey)
        : undefined;
    if (
      !component ||
      component.kind !== "FIELD" ||
      component.fieldType !== "NUMBER" ||
      component.enabled !== true ||
      typeof component.sectionKey !== "string" ||
      !activeSectionKeys.has(component.sectionKey)
    ) {
      addIssue(
        "TEMPLATE_BINDING_INVALID",
        "$.staffingSource.componentKey",
        "人数来源必须指向启用区块中的数字字段",
      );
    }
  } else if (staffingSource.kind === "REPEATABLE_TABLE_SUM") {
    const component =
      typeof staffingSource.componentKey === "string"
        ? componentByKey.get(staffingSource.componentKey)
        : undefined;
    const columns =
      component && Array.isArray(component.columns) ? component.columns : [];
    const column = columns.find(
      (candidate) =>
        isRecord(candidate) && candidate.stableKey === staffingSource.columnKey,
    );
    if (
      !component ||
      component.kind !== "REPEATABLE_TABLE" ||
      component.enabled !== true ||
      typeof component.sectionKey !== "string" ||
      !activeSectionKeys.has(component.sectionKey) ||
      !isRecord(column) ||
      column.columnType !== "NUMBER" ||
      column.semanticRole !== "STAFFING_COUNT"
    ) {
      addIssue(
        "TEMPLATE_BINDING_INVALID",
        "$.staffingSource",
        "表格人数来源必须指向启用表格的 STAFFING_COUNT 数字列",
      );
    }
  } else {
    addIssue(
      "TEMPLATE_BINDING_INVALID",
      "$.staffingSource.kind",
      "未知人数来源类型",
    );
  }

  return issues;
}

/**
 * 发布前的额外阻断项（只在发布时生效，不影响已发布版本的读取与历史订单）。
 *
 * 产品规则：值类内容（字段 / 表格）必须留给"能填写下单"的端口——目前只有客服。
 * 标成只给客户就没人能填；参与算价或人数的内容更会因此静默少算。
 * 说明类只影响预览，允许只给客户看。客户侧下单面立项后规则自动放宽
 * （见 TEMPLATE_WRITABLE_AUDIENCES_V2）。
 */
export function collectPublishBlockingIssuesV2(
  config: unknown,
): TemplateConfigIssue[] {
  if (
    !isRecord(config) ||
    !Array.isArray(config.sections) ||
    !Array.isArray(config.components)
  ) {
    return [];
  }
  const published = config as unknown as Pick<
    PublishedConfigV2,
    "sections" | "components"
  >;
  const writableLabel = TEMPLATE_WRITABLE_AUDIENCES_V2.map((audience) =>
    audience === "CS" ? "客服" : "客户",
  ).join("、");
  return unwritableValueComponentsV2(
    published,
    TEMPLATE_WRITABLE_AUDIENCES_V2,
  ).map((component) => ({
    code: "TEMPLATE_COMPONENT_INVALID" as const,
    path: `$.components[${published.components.indexOf(component)}].audiences`,
    componentKey: component.stableKey,
    message: `「${component.label}」对${writableLabel}不可见，而${writableLabel}是目前唯一能填写下单的端口：请让它对${writableLabel}可见，或改成说明类内容`,
  }));
}

export function validatePublishedConfigV2(
  config: unknown,
): TemplateConfigIssue[] {
  const issues = validateDraftConfigV2(config);
  if (!isRecord(config)) return issues;

  if (config.documentRendererVersion !== 1) {
    issues.push({
      code: "TEMPLATE_COMPONENT_INVALID",
      path: "$.documentRendererVersion",
      message: "发布配置必须使用受支持的文案渲染器版本",
    });
  }

  const compatibility = config.legacyCompatibility;
  if (
    isRecord(compatibility) &&
    Array.isArray(compatibility.unboundPriceRules) &&
    compatibility.unboundPriceRules.length > 0
  ) {
    issues.push({
      code: "TEMPLATE_LEGACY_REVIEW_REQUIRED",
      path: "$.legacyCompatibility.unboundPriceRules",
      message: "旧价格规则完成绑定前不能发布",
    });
  }

  return issues;
}
