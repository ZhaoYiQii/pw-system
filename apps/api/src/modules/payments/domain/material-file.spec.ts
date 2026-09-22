import { describe, expect, it } from "vitest";
import {
  MATERIAL_MAX_BYTES,
  MaterialFileError,
  assertMaterialBytes,
  buildMaterialFilename,
  detectMaterialImage,
  normalizeMaterialKind,
} from "./material-file.js";

/**
 * S4-5b-5：进件材料图片的识别与命名（零凭证）。
 * 判据：类型只看**魔术字节**（不看客户端声明的 Content-Type/文件名）；BMP 要能认出来
 * （仓库既有白名单没有它，而微信允许）；上送文件名必须由我们拼且后缀合法。
 */

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const BMP = Buffer.from([0x42, 0x4d, 0x36, 0x00, 0x00, 0x00]);

describe("S4-5b-5：进件材料图片", () => {
  it("按魔术字节识别 JPG/PNG/BMP；伪装成图片的可执行文件认不出来", () => {
    expect(detectMaterialImage(JPEG)).toEqual({
      mimeType: "image/jpeg",
      ext: "jpg",
    });
    expect(detectMaterialImage(PNG)).toEqual({
      mimeType: "image/png",
      ext: "png",
    });
    expect(detectMaterialImage(BMP)).toEqual({
      mimeType: "image/bmp",
      ext: "bmp",
    });
    // Windows PE 头（MZ）与 PDF 都不是允许的图片类型
    expect(detectMaterialImage(Buffer.from("MZ\x90\x00", "binary"))).toBeNull();
    expect(detectMaterialImage(Buffer.from("%PDF-1.7", "utf8"))).toBeNull();
    expect(detectMaterialImage(Buffer.alloc(0))).toBeNull();
  });

  it("体积校验：空文件与超 5MiB 都要拦（边界值放行）", () => {
    expect(() => assertMaterialBytes(Buffer.alloc(0))).toThrow(
      MaterialFileError,
    );
    expect(() =>
      assertMaterialBytes(Buffer.alloc(MATERIAL_MAX_BYTES + 1)),
    ).toThrow(/超过 5MiB 上限/);
    expect(() =>
      assertMaterialBytes(Buffer.alloc(MATERIAL_MAX_BYTES)),
    ).not.toThrow();
  });

  it("文件名由我们拼：后缀取自真实类型，随机部分只留十六进制", () => {
    expect(buildMaterialFilename("license", "jpg", "a1B2c3D4e5")).toBe(
      "pw-license-a1B2c3D4.jpg",
    );
    expect(buildMaterialFilename("id_front", "png", "!!")).toBe(
      "pw-id_front-0.png",
    );
  });

  it("材料种类：只认白名单，未知一律 material（不把用户输入拼进文件名）", () => {
    expect(normalizeMaterialKind("LICENSE")).toBe("license");
    expect(normalizeMaterialKind("id-front")).toBe("id_front");
    expect(normalizeMaterialKind("../../etc/passwd")).toBe("material");
    expect(normalizeMaterialKind(undefined)).toBe("material");
  });
});
