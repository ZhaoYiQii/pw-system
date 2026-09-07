import type {
  CreateGameTemplateInput,
  GameTemplateView,
  TemplateCopyLineInput,
  TemplateFieldInput,
  TemplatePositionInput,
  TemplateRankRuleInput,
  UpdateGameTemplateInput,
} from "../domain/game-template.js";
import { GAME_TEMPLATE_FIELD_TYPES } from "../domain/game-template.js";
import {
  DuplicateGameTemplateError,
  InvalidGameTemplateError,
} from "../domain/errors.js";
import type { MoneyFen } from "../../../common/money.js";
import { parseFenString } from "../../../common/money.js";

export interface GameTemplateRepository {
  list(tenantId: string): Promise<GameTemplateView[]>;
  get(tenantId: string, id: string): Promise<GameTemplateView | null>;
  create(
    tenantId: string,
    input: CreateGameTemplateInput,
  ): Promise<GameTemplateView>;
  update(
    tenantId: string,
    id: string,
    input: UpdateGameTemplateInput,
  ): Promise<GameTemplateView | null>;
  remove(tenantId: string, id: string): Promise<boolean>;
  copy(
    tenantId: string,
    id: string,
    newName: string,
  ): Promise<GameTemplateView | null>;
}

const NAME_MAX = 60;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

function trimRequired(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim().length < 1) {
    throw new InvalidGameTemplateError(`${label} 必填`);
  }
  const clean = value.trim();
  if (clean.length > max) {
    throw new InvalidGameTemplateError(`${label} 超过 ${max} 字符`);
  }
  return clean;
}

function cleanFields(fields: unknown): TemplateFieldInput[] | undefined {
  if (fields === undefined) return undefined;
  if (!Array.isArray(fields)) {
    throw new InvalidGameTemplateError("fields 必须为数组");
  }
  return fields.map((f, index) => {
    const raw = (f ?? {}) as Record<string, unknown>;
    const fieldKey = trimRequired(raw.fieldKey, "字段标识", 40);
    if (!KEY_PATTERN.test(fieldKey)) {
      throw new InvalidGameTemplateError(
        `字段标识 ${fieldKey} 需为小写字母开头，仅含小写字母/数字/_`,
      );
    }
    const fieldType = String(raw.fieldType ?? "text");
    if (!GAME_TEMPLATE_FIELD_TYPES.includes(fieldType as never)) {
      throw new InvalidGameTemplateError(`不支持字段类型：${fieldType}`);
    }
    const label = trimRequired(raw.label, "字段名称", 40);
    const options = Array.isArray(raw.options) ? raw.options : [];
    if (
      options.some(
        (o) => typeof o !== "string" || o.trim().length < 1 || o.length > 50,
      )
    ) {
      throw new InvalidGameTemplateError("选项需为非空字符串，最长 50 字符");
    }
    const sortOrder =
      raw.sortOrder === undefined
        ? index
        : Number.isInteger(raw.sortOrder)
          ? Number(raw.sortOrder)
          : index;
    return {
      fieldKey,
      label,
      fieldType: fieldType as TemplateFieldInput["fieldType"],
      required: raw.required === true,
      options: options as string[],
      placeholder: typeof raw.placeholder === "string" ? raw.placeholder : null,
      sortOrder,
      enabled: raw.enabled !== false,
    };
  });
}

function cleanPositions(
  positions: unknown,
): TemplatePositionInput[] | undefined {
  if (positions === undefined) return undefined;
  if (!Array.isArray(positions)) {
    throw new InvalidGameTemplateError("positions 必须为数组");
  }
  return positions.map((p, index) => {
    const raw = (p ?? {}) as Record<string, unknown>;
    const label = trimRequired(raw.label, "位置名称", 40);
    const count = raw.defaultCount === undefined ? 1 : Number(raw.defaultCount);
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      throw new InvalidGameTemplateError("位置默认人数需为 1-10");
    }
    return {
      label,
      defaultCount: count,
      enabled: raw.enabled !== false,
      sortOrder: Number.isInteger(raw.sortOrder)
        ? Number(raw.sortOrder)
        : index,
    };
  });
}

function cleanRankRules(
  rankRules: unknown,
): TemplateRankRuleInput[] | undefined {
  if (rankRules === undefined) return undefined;
  if (!Array.isArray(rankRules)) {
    throw new InvalidGameTemplateError("rankRules 必须为数组");
  }
  return rankRules.map((r, index) => {
    const raw = (r ?? {}) as Record<string, unknown>;
    const rankLabel = trimRequired(raw.rankLabel, "段位名称", 40);
    const addPriceFen = parseFenString(raw.addPriceFen, true);
    if (addPriceFen === null) {
      throw new InvalidGameTemplateError(
        "段位加价必须为非负整数十进制字符串（分）",
      );
    }
    return {
      rankLabel,
      addPriceFen: addPriceFen as MoneyFen,
      sortOrder: Number.isInteger(raw.sortOrder)
        ? Number(raw.sortOrder)
        : index,
    };
  });
}

function cleanCopyLines(
  copyLines: unknown,
): TemplateCopyLineInput[] | undefined {
  if (copyLines === undefined) return undefined;
  if (!Array.isArray(copyLines)) {
    throw new InvalidGameTemplateError("copyLines 必须为数组");
  }
  return copyLines.map((c) => {
    const raw = (c ?? {}) as Record<string, unknown>;
    return {
      label: trimRequired(raw.label, "文案行", 200),
      valueKey: typeof raw.valueKey === "string" ? raw.valueKey : null,
    };
  });
}

export class GameTemplateService {
  constructor(private readonly repository: GameTemplateRepository) {}

  async list(tenantId: string): Promise<GameTemplateView[]> {
    return this.repository.list(tenantId);
  }

  async get(tenantId: string, id: string): Promise<GameTemplateView> {
    const row = await this.repository.get(tenantId, id);
    if (!row) throw new InvalidGameTemplateError("模板不存在");
    return row;
  }

  async create(
    tenantId: string,
    input: CreateGameTemplateInput,
  ): Promise<GameTemplateView> {
    const name = trimRequired(input.name, "模板名称", NAME_MAX);
    const payload: CreateGameTemplateInput = {
      name,
      enabled: input.enabled !== false,
    };
    const fields = cleanFields(input.fields);
    if (fields) payload.fields = fields;
    const positions = cleanPositions(input.positions);
    if (positions) payload.positions = positions;
    const rankRules = cleanRankRules(input.rankRules);
    if (rankRules) payload.rankRules = rankRules;
    const copyLines = cleanCopyLines(input.copyLines);
    if (copyLines) payload.copyLines = copyLines;
    try {
      return await this.repository.create(tenantId, payload);
    } catch (error) {
      if (error instanceof DuplicateGameTemplateError) throw error;
      if (error instanceof InvalidGameTemplateError) throw error;
      throw error;
    }
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateGameTemplateInput,
  ): Promise<GameTemplateView> {
    const clean: UpdateGameTemplateInput = {};
    if (input.name !== undefined) {
      clean.name = trimRequired(input.name, "模板名称", NAME_MAX);
    }
    if (input.enabled !== undefined) clean.enabled = input.enabled;
    const fields = cleanFields(input.fields);
    if (fields) clean.fields = fields;
    const positions = cleanPositions(input.positions);
    if (positions) clean.positions = positions;
    const rankRules = cleanRankRules(input.rankRules);
    if (rankRules) clean.rankRules = rankRules;
    const copyLines = cleanCopyLines(input.copyLines);
    if (copyLines) clean.copyLines = copyLines;
    const row = await this.repository.update(tenantId, id, clean);
    if (!row) throw new InvalidGameTemplateError("模板不存在");
    return row;
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const ok = await this.repository.remove(tenantId, id);
    if (!ok) throw new InvalidGameTemplateError("模板不存在");
  }

  async copy(tenantId: string, id: string): Promise<GameTemplateView> {
    const source = await this.repository.get(tenantId, id);
    if (!source) throw new InvalidGameTemplateError("模板不存在");
    const newName = `${source.name} 副本`;
    const row = await this.repository.copy(tenantId, id, newName);
    if (!row) throw new InvalidGameTemplateError("模板不存在");
    return row;
  }
}
