import { ModuleView } from "@/app/_lib/merchant-console/module-view";

/**
 * 审核台（订单中心列表 Slice 2）：报单审批从场次详情收敛到独立队列。
 * 单独给一条路径而不是复用 `[module]`：审核台是「订单履约」域下的常用操作台，
 * 放在 `/merchant-console/dispatch/audit` 与派单/模板同组，路由语义更直白。
 */
export default function MerchantReviewPage() {
  return <ModuleView moduleId="review" />;
}
