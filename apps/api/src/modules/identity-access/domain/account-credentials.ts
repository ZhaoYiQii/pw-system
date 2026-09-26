/**
 * SP2：账号密码自助注册登录的输入规则（spec §5.1 / §5.2）。
 *
 * 放在 domain 层且不依赖任何基础设施：自助注册端点、改密端点与既有的后台建号
 * （application/tenant-accounts.service.ts）共用同一套规则，避免两处文案/边界漂移。
 */

export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{2,64}$/;
export const USERNAME_RULE_MESSAGE = "用户名需为 2-64 位字母/数字/_/-";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_RULE_MESSAGE = "密码长度需为 8-128 字符";

export const DISPLAY_NAME_MAX_LENGTH = 50;
export const DISPLAY_NAME_RULE_MESSAGE = "昵称需为 1-50 字符";
