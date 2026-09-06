import { BadRequestException } from "@nestjs/common";

/** 输入校验失败异常：fieldErrors 供 RFC9457 响应使用。 */
export class ApiValidationError extends BadRequestException {
  constructor(
    readonly fieldErrors: Record<string, string[]>,
    message = "Validation failed",
  ) {
    super(message);
    this.name = "ApiValidationError";
  }
}
