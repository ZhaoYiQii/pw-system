export const CUSTOMER_NAV_ITEMS = [
  { id: "home", label: "首页", path: "/pages/customer/home/index" },
  { id: "order", label: "下单", path: "/pages/customer/game-order/index" },
  { id: "wallet", label: "钱包", path: "/pages/customer/wallet/index" },
  { id: "profile", label: "我的", path: "/pages/customer/profile/index" },
] as const;

export type CustomerNavId = (typeof CUSTOMER_NAV_ITEMS)[number]["id"];

export const CUSTOMER_UI_MODULES = [
  { id: "home", nav: "home", path: "/pages/customer/home/index" },
  { id: "orders", nav: "home", path: "/pages/customer/orders/index" },
  { id: "game-order", nav: "order", path: "/pages/customer/game-order/index" },
  {
    id: "game-select",
    nav: "order",
    path: "/pages/customer/game-select/index",
  },
  {
    id: "order-detail",
    nav: "home",
    path: "/pages/customer/order-detail/index",
  },
  { id: "wallet", nav: "wallet", path: "/pages/customer/wallet/index" },
  { id: "profile", nav: "profile", path: "/pages/customer/profile/index" },
  { id: "disputes", nav: "profile", path: "/pages/customer/disputes/index" },
  {
    id: "dispute-create",
    nav: "profile",
    path: "/pages/customer/dispute-create/index",
  },
  {
    id: "service-off",
    nav: "order",
    path: "/pages/customer/service-off/index",
  },
] as const;

export type CustomerUiModuleId = (typeof CUSTOMER_UI_MODULES)[number]["id"];

export function getCustomerNavItem(moduleId: CustomerUiModuleId) {
  const module = CUSTOMER_UI_MODULES.find((item) => item.id === moduleId);
  return CUSTOMER_NAV_ITEMS.find((item) => item.id === module?.nav);
}
