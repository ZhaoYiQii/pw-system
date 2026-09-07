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
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { GameDispatchService } from "../application/game-dispatch.service.js";
import {
  DispatchConflictError,
  DispatchNotFoundError,
  DispatchStateError,
} from "../domain/dispatch-errors.js";

const MAX_BYTES = 50 * 1024 * 1024;
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
    if (error instanceof DispatchNotFoundError)
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    if (
      error instanceof DispatchStateError ||
      error instanceof DispatchConflictError
    )
      throw new HttpException(error.message, HttpStatus.CONFLICT);
    throw error;
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
  ) {
    return this.consume(req, slotId, fileNameHeader);
  }

  @TenantScope()
  @Permissions("dispatch.manage")
  @Post("slots/:slotId/session/capture")
  async capture(
    @Req() req: AuthenticatedRequest & Request,
    @Param("slotId") slotId: string,
    @Headers("x-file-name") fileNameHeader?: string,
  ) {
    return this.consume(req, slotId, fileNameHeader);
  }

  private async consume(
    req: AuthenticatedRequest & Request,
    slotId: string,
    fileNameHeader: string | undefined,
  ) {
    const tenantId = this.tenantIdOf(req);
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
          evidenceType: "START",
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
