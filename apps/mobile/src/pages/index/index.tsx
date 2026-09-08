import { Button, Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { tenantLocator } from "@platform-locator";
import { runtimeConfig } from "@platform-runtime-config";
import type { ResolvedTenantInfo } from "../../platform/contracts/tenant-locator";
import type { StorefrontInfo } from "../../platform/contracts/runtime-config";
import "./index.css";

const FALLBACK_PRIMARY = "#2f54eb";
const FALLBACK_ACCENT = "#fa8c16";

export default function Index() {
  const [info, setInfo] = useState<ResolvedTenantInfo | null>(null);
  const [storefront, setStorefront] = useState<StorefrontInfo | null>(null);

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

  useLoad(() => {
    void load();
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
    void Taro.navigateTo({ url: "/pages/customer/game-order/index" });
  };

  return (
    <View className="portal">
      {info === null ? (
        <View className="portal-loading">正在打开门店…</View>
      ) : null}

      {info?.state === "ok" && info.tenant ? (
        <View className="portal-body">
          <View
            className="portal-hero"
            style={{ backgroundColor: primaryColor }}
          >
            <Text className="portal-store">{info.tenant.name}</Text>
            {logoText ? (
              <Text className="portal-logo">
                {logoText}
                <Text
                  className="portal-logo-dot"
                  style={{ backgroundColor: accentColor }}
                />
              </Text>
            ) : null}
            <Text className="portal-welcome">欢迎光临，选择你的身份开始</Text>
          </View>

          <Text className="portal-section-title">选择入口</Text>

          <View className="role-card">
            <View className="role-head">
              <Text className="role-badge" style={{ color: primaryColor }}>
                陪玩
              </Text>
              <View className="role-copy">
                <Text className="role-title">我是陪玩</Text>
                <Text className="role-desc">
                  查看可接订单、报名、开始与结束服务
                </Text>
              </View>
            </View>
            <Button className="role-btn" onClick={openPlayer}>
              进入陪玩端
            </Button>
          </View>

          <View className="role-card">
            <View className="role-head">
              <Text className="role-badge" style={{ color: accentColor }}>
                老板
              </Text>
              <View className="role-copy">
                <Text className="role-title">我是老板</Text>
                <Text className="role-desc">
                  自助下单、选人确认、钱包结算与查看争议
                </Text>
              </View>
            </View>
            <Button className="role-btn" onClick={openBoss}>
              进入老板端
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

      {info?.state === "unconfigured" ? (
        <View className="portal-unavailable">
          <Text>当前域名未绑定门店，请联系商家确认访问入口。</Text>
        </View>
      ) : null}
    </View>
  );
}
