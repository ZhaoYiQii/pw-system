import { z } from "zod";

export const fenMoney = (description: string) =>
  z
    .string()
    .regex(/^(?:0|[1-9][0-9]*)$/, `${description} 必须为十进制字符串分`);

export const positiveFenMoney = (description: string) =>
  fenMoney(description).refine((v) => v !== "0", {
    message: `${description} 必须大于 0`,
  });

export const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .optional();

export const durationSeconds = (minimum = 1) =>
  z
    .number()
    .int()
    .min(minimum)
    .max(86_400 * 365);

export const uuid = z.string().uuid();

export const optUuid = uuid.nullable().optional();

export const strictObject = z.strictObject;
