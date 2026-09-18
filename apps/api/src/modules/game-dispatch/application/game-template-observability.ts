/**
 * S5：通用派单模板 v2 的关键路径观测。
 *
 * 设计边界：
 * - 事件名是**固定枚举**，字段走白名单（id / 受控 code / 耗时 / 计数），
 *   绝不写入 config、订单值、客户姓名或手机号等 PII；
 * - 纯函数 `toTemplateEventRecord` 负责裁剪，便于单测断言"多传的键必被丢弃"；
 * - 默认通过 Nest Logger 输出，测试可注入自己的 sink。
 */
import { Logger } from "@nestjs/common";

export const TEMPLATE_EVENTS = {
  LIST: "template.list",
  DRAFT_SAVE_FAILED: "template.draft_save_failed",
  REVISION_CONFLICT: "template.revision_conflict",
  PUBLISH_FAILED: "template.publish_failed",
  VALIDATION_ISSUE: "template.validation_issue",
  DOCUMENT_FAILED: "template.document_failed",
  ORDER_CREATE_FAILED: "template.order_create_failed",
  VERSION_MISMATCH: "template.version_mismatch",
  /** 下单时提交了该端口看不到的字段值：值被丢弃（V-5），这里只记条数。 */
  FIELD_VALUES_DROPPED: "template.field_values_dropped",
} as const;

export type TemplateEvent =
  (typeof TEMPLATE_EVENTS)[keyof typeof TEMPLATE_EVENTS];

/** 允许出现在日志里的字段：只放 id、受控 code/枚举与数字。 */
export interface TemplateEventFields {
  tenantId?: string;
  actorId?: string;
  templateId?: string;
  versionId?: string;
  orderId?: string;
  code?: string;
  issueCode?: string;
  outcome?: "ok" | "failed";
  durationMs?: number;
  count?: number;
}

export interface TemplateEventRecord extends TemplateEventFields {
  event: TemplateEvent;
}

export interface TemplateEventSink {
  info(record: TemplateEventRecord): void;
}

const ALLOWED_KEYS: readonly (keyof TemplateEventFields)[] = [
  "tenantId",
  "actorId",
  "templateId",
  "versionId",
  "orderId",
  "code",
  "issueCode",
  "outcome",
  "durationMs",
  "count",
];

/** 白名单裁剪：任何未声明的键（含未来的 PII 误传）都不会进入日志。 */
export function toTemplateEventRecord(
  event: TemplateEvent,
  fields: Record<string, unknown> = {},
): TemplateEventRecord {
  const record: TemplateEventRecord = { event };
  for (const key of ALLOWED_KEYS) {
    const value = fields[key];
    if (value === undefined) continue;
    if (key === "durationMs" || key === "count") {
      if (typeof value === "number" && Number.isFinite(value)) {
        record[key] = Math.max(0, Math.trunc(value));
      }
      continue;
    }
    if (key === "outcome") {
      if (value === "ok" || value === "failed") record.outcome = value;
      continue;
    }
    if (typeof value === "string" && value.length <= 200) {
      record[key] = value;
    }
  }
  return record;
}

const defaultSink: TemplateEventSink = {
  info: (record) => new Logger("TemplateV2").log(JSON.stringify(record)),
};

/** 发出一个受控事件；失败绝不影响业务结果（观测是旁路）。 */
export function emitTemplateEvent(
  event: TemplateEvent,
  fields: Record<string, unknown> = {},
  sink: TemplateEventSink = defaultSink,
): void {
  try {
    sink.info(toTemplateEventRecord(event, fields));
  } catch {
    // 观测失败不影响业务：这里刻意吞掉，且不写入任何用户数据。
  }
}

/** 计时辅助：把一段异步逻辑的耗时与结果一起打成一条事件。 */
export async function withTemplateTiming<T>(
  event: TemplateEvent,
  fields: Record<string, unknown>,
  run: () => Promise<T>,
  sink: TemplateEventSink = defaultSink,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    emitTemplateEvent(
      event,
      { ...fields, outcome: "ok", durationMs: Date.now() - startedAt },
      sink,
    );
    return result;
  } catch (error) {
    emitTemplateEvent(
      event,
      {
        ...fields,
        outcome: "failed",
        durationMs: Date.now() - startedAt,
        ...(typeof (error as { code?: unknown })?.code === "string"
          ? { code: (error as { code: string }).code }
          : {}),
      },
      sink,
    );
    throw error;
  }
}
