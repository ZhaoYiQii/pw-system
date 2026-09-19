// 客户自助下单（v2）的「一次提交意图」。
//
// 幂等键按请求体签名复用：同一次意图重试/重放用同一个键，请求体一旦变化或提交成功后换新键。
// 与商家端 new-order-template-flow 的 intentFor 同口径（同一实现，两个入口用不同 operation 记录）。
//
// 纯模块：不依赖 React、网络与平台 API，便于直接单测。

export interface OrderIntent {
  key: string;
  signature: string;
}

// 与契约同口径：Idempotency-Key 长度 8-100。
const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 100;
const KEY_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

// 请求体签名：字段顺序变化不算变化，内容变化必须换键。
export function orderSignature(body: unknown): string {
  return stableStringify(body);
}

/**
 * 一次提交意图：请求体不变就复用已有键，变了就换新键。
 * 提交成功后调用方应传入 null，让下一次提交换一把新键。
 */
export function orderIntentFor(
  previous: OrderIntent | null,
  body: unknown,
  createKey: () => string,
): OrderIntent {
  const signature = orderSignature(body);
  if (previous !== null && previous.signature === signature) return previous;
  return { key: createKey(), signature };
}

type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: (bytes: Uint8Array) => Uint8Array;
};

// 随机源优先用平台 crypto；weapp 等没有 crypto 时退回 Math.random
// （键只要求不重复，不承担安全用途）。
export function newIdempotencyKey(): string {
  const cryptoRef = (globalThis as { crypto?: CryptoLike }).crypto;
  const uuid = cryptoRef?.randomUUID?.();
  if (
    typeof uuid === "string" &&
    uuid.length >= MIN_KEY_LENGTH &&
    uuid.length <= MAX_KEY_LENGTH
  ) {
    return uuid;
  }
  const bytes = new Uint8Array(16);
  if (cryptoRef?.getRandomValues) {
    cryptoRef.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * KEY_ALPHABET.length);
    }
  }
  let suffix = "";
  for (const byte of bytes) suffix += KEY_ALPHABET[byte % KEY_ALPHABET.length];
  return `ord_${suffix}`;
}
