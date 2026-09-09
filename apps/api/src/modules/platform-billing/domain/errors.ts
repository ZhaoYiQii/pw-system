export class TenantCodeTakenError extends Error {
  readonly problemCode = "TENANT_CODE_TAKEN";

  constructor(code: string) {
    super(`门店 code 已存在：${code}`);
    this.name = "TenantCodeTakenError";
  }
}

export class HostTakenError extends Error {
  readonly problemCode = "HOST_TAKEN";

  constructor(host: string) {
    super(`门店域名已被使用：${host}`);
    this.name = "HostTakenError";
  }
}
