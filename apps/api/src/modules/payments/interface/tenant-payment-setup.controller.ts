import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { Permissions, TenantScope } from "../../../common/auth/decorators.js";
import type { AuthenticatedRequest } from "../../../common/auth/auth.guard.js";
import { WechatPayError } from "../infrastructure/wechatpay-partner.client.js";
import {
  IntakeValidationError,
  type IndividualIntakeInput,
} from "../domain/applyment-payload.js";
import {
  MATERIAL_MAX_BYTES,
  MaterialFileError,
  normalizeMaterialKind,
} from "../domain/material-file.js";
import { TenantPaymentSetupService } from "../application/payment-setup.service.js";
import {
  PaymentSetupInputError,
  WechatPayDisabledError,
} from "../domain/payments.errors.js";

/**
 * S4-5：门店支付设置端点。
 *
 * 权限口径：
 * - **查状态**：`finance.manage`（老板 / 财务都能看，财务对账要知道钱收不收得到）；
 * - **绑定子商户号 / 刷新状态**：`tenant.manage`（只有老板能做——进件与开户是法人与账户级动作，
 *   店长/客服不该有此权限；PERMISSION_KEYS 里没有更细的支付设置权限，故按现有矩阵取最严的一档）。
 */
@Controller("api/v1/tenant/payments/account")
export class TenantPaymentSetupController {
  constructor(
    @Inject(TenantPaymentSetupService)
    private readonly setup: TenantPaymentSetupService,
  ) {}

  @TenantScope()
  @Permissions("finance.manage")
  @Get()
  async get(@Req() req: AuthenticatedRequest) {
    return { data: await this.setup.getStatus(tenantIdOf(req)) };
  }

  @TenantScope()
  @Permissions("tenant.manage")
  @Post("bind")
  async bind(
    @Req() req: AuthenticatedRequest,
    @Body() body: { subMchid?: unknown },
  ) {
    const operatorAccountId = operatorOf(req);
    try {
      return {
        data: await this.setup.bindSubMchid({
          tenantId: tenantIdOf(req),
          subMchid:
            typeof body.subMchid === "string" ? body.subMchid : String(""),
          operatorAccountId,
        }),
      };
    } catch (error) {
      this.rethrow(error);
    }
  }

  @TenantScope()
  @Permissions("tenant.manage")
  @Post("refresh")
  async refresh(@Req() req: AuthenticatedRequest) {
    const operatorAccountId = operatorOf(req);
    try {
      return {
        data: await this.setup.refresh({
          tenantId: tenantIdOf(req),
          operatorAccountId,
        }),
      };
    } catch (error) {
      this.rethrow(error);
    }
  }

  @TenantScope()
  @Permissions("tenant.manage")
  @Post("applyment")
  async submitIntake(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    const operatorAccountId = operatorOf(req);
    try {
      return {
        data: await this.setup.submitIntake({
          tenantId: tenantIdOf(req),
          operatorAccountId,
          intake: readIntake(body),
        }),
      };
    } catch (error) {
      this.rethrow(error);
    }
  }

  /**
   * 上传进件材料图片（原始字节流 + `x-material-kind` 头，与仓库 evidence 上传同一口径）。
   * 只返回 `mediaId` 给前端，提交进件时再带上——**平台不保存这些证件图片**。
   */
  @TenantScope()
  @Permissions("tenant.manage")
  @Post("materials")
  @HttpCode(HttpStatus.CREATED)
  async uploadMaterial(
    @Req() req: AuthenticatedRequest & Request,
    @Headers("x-material-kind") kindHeader?: string,
  ) {
    const bytes = await readRawBody(req);
    try {
      return {
        data: await this.setup.uploadMaterial({
          kind: normalizeMaterialKind(kindHeader),
          bytes,
        }),
      };
    } catch (error) {
      this.rethrow(error);
    }
  }

  /** 错误映射集中一处：400 入参（含字段校验）/ 502 微信侧失败 / 503 未启用或缺公钥。 */
  private rethrow(error: unknown): never {
    if (
      error instanceof PaymentSetupInputError ||
      error instanceof IntakeValidationError ||
      error instanceof MaterialFileError
    ) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
    if (error instanceof WechatPayDisabledError) {
      throw new HttpException(error.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (
      error instanceof WechatPayError &&
      error.code === "MISSING_PUBLIC_KEY"
    ) {
      // 配置缺失属于"服务没准备好"，不是微信侧故障
      throw new HttpException(error.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (error instanceof WechatPayError) {
      // 微信返回的 code/message 原样透出，便于老板把错误码发给对接人
      throw new HttpException(
        `微信支付查询失败（${error.code || error.httpStatus}）：${error.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
    throw error;
  }
}

function tenantIdOf(req: AuthenticatedRequest): string {
  const id = req.principal?.tenantId;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

function operatorOf(req: AuthenticatedRequest): string {
  const id = req.principal?.sub;
  if (!id)
    throw new HttpException("tenant context missing", HttpStatus.UNAUTHORIZED);
  return id;
}

/**
 * 读取原始请求体（不依赖 multipart 解析器，与 evidence 上传同口径）。
 * 超过官方 5MiB 上限立刻断流并报 400，避免把内存吃满。
 */
async function readRawBody(req: Request): Promise<Buffer> {
  return new Promise<Buffer>((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MATERIAL_MAX_BYTES) {
        overflow = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (overflow) {
        rejectPromise(
          new MaterialFileError(`图片超过 5MiB 上限（已读取 ${size} 字节）`),
        );
      } else {
        resolvePromise(Buffer.concat(chunks));
      }
    });
    req.on("error", rejectPromise);
  });
}

/** 请求体 → 进件资料（非字符串一律当空串，具体必填校验交给领域层点名到字段）。 */
function readIntake(body: Record<string, unknown>): IndividualIntakeInput {
  const text = (value: unknown): string =>
    typeof value === "string" ? value : "";
  return {
    tenantCode: text(body.tenantCode),
    spMchid: text(body.spMchid),
    contactName: text(body.contactName),
    mobilePhone: text(body.mobilePhone),
    contactEmail: text(body.contactEmail),
    licenseNumber: text(body.licenseNumber),
    merchantName: text(body.merchantName),
    legalPerson: text(body.legalPerson),
    licenseCopyMediaId: text(body.licenseCopyMediaId),
    idCardName: text(body.idCardName),
    idCardNumber: text(body.idCardNumber),
    cardPeriodBegin: text(body.cardPeriodBegin),
    cardPeriodEnd: text(body.cardPeriodEnd),
    idCardCopyMediaId: text(body.idCardCopyMediaId),
    idCardNationalMediaId: text(body.idCardNationalMediaId),
    accountName: text(body.accountName),
    accountBank: text(body.accountBank),
    accountNumber: text(body.accountNumber),
    ...(typeof body.bankAddressCode === "string"
      ? { bankAddressCode: body.bankAddressCode }
      : {}),
  };
}
