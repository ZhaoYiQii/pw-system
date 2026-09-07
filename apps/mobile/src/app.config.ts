export default defineAppConfig({
  pages: [
    "pages/index/index",
    "pages/player/profile/index",
    "pages/player/availability/index",
    "pages/player/order-hall/index",
    "pages/player/game-signup/index",
    "pages/customer/candidates/index",
    "pages/customer/game-order/index",
    "pages/customer/game-select/index",
    "pages/customer/wallet/index",
  ],
  window: {
    backgroundTextStyle: "light",
    navigationBarBackgroundColor: "#fff",
    navigationBarTitleText: "PW",
    navigationBarTextStyle: "black",
  },
});
