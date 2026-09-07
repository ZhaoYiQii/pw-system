import type { PrismaClient } from "@pw/database";
import type {
  CreateGameTemplateInput,
  GameTemplateView,
  TemplateCopyLineView,
  TemplateFieldView,
  TemplatePositionView,
  TemplateRankRuleView,
  UpdateGameTemplateInput,
} from "../domain/game-template.js";
import { GAME_TEMPLATE_FIELD_TYPES } from "../domain/game-template.js";
import { DuplicateGameTemplateError } from "../domain/errors.js";
import type { GameTemplateRepository } from "../application/game-template.service.js";

function isP2002(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export class PrismaGameTemplateRepository implements GameTemplateRepository {
  constructor(private readonly client: PrismaClient) {}

  async list(tenantId: string): Promise<GameTemplateView[]> {
    const rows = await this.client.gameDispatchTemplate.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    return Promise.all(rows.map((row) => this.assemble(row.id)));
  }

  async get(tenantId: string, id: string): Promise<GameTemplateView | null> {
    const row = await this.client.gameDispatchTemplate.findFirst({
      where: { tenantId, id },
    });
    if (!row) return null;
    return this.assemble(row.id);
  }

  async create(
    tenantId: string,
    input: CreateGameTemplateInput,
  ): Promise<GameTemplateView> {
    const templateId = await this.client.$transaction(async (tx) => {
      const template = await tx.gameDispatchTemplate.create({
        data: {
          tenantId,
          name: input.name,
          enabled: input.enabled ?? true,
          copyLines: JSON.parse(JSON.stringify(input.copyLines ?? [])),
        },
      });
      if (input.fields && input.fields.length > 0) {
        await tx.gameDispatchTemplateField.createMany({
          data: input.fields.map((f) => ({
            tenantId,
            templateId: template.id,
            fieldKey: f.fieldKey,
            label: f.label,
            fieldType: f.fieldType,
            required: f.required ?? false,
            options: JSON.parse(JSON.stringify(f.options ?? [])),
            placeholder: f.placeholder ?? null,
            sortOrder: f.sortOrder ?? 0,
            enabled: f.enabled ?? true,
          })),
        });
      }
      if (input.positions && input.positions.length > 0) {
        await tx.gameDispatchPosition.createMany({
          data: input.positions.map((p) => ({
            tenantId,
            templateId: template.id,
            label: p.label,
            defaultCount: p.defaultCount ?? 1,
            enabled: p.enabled ?? true,
            sortOrder: p.sortOrder ?? 0,
          })),
        });
      }
      if (input.rankRules && input.rankRules.length > 0) {
        await tx.gameDispatchRankRule.createMany({
          data: input.rankRules.map((r) => ({
            tenantId,
            templateId: template.id,
            rankLabel: r.rankLabel,
            addPriceFen: BigInt(r.addPriceFen),
            sortOrder: r.sortOrder ?? 0,
          })),
        });
      }
      return template.id;
    });
    return this.assemble(templateId);
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateGameTemplateInput,
  ): Promise<GameTemplateView | null> {
    const exists = await this.client.$transaction(async (tx) => {
      const existing = await tx.gameDispatchTemplate.findFirst({
        where: { tenantId, id },
      });
      if (!existing) return false;
      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.enabled !== undefined) data.enabled = input.enabled;
      if (input.copyLines !== undefined) {
        data.copyLines = JSON.parse(JSON.stringify(input.copyLines));
      }
      if (Object.keys(data).length > 0) {
        await tx.gameDispatchTemplate.update({ where: { id }, data });
      }
      if (input.fields !== undefined) {
        await tx.gameDispatchTemplateField.deleteMany({
          where: { tenantId, templateId: id },
        });
        if (input.fields.length > 0) {
          await tx.gameDispatchTemplateField.createMany({
            data: input.fields.map((f) => ({
              tenantId,
              templateId: id,
              fieldKey: f.fieldKey,
              label: f.label,
              fieldType: f.fieldType,
              required: f.required ?? false,
              options: JSON.parse(JSON.stringify(f.options ?? [])),
              placeholder: f.placeholder ?? null,
              sortOrder: f.sortOrder ?? 0,
              enabled: f.enabled ?? true,
            })),
          });
        }
      }
      if (input.positions !== undefined) {
        await tx.gameDispatchPosition.deleteMany({
          where: { tenantId, templateId: id },
        });
        if (input.positions.length > 0) {
          await tx.gameDispatchPosition.createMany({
            data: input.positions.map((p) => ({
              tenantId,
              templateId: id,
              label: p.label,
              defaultCount: p.defaultCount ?? 1,
              enabled: p.enabled ?? true,
              sortOrder: p.sortOrder ?? 0,
            })),
          });
        }
      }
      if (input.rankRules !== undefined) {
        await tx.gameDispatchRankRule.deleteMany({
          where: { tenantId, templateId: id },
        });
        if (input.rankRules.length > 0) {
          await tx.gameDispatchRankRule.createMany({
            data: input.rankRules.map((r) => ({
              tenantId,
              templateId: id,
              rankLabel: r.rankLabel,
              addPriceFen: BigInt(r.addPriceFen),
              sortOrder: r.sortOrder ?? 0,
            })),
          });
        }
      }
      return true;
    });
    if (!exists) return null;
    return this.assemble(id);
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    const row = await this.client.gameDispatchTemplate.findFirst({
      where: { tenantId, id },
    });
    if (!row) return false;
    await this.client.gameDispatchTemplate.delete({ where: { id } });
    return true;
  }

  async copy(
    tenantId: string,
    id: string,
    newName: string,
  ): Promise<GameTemplateView | null> {
    const source = await this.get(tenantId, id);
    if (!source) return null;
    try {
      return await this.create(tenantId, {
        name: newName,
        enabled: source.enabled,
        fields: source.fields.map((f) => ({
          fieldKey: f.fieldKey,
          label: f.label,
          fieldType: f.fieldType,
          required: f.required,
          options: f.options,
          placeholder: f.placeholder,
          sortOrder: f.sortOrder,
          enabled: f.enabled,
        })),
        positions: source.positions.map((p) => ({
          label: p.label,
          defaultCount: p.defaultCount,
          enabled: p.enabled,
          sortOrder: p.sortOrder,
        })),
        rankRules: source.rankRules.map((r) => ({
          rankLabel: r.rankLabel,
          addPriceFen: r.addPriceFen,
          sortOrder: r.sortOrder,
        })),
        copyLines: source.copyLines.map((c) => ({
          label: c.label,
          valueKey: c.valueKey,
        })),
      });
    } catch (error) {
      if (isP2002(error)) throw new DuplicateGameTemplateError(newName);
      throw error;
    }
  }

  private async assemble(id: string): Promise<GameTemplateView> {
    const [template, fields, positions, rankRules] = await Promise.all([
      this.client.gameDispatchTemplate.findUniqueOrThrow({ where: { id } }),
      this.client.gameDispatchTemplateField.findMany({
        where: { templateId: id },
        orderBy: { sortOrder: "asc" },
      }),
      this.client.gameDispatchPosition.findMany({
        where: { templateId: id },
        orderBy: { sortOrder: "asc" },
      }),
      this.client.gameDispatchRankRule.findMany({
        where: { templateId: id },
        orderBy: { sortOrder: "asc" },
      }),
    ]);
    const copyLines = (template.copyLines ?? []) as unknown as
      TemplateCopyLineView[] | null;
    return {
      id: template.id,
      tenantId: template.tenantId,
      name: template.name,
      enabled: template.enabled,
      fields: fields.map<TemplateFieldView>((f) => ({
        id: f.id,
        fieldKey: f.fieldKey,
        label: f.label,
        fieldType: GAME_TEMPLATE_FIELD_TYPES.includes(
          f.fieldType as (typeof GAME_TEMPLATE_FIELD_TYPES)[number],
        )
          ? (f.fieldType as TemplateFieldView["fieldType"])
          : "text",
        required: f.required,
        options: (f.options ?? []) as unknown as string[],
        placeholder: f.placeholder,
        sortOrder: f.sortOrder,
        enabled: f.enabled,
      })),
      positions: positions.map<TemplatePositionView>((p) => ({
        id: p.id,
        label: p.label,
        defaultCount: p.defaultCount,
        enabled: p.enabled,
        sortOrder: p.sortOrder,
      })),
      rankRules: rankRules.map<TemplateRankRuleView>((r) => ({
        id: r.id,
        rankLabel: r.rankLabel,
        addPriceFen: r.addPriceFen.toString(),
        sortOrder: r.sortOrder,
      })),
      copyLines: Array.isArray(copyLines) ? copyLines : [],
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }
}
