/**
 * 面包屑解析：把 console 相对路径还原成「这是哪个页面」。
 * 与侧栏高亮刻意不同口径（见 `resolveMerchantBreadcrumb` 注释）。
 */
import { CONSOLE_BASE } from "./console-path";
import { getMerchantModule, type MerchantModuleId } from "./nav-registry";
import { MERCHANT_NAV_CHILDREN, type MerchantNavChild } from "./nav-domains";

/**
 * 模块页面挂在与模块 id 不同的路径下时的例外表（console 相对路径 → 模块 id）。
 * 未登记的路径按「首段 = 模块 id」解析。
 * 用 Map 而不是对象字面量：路径来自 `usePathname()`，对象会把 `constructor`
 * 这类原型键当成命中项返回（`/merchant-console/constructor` 是可达路径），
 * `Map.get` 不走原型链。
 */
const MERCHANT_NESTED_MODULE_ROUTES = new Map<string, MerchantModuleId>([
  // 审核台：路径挂在派单下，但它是「订单履约」域里的独立操作台。
  ["dispatch/audit", "review"],
]);

/**
 * 命中的三级菜单项。只在真正进入了三级页面（路径深于模块根）时生效，
 * 因此模块根路径（如 `/merchant-console/dispatch`）仍显示模块自己的名字。
 */
function findActiveNavChild(
  moduleId: MerchantModuleId,
  relativePath: string,
): MerchantNavChild | undefined {
  if (!relativePath.includes("/")) return undefined;
  const href = `${CONSOLE_BASE}/${relativePath}`;
  return MERCHANT_NAV_CHILDREN[moduleId]?.find((child) => child.href === href);
}

export interface MerchantBreadcrumb {
  moduleId: MerchantModuleId | "work";
  /** 三级页面显示三级菜单名，其余显示模块名。 */
  label: string;
}

/**
 * 由 console 相对路径解析当前页归属，供顶栏面包屑使用。
 * 与侧栏高亮刻意不同口径：面包屑回答「这是哪个页面」（`/dispatch/<orderId>`
 * 仍是「订单台账」），侧栏回答「离哪个导航项最近」（同上会点亮「派单工作台」）。
 */
export function resolveMerchantBreadcrumb(
  relativePath: string,
): MerchantBreadcrumb {
  const normalized = relativePath.replace(/^\/+|\/+$/g, "");
  const [firstSegment = ""] = normalized.split("/");
  const moduleId =
    MERCHANT_NESTED_MODULE_ROUTES.get(normalized) ??
    getMerchantModule(firstSegment)?.id ??
    "work";
  const child = findActiveNavChild(moduleId, normalized);
  return {
    moduleId,
    label: child?.label ?? getMerchantModule(moduleId)?.label ?? "经营工作台",
  };
}
