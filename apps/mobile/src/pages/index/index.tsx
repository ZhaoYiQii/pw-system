import { Button, Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { tenantLocator } from "@platform-locator";
import { runtimeConfig } from "@platform-runtime-config";
import {
  completeWechatLogin,
  readWechatCallback,
  withoutWechatParams,
} from "../../features/wechat-login";
import type { ResolvedTenantInfo } from "../../platform/contracts/tenant-locator";
import type { StorefrontInfo } from "../../platform/contracts/runtime-config";
import "./index.css";

const FALLBACK_PRIMARY = "#24543f";
const FALLBACK_ACCENT = "#cf6040";

export default function Index() {
  const [info, setInfo] = useState<ResolvedTenantInfo | null>(null);
  const [storefront, setStorefront] = useState<StorefrontInfo | null>(null);
  const [wechatError, setWechatError] = useState("");

  const load = async () => {
    setInfo(null);
    setStorefront(null);
    const result = await tenantLocator.resolveTenant();
    setInfo(result);
    if (result.state === "ok" && result.tenant) {
      const cfg = await runtimeConfig.loadStorefrontConfig();
      setStorefront(cfg);
    }
  };

  /**
   * S3d：微信授权回跳就落在这个页面（redirect_uri = H5 首页 ?wechat_login=1&code=..&state=..）。
   * 换会话成功后把地址栏参数清掉，避免刷新时重放已消费的 code。
   */
  const boot = async () => {
    const search = typeof location !== "undefined" ? location.search : "";
    const callback = readWechatCallback(search);
    if (callback) {
      try {
        const resolved = await tenantLocator.resolveTenant();
        if (resolved.state !== "ok" || !resolved.tenant?.code) {
          throw new Error("当前域名未绑定门店，无法完成微信登录");
        }
        const result = await completeWechatLogin(
          resolved.tenant.code,
          callback.code,
          callback.state,
        );
        if (typeof history !== "undefined" && typeof location !== "undefined") {
          history.replaceState(null, "", withoutWechatParams(location.href));
        }
        if (result.returnTo.startsWith("/pages/")) {
          await Taro.redirectTo({ url: result.returnTo });
          return;
        }
      } catch (error) {
        setWechatError(error instanceof Error ? error.message : String(error));
      }
    }
    await load();
  };

  useLoad(() => {
    void boot();
  });

  const primaryColor =
    storefront?.state === "ok" && storefront.brand
      ? storefront.brand.primaryColor
      : FALLBACK_PRIMARY;
  const accentColor =
    storefront?.state === "ok" && storefront.brand
      ? storefront.brand.accentColor
      : FALLBACK_ACCENT;
  const logoText =
    storefront?.state === "ok" && storefront.brand
      ? storefront.brand.logoText
      : (info?.tenant?.name ?? "");

  const openPlayer = () => {
    void Taro.navigateTo({ url: "/pages/player/order-hall/index" });
  };

  const openBoss = () => {
    void Taro.navigateTo({ url: "/pages/customer/home/index" });
  };

  const openRegister = () => {
    void Taro.navigateTo({ url: "/pages/register/index" });
  };

  return (
    <View className="portal">
      {info === null ? (
        <View className="portal-loading">正在打开门店…</View>
      ) : null}

      {info?.state === "ok" && info.tenant ? (
        <View className="portal-body">
          <View className="portal-brandrow">
            <Text
              className="portal-seal"
              style={{ backgroundColor: primaryColor }}
            >
              {logoText ? logoText.slice(0, 2) : "灵析"}
            </Text>
            <View className="portal-brandcopy">
              {logoText ? (
                <Text className="portal-brandname">{logoText}</Text>
              ) : null}
              <Text className="portal-brandsub">LINGXI PLAY · 门店数字化</Text>
            </View>
          </View>
          <Text className="portal-store">
            {info.tenant.name}
            ，
          </Text>
          <Text className="portal-welcome">欢迎光临，选择你的身份开始</Text>

          <Text className="portal-section-title">选择入口</Text>

          <View
            className="role-card"
            style={{ borderColor: primaryColor }}
            onClick={openPlayer}
            aria-role="button"
            aria-label="进入陪玩端：查看可接订单、报名、开始与结束服务"
          >
            <View
              className="role-ic"
              style={{ backgroundColor: `${primaryColor}1A` }}
            >
              <Text
                className="role-ic-glyph"
                style={{ color: primaryColor }}
              >
                陪
              </Text>
            </View>
            <View className="role-copy">
              <Text className="role-title">我是陪玩</Text>
              <Text className="role-desc">
                查看可接订单、报名、开始与结束服务
              </Text>
            </View>
            <Text className="role-arrow" style={{ color: primaryColor }}>
              ›
            </Text>
          </View>

          <View
            className="role-card"
            style={{ borderColor: accentColor }}
            onClick={openBoss}
            aria-role="button"
            aria-label="进入老板端：自助下单、选人确认、钱包结算与查看争议"
          >
            <View
              className="role-ic"
              style={{ backgroundColor: `${accentColor}1A` }}
            >
              <Text className="role-ic-glyph" style={{ color: accentColor }}>
                老
              </Text>
            </View>
            <View className="role-copy">
              <Text className="role-title">我是老板</Text>
              <Text className="role-desc">
                自助下单、选人确认、钱包结算与查看争议
              </Text>
            </View>
            <Text className="role-arrow" style={{ color: accentColor }}>
              ›
            </Text>
          </View>

          <View className="register-entry">
            <Text className="register-entry-note">
              还没有账号？注册后可用账号密码登录，也可以绑定手机号快捷登录。
            </Text>
            <Button className="register-entry-btn" onClick={openRegister}>
              注册新账号
            </Button>
          </View>
        </View>
      ) : null}

      {info?.state === "inactive" ? (
        <View className="portal-unavailable">
          <Text>该门店已停用，暂不可用。</Text>
          <Button className="retry-btn" onClick={() => void load()}>
            重试
          </Button>
        </View>
      ) : null}

      {info?.state === "not_found" ? (
        <View className="portal-unavailable">
          <Text>未找到对应门店，请确认访问的域名正确。</Text>
          <Button className="retry-btn" onClick={() => void load()}>
            重试
          </Button>
        </View>
      ) : null}

      {info?.state === "error" ? (
        <View className="portal-unavailable">
          <Text>门店加载失败，请检查网络后重试。</Text>
          <Button className="retry-btn" onClick={() => void load()}>
            重试
          </Button>
        </View>
      ) : null}

      {wechatError ? (
        <View className="portal-unavailable">
          <Text>微信登录失败：{wechatError}</Text>
          <Button
            className="retry-btn"
            onClick={() => {
              setWechatError("");
              void load();
            }}
          >
            返回门店首页
          </Button>
        </View>
      ) : null}

      {info?.state === "unconfigured" ? (
        <View className="portal-unavailable">
          <Text>当前域名未绑定门店，请联系商家确认访问入口。</Text>
        </View>
      ) : null}
    </View>
  );
}
