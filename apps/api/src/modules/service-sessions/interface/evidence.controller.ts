import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { BadRequestException, Controller, ForbiddenException, Get, Headers, HttpException, HttpStatus, Inject, NotFoundException, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { PrismaSessionsRepository } from "../infrastructure/prisma-sessions.repository.js";
import { PlayersService } from "../../players/application/players.service.js";
import { AuditService } from "../../audit/audit.service.js";
import { TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MIME_BY_MAGIC: Array<{ mime: string; ext: string; magic: (b: Buffer) => boolean }> = [
  { mime: "image/jpeg", ext: ".jpg", magic: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: ".png", magic: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
  {
    mime: "image/webp",
    ext: ".webp",
    magic: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP"
  }
];

function rootDir(): string {
  return process.env.EVIDENCE_ROOT ?? path.join(process.cwd(), "data", "evidence");
}

function sanitizeName(name: string): string {
  const base = path.basename(String(name ?? "evidence")).replace(/[^\w.\-\u4e00-\u9fa5]/g, "_").slice(0, 120);
  return base || "evidence";
}

@Controller("api/v1/tenant")
export class EvidenceController {
  constructor(
    @Inject(PrismaSessionsRepository) private readonly repo: PrismaSessionsRepository,
    @Inject(PlayersService) private readonly players: PlayersService,
    @Inject(AuditService) private readonly audit: AuditService
  ) {}

  private tenantIdOf(req: AuthenticatedRequest): string {
    const id = req.principal?.tenantId;
    if (!id) throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
    return id;
  }

  private async requireSessionActor(req: AuthenticatedRequest, sessionId: string): Promise<void> {
    const tenantId = this.tenantIdOf(req);
    const s = await this.repo.sessionOf(tenantId, sessionId);
    if (!s) throw new NotFoundException("场次不存在");
    const role = req.principal?.role;
    if (role === "TENANT_OWNER" || role === "CUSTOMER_SERVICE") return;
    if (role !== "PLAYER") throw new ForbiddenException("无权操作该场次证据");
    const me = await this.players.getByAccount(tenantId, req.principal?.sub ?? "").catch(() => null);
    if (!me || me.id !== s.playerId) throw new ForbiddenException("只能操作自己被指派的场次");
  }

  @TenantScope()
  @Post("sessions/:sessionId/evidence")
  async upload(
    @Req() req: AuthenticatedRequest & Request,
    @Res({ passthrough: true }) res: Response,
    @Param("sessionId") sessionId: string,
    @Headers("x-file-name") fileNameHeader?: string
  ) {
    const tenantId = this.tenantIdOf(req);
    await this.requireSessionActor(req, sessionId);
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
        if (overflow) rejectPromise(new BadRequestException("文件超过 10MiB"));
        else resolvePromise(Buffer.concat(chunks));
      });
      req.on("error", rejectPromise);
    });
    const originalName = sanitizeName(fileNameHeader ?? "evidence.png");
    const detected = MIME_BY_MAGIC.find((m) => m.magic(bytes));
    if (!detected) throw new BadRequestException("仅支持真实 JPEG/PNG/WebP 图片");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const key = path.join(tenantId, String(new Date().getUTCFullYear()), String(new Date().getUTCMonth() + 1).padStart(2, "0"), `${randomUUID()}${detected.ext}`);
    const dir = path.join(rootDir(), path.dirname(key));
    const full = path.join(rootDir(), key);
    await mkdir(dir, { recursive: true });
    await writeFile(full, bytes, { flag: "wx" }).catch(async (error) => {
      await unlink(full).catch(() => undefined);
      throw error;
    });
    try {
      const created = await this.repo.createEvidence(tenantId, sessionId, {
        objectKey: key.replace(/\\/g, "/"),
        originalName,
        mimeType: detected.mime,
        sizeBytes: bytes.length,
        sha256,
        uploadedBy: req.principal?.sub ?? null
      });
      await this.audit.record({
        tenantId,
        actorType: req.principal?.role,
        actorId: req.principal?.sub ?? null,
        action: "evidence.upload",
        resourceType: "evidence_asset",
        resourceId: created.id,
        summary: `上传证据 ${created.id}`
      });
      res.status(HttpStatus.CREATED);
      return { data: { id: created.id, objectKey: key.replace(/\\/g, "/"), mimeType: detected.mime, sizeBytes: bytes.length, sha256 } };
    } catch (error) {
      await unlink(full).catch(() => undefined);
      throw error;
    }
  }

  @TenantScope()
  @Get("evidence/:id")
  async download(@Req() req: AuthenticatedRequest, @Res() res: Response, @Param("id") id: string) {
    const tenantId = this.tenantIdOf(req);
    const ev = await this.repo.findEvidence(tenantId, id);
    if (!ev) throw new NotFoundException("证据不存在");
    const s = await this.repo.sessionOf(tenantId, ev.sessionId);
    const role = req.principal?.role;
    if (role !== "TENANT_OWNER" && role !== "CUSTOMER_SERVICE") {
      if (role !== "PLAYER" || !s) throw new ForbiddenException("无权限下载");
      const me = await this.players.getByAccount(tenantId, req.principal?.sub ?? "").catch(() => null);
      if (!me || !s || me.id !== s.playerId) throw new ForbiddenException("无权限下载");
    }
    const full = path.join(rootDir(), ev.objectKey);
    try {
      const data = await readFile(full);
      res.setHeader("content-type", ev.mimeType);
      res.setHeader("content-length", String(data.length));
      res.setHeader("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(ev.originalName)}`);
      res.end(data);
    } catch {
      throw new NotFoundException("文件缺失");
    }
  }
}
