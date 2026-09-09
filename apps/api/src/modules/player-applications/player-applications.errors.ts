export class PlayerApplicationNotFoundError extends Error {
  constructor(message = "申请不存在") {
    super(message);
    this.name = "PlayerApplicationNotFoundError";
  }
}
export class PlayerApplicationNotPendingError extends Error {
  constructor(message = "申请已处理") {
    super(message);
    this.name = "PlayerApplicationNotPendingError";
  }
}
export class PlayerApplicationNotCustomerError extends Error {
  constructor(message = "仅老板端账号可申请") {
    super(message);
    this.name = "PlayerApplicationNotCustomerError";
  }
}
export class PlayerApplicationDuplicatePendingError extends Error {
  constructor(message = "已有待审核申请") {
    super(message);
    this.name = "PlayerApplicationDuplicatePendingError";
  }
}
export class PlayerApplicationAlreadyPlayerError extends Error {
  constructor(message = "该账号已具备陪玩身份") {
    super(message);
    this.name = "PlayerApplicationAlreadyPlayerError";
  }
}
export class PlayerApplicationReviewReasonRequiredError extends Error {
  constructor(message = "请填写内容") {
    super(message);
    this.name = "PlayerApplicationReviewReasonRequiredError";
  }
}
