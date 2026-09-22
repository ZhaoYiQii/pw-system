import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { GameDispatchService } from "../application/game-dispatch.service.js";
import { mapGameDispatchError } from "./game-dispatch-error.mapper.js";

const MAX_BYTES = 50 * 1024 * 1024;

/**
 * 证据用途（算价模型 Task 3 / 设计规格 §9 第 4 条）：计时证据沿用 START/END，
 * 报单的开始/结束截图复用同一条证据通道，用 REPORT_START/REPORT_END 标识。
 */
const EVIDENCE_TYPES = ["START", "END", "REPORT_START", "REPORT_END"] as const;

function resolveEvidenceType(value: string | undefined): string {
  if (value === undefined || value === "") return "START";
  if (!(EVIDENCE_TYPES as readonly string[]).includes(value))
    throw new BadRequestException(`证据用途仅支持 ${EVIDENCE_TYPES.join("/")}`);
  return value;
}

function detect(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8)
    return { mime: "image/jpeg", ext: ".jpg" };
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return { mime: "image/png", ext: ".png" };
  if (
    bytes.length > 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return { mime: "image/webp", ext: ".webp" };
  if (bytes.length > 12 && bytes.toString("ascii", 4, 8) === "ftyp")
    return { mime: "video/mp4", ext: ".mp4" };
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf)
    return { mime: "video/webm", ext: ".webm" };
  return null;
}

function rootDir(): string {
  return (
    process.env.EVIDENCE_ROOT ?? path.join(process.cwd(), "data", "evidence")
  );
}

@Controller("api/v1/tenant/game-dispatch")
export class SlotSessionController {
  constructor(
    @Inject(GameDispatchService)
    private readonly dispatch: GameDispatchService,
  ) {}

  private tenantIdOf(req: AuthenticatedRequest): string {
    const id = req.principal?.tenantId;
    if (!id)
      throw new HttpException(
        "tenant context missing",
        HttpStatus.UNAUTHORIZED,
      );
    return id;
  }

  private mapError(error: unknown): never {
    mapGameDispatchError(error);
  }

  @TenantScope()
  @Permissions("dispatch.manage")
  @Get("player/orders/:orderId/service-slots")
  async serviceSlots(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    if (req.principal?.role !== "PLAYER")
      throw new HttpException("需要陪玩身份", HttpStatus.FORBIDDEN);
    try {
      return {
        data: await this.dispatch.serviceSlots(
          this.tenantIdOf(req),
          req.principal.sub,
          orderId,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("dispatch.manage")
  @Post("slots/:slotId/session/start")
  async start(
    @Req() req: AuthenticatedRequest,
    @Param("slotId") slotId: string,
  ) {
    if (req.principal?.role !== "PLAYER")
      throw new HttpException("需要陪玩身份", HttpStatus.FORBIDDEN);
    try {
      return {
        data: await this.dispatch.startSlot(
          this.tenantIdOf(req),
          req.principal.sub,
          slotId,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("dispatch.manage")
  @Post("slots/:slotId/session/end")
  async end(@Req() req: AuthenticatedRequest, @Param("slotId") slotId: string) {
    if (req.principal?.role !== "PLAYER")
      throw new HttpException("需要陪玩身份", HttpStatus.FORBIDDEN);
    try {
      return {
        data: await this.dispatch.endSlot(
          this.tenantIdOf(req),
          req.principal.sub,
          slotId,
        ),
      };
    } catch (error) {
      this.mapError(error);
    }
  }

  @TenantScope()
  @Permissions("dispatch.manage")
  @Post("slots/:slotId/session/evidence")
  async evidence(
    @Req() req: AuthenticatedRequest & Request,
    @Param("slotId") slotId: string,
    @Headers("x-file-name") fileNameHeader?: string,
    @Query("evidenceType") evidenceType?: string,
  ) {
    return this.consume(req, slotId, fileNameHeader, evidenceType);
  }

  @TenantScope()
  @Permissions("dispatch.manage")
  @Post("slots/:slotId/session/capture")
  async capture(
    @Req() req: AuthenticatedRequest & Request,
    @Param("slotId") slotId: string,
    @Headers("x-file-name") fileNameHeader?: string,
    @Query("evidenceType") evidenceType?: string,
  ) {
    return this.consume(req, slotId, fileNameHeader, evidenceType);
  }

  private async consume(
    req: AuthenticatedRequest & Request,
    slotId: string,
    fileNameHeader: string | undefined,
    evidenceType: string | undefined,
  ) {
    const tenantId = this.tenantIdOf(req);
    // 全局 body-parser（express.json / urlencoded）只接管这两类 Content-Type，
    // 并且会把请求流读到 end；此后 IncomingMessage 的 data/end 不再触发，
    // 若仍按文件流等待就会永远挂住连接（客户端拿到超时而不是错误）。
    // 该端点只接受二进制体，因此在读取文件流之前先明确拒绝。
    const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
    if (
      req.readableEnded ||
      contentType.includes("application/json") ||
      contentType.includes("application/x-www-form-urlencoded")
    ) {
      throw new HttpException(
        "该端点只接受二进制请求体（image/png、image/jpeg、image/webp、video/mp4、video/webm），不接受 application/json",
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    const resolvedEvidenceType = resolveEvidenceType(evidenceType);
    const bytes = await new Promise<Buffer>((resolvePromise, rejectPromise) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let overflow = false;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          overflow = true;
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (overflow) rejectPromise(new BadRequestException("文件超过 50MiB"));
        else resolvePromise(Buffer.concat(chunks));
      });
      req.on("error", rejectPromise);
    });
    const detected = detect(bytes);
    if (!detected)
      throw new BadRequestException(
        "仅支持真实 JPEG/PNG/WebP 图片或 MP4/WebM 视频",
      );
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const key = path.join(
      tenantId,
      "slots",
      slotId,
      `${randomUUID()}${detected.ext}`,
    );
    const dir = path.join(rootDir(), path.dirname(key));
    const full = path.join(rootDir(), key);
    await mkdir(dir, { recursive: true });
    await writeFile(full, bytes, { flag: "wx" }).catch(async (error) => {
      await unlink(full).catch(() => undefined);
      throw error;
    });
    try {
      const row = await this.dispatch.addSlotEvidence(
        tenantId,
        req.principal?.sub ?? "",
        slotId,
        {
          objectKey: key.replace(/\\/g, "/"),
          originalName: String(fileNameHeader ?? "evidence").slice(0, 120),
          mimeType: detected.mime,
          sizeBytes: bytes.length,
          sha256,
          evidenceType: resolvedEvidenceType,
        },
      );
      return {
        data: {
          id: row.id,
          objectKey: row.objectKey,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          sha256: row.sha256,
        },
      };
    } catch (error) {
      await unlink(full).catch(() => undefined);
      this.mapError(error);
    }
  }
}
