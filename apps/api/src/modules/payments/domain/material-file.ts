/**
 * S4-5b-5：进件材料图片的**识别与命名**（纯函数，便于零凭证单测）。
 *
 * 为什么不用请求头里的 Content-Type / 文件名：那是客户端随便写的。按仓库既有上传口径
 * （`evidence.controller.ts`）统一用**魔术字节**判断真实类型，再自己拼文件名——
 * 微信要求 `meta.filename` 必须以 JPG/BMP/PNG 结尾（官方 partner/4012760490），
 * 由我们决定后缀，就不会被一个 `.exe` 头骗过去。
 */

export const MATERIAL_MAX_BYTES = 5 * 1024 * 1024;

export interface MaterialImageType {
  mimeType: string;
  /** 官方允许的后缀：JPG / PNG / BMP */
  ext: "jpg" | "png" | "bmp";
}

export class MaterialFileError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "MaterialFileError";
  }
}

/** 按魔术字节识别真实图片类型；认不出就返回 null（调用方据此拒绝）。 */
export function detectMaterialImage(bytes: Buffer): MaterialImageType | null {
  if (
    bytes.length > 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { mimeType: "image/jpeg", ext: "jpg" };
  }
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mimeType: "image/png", ext: "png" };
  }
  // BMP：文件头 "BM"（微信允许，仓库既有 evidence 白名单里没有，这里单独补上）
  if (bytes.length > 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { mimeType: "image/bmp", ext: "bmp" };
  }
  return null;
}

/** 材料种类（前端用 x-material-kind 头声明），只用于生成可读文件名。 */
const KINDS = ["license", "id_front", "id_back", "material"] as const;
export type MaterialKind = (typeof KINDS)[number];

export function normalizeMaterialKind(value: string | undefined): MaterialKind {
  const kind = (value ?? "").trim().toLowerCase().replace(/-/g, "_");
  return (KINDS as readonly string[]).includes(kind)
    ? (kind as MaterialKind)
    : "material";
}

/**
 * 生成上送文件名：`pw-<kind>-<短随机>.<ext>`。
 * 只用我们自己控制的字符集 + 官方允许后缀，避免用户文件名里带路径/引号污染 multipart 头。
 */
export function buildMaterialFilename(
  kind: MaterialKind,
  ext: MaterialImageType["ext"],
  randomHex: string,
): string {
  const safe = randomHex.replace(/[^0-9a-f]/gi, "").slice(0, 8) || "0";
  return `pw-${kind}-${safe}.${ext}`;
}

/** 体积/空文件校验（官方：图片不超过 5M）。 */
export function assertMaterialBytes(bytes: Buffer): void {
  if (bytes.length === 0) throw new MaterialFileError("上传内容为空");
  if (bytes.length > MATERIAL_MAX_BYTES) {
    throw new MaterialFileError(
      `图片超过 5MiB 上限（当前 ${bytes.length} 字节）`,
    );
  }
}
