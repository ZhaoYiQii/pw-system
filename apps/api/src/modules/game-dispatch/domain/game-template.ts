import type { MoneyFen } from "../../../common/money.js";

export const GAME_TEMPLATE_FIELD_TYPES = [
  "text",
  "select",
  "multiline",
  "datetime",
  "duration",
  "note",
] as const;

export type GameTemplateFieldType = (typeof GAME_TEMPLATE_FIELD_TYPES)[number];

export interface TemplateFieldInput {
  fieldKey: string;
  label: string;
  fieldType: GameTemplateFieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string | null;
  sortOrder?: number;
  enabled?: boolean;
}

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
  positions?: TemplatePositionInput[];
  rankRules?: TemplateRankRuleInput[];
  copyLines?: TemplateCopyLineInput[];
}

export interface UpdateGameTemplateInput {
  name?: string;
  enabled?: boolean;
  fields?: TemplateFieldInput[];
  positions?: TemplatePositionInput[];
  rankRules?: TemplateRankRuleInput[];
  copyLines?: TemplateCopyLineInput[];
}

export interface TemplateFieldView {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: GameTemplateFieldType;
  required: boolean;
  options: string[];
  placeholder: string | null;
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
  fields: TemplateFieldView[];
  positions: TemplatePositionView[];
  rankRules: TemplateRankRuleView[];
  copyLines: TemplateCopyLineView[];
  createdAt: Date;
  updatedAt: Date;
}
