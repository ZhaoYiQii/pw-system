import type { MoneyFen } from "../../../common/money.js";
import type { PublishedConfigV2 } from "./game-template-config-v2.js";

export const GAME_TEMPLATE_FIELD_TYPES = [
  "text",
  "select",
  "multiline",
  "datetime",
  "duration",
  "note",
] as const;

export type GameTemplateFieldType = (typeof GAME_TEMPLATE_FIELD_TYPES)[number];

export const GAME_TEMPLATE_SEMANTIC_ROLES = [
  "CUSTOM",
  "MODE",
  "TARGET_RANK",
  "CURRENT_RANK",
  "DURATION_MINUTES",
  "SERVER_REGION",
  "CONTACT",
  "ORDER_NOTE",
  "STAFFING_LABEL",
  "STAFFING_COUNT",
] as const;

export type GameTemplateSemanticRole =
  (typeof GAME_TEMPLATE_SEMANTIC_ROLES)[number];

export const GAME_TEMPLATE_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
] as const;

export type GameTemplateStatus = (typeof GAME_TEMPLATE_STATUSES)[number];

export interface TemplateFieldInput {
  fieldKey: string;
  label: string;
  fieldType: GameTemplateFieldType;
  semanticRole?: GameTemplateSemanticRole;
  required?: boolean;
  options?: string[];
  placeholder?: string | null;
  sectionId?: string | null;
  colSpan?: number;
  rowBreakBefore?: boolean;
  sortOrder?: number;
  enabled?: boolean;
}

/** 表单分区（模块）：门店可自定义名称、列数与顺序。 */
export interface TemplateSectionInput {
  name: string;
  columns?: number;
  sortOrder?: number;
  enabled?: boolean;
}

/**
 * 系统区块的自定义标题：岗位席位 / 段位加价 / 复制文案。
 * 门店可以不用默认叫法（例如把"岗位席位"改成"陪玩配置"）。
 */
export const BLOCK_LABEL_KEYS = [
  "positions",
  "rankRules",
  "copyLines",
] as const;
export type BlockLabelKey = (typeof BLOCK_LABEL_KEYS)[number];

/** 区块（分区）外观：门店可自定义样式，不需要改代码。 */
export const SECTION_VARIANTS = ["card", "plain", "divider"] as const;
export const SECTION_DENSITIES = ["comfortable", "compact"] as const;
export const SECTION_ALIGNS = ["left", "center"] as const;

export interface TemplateSectionStyle {
  variant?: (typeof SECTION_VARIANTS)[number];
  density?: (typeof SECTION_DENSITIES)[number];
  align?: (typeof SECTION_ALIGNS)[number];
}

export type TemplateBlockLabels = Partial<Record<BlockLabelKey, string>> & {
  /** 按区块名称存样式：{ "需求信息": { variant: "plain", density: "compact" } } */
  sections?: Record<string, TemplateSectionStyle>;
};

export interface TemplatePositionInput {
  label: string;
  defaultCount?: number;
  enabled?: boolean;
  sortOrder?: number;
}

export interface TemplateRankRuleInput {
  rankLabel: string;
  addPriceFen: MoneyFen;
  sortOrder?: number;
}

export interface TemplateCopyLineInput {
  label: string;
  valueKey?: string | null;
}

export interface CreateGameTemplateInput {
  name: string;
  enabled?: boolean;
  fields?: TemplateFieldInput[];
  sections?: TemplateSectionInput[];
  blockLabels?: TemplateBlockLabels;
  positions?: TemplatePositionInput[];
  rankRules?: TemplateRankRuleInput[];
  copyLines?: TemplateCopyLineInput[];
}

export interface UpdateGameTemplateInput {
  name?: string;
  enabled?: boolean;
  fields?: TemplateFieldInput[];
  sections?: TemplateSectionInput[];
  blockLabels?: TemplateBlockLabels;
  positions?: TemplatePositionInput[];
  rankRules?: TemplateRankRuleInput[];
  copyLines?: TemplateCopyLineInput[];
}

export interface TemplateFieldView {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: GameTemplateFieldType;
  semanticRole?: GameTemplateSemanticRole;
  required: boolean;
  options: string[];
  placeholder: string | null;
  sectionId: string | null;
  colSpan: number;
  rowBreakBefore: boolean;
  sortOrder: number;
  enabled: boolean;
}

export interface TemplateSectionView {
  id: string;
  name: string;
  columns: number;
  sortOrder: number;
  enabled: boolean;
}

export interface TemplatePositionView {
  id: string;
  label: string;
  defaultCount: number;
  enabled: boolean;
  sortOrder: number;
}

export interface TemplateRankRuleView {
  id: string;
  rankLabel: string;
  addPriceFen: MoneyFen;
  sortOrder: number;
}

export interface TemplateCopyLineView {
  label: string;
  valueKey: string | null;
}

export interface GameTemplateView {
  id: string;
  tenantId: string;
  name: string;
  enabled: boolean;
  sections: TemplateSectionView[];
  blockLabels: TemplateBlockLabels;
  fields: TemplateFieldView[];
  positions: TemplatePositionView[];
  rankRules: TemplateRankRuleView[];
  copyLines: TemplateCopyLineView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PublishedGameTemplateFieldV1 {
  fieldKey: string;
  label: string;
  fieldType: GameTemplateFieldType;
  semanticRole: GameTemplateSemanticRole;
  required: boolean;
  options: string[];
  placeholder: string | null;
  sectionId: string | null;
  colSpan: number;
  rowBreakBefore: boolean;
  sortOrder: number;
  enabled: boolean;
}

export interface PublishedGameTemplateSectionV1 {
  id: string;
  name: string;
  columns: number;
  sortOrder: number;
  enabled: boolean;
}

export interface PublishedGameTemplatePositionV1 {
  label: string;
  defaultCount: number;
  enabled: boolean;
  sortOrder: number;
}

export interface PublishedGameTemplateRankRuleV1 {
  rankLabel: string;
  addPriceFen: MoneyFen;
  sortOrder: number;
}

export interface PublishedGameTemplateConfigV1 {
  schemaVersion: 1;
  templateId: string;
  gameId: string | null;
  templateName: string;
  description: string | null;
  sections: PublishedGameTemplateSectionV1[];
  fields: PublishedGameTemplateFieldV1[];
  positions: PublishedGameTemplatePositionV1[];
  rankRules: PublishedGameTemplateRankRuleV1[];
  copyLines: TemplateCopyLineView[];
  blockLabels: TemplateBlockLabels;
}

export type GameTemplateVersionConfig =
  PublishedGameTemplateConfigV1 | PublishedConfigV2;

export interface GameTemplateSummary {
  id: string;
  gameId: string | null;
  name: string;
  description: string | null;
  status: GameTemplateStatus;
  activeVersionId: string | null;
  activeVersionNo: number | null;
  revision: number;
  isDefault: boolean;
  lastUsedAt: Date | null;
  updatedAt: Date;
  updatedBy: string | null;
}
