import { Button, Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { tenantLocator } from "@platform-locator";
import { runtimeConfig } from "@platform-runtime-config";
import { runtimeInfo } from "@platform-runtime";
import type { ResolvedTenantInfo } from "../../platform/contracts/tenant-locator";
import type { StorefrontInfo } from "../../platform/contracts/runtime-config";
import "./index.css";

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

  return (
    <View className="index">
      <Text className="meta">
        runtime={runtimeInfo.kind} adapter={runtimeInfo.label}
      </Text>

      {info === null ? <Text>加载门店中…</Text> : null}

      {info?.state === "ok" && info.tenant ? (
        <View>
          <Text className="tenant-name">门店：{info.tenant.name}</Text>
          <Text className="meta">状态：{info.tenant.status}</Text>

          {storefront === null ? <Text>加载品牌配置中…</Text> : null}

          {storefront?.state === "ok" && storefront.brand ? (
            <View>
              <View
                className="brand-card"
                style={{
                  backgroundColor: storefront.brand.primaryColor,
                  borderRadius: `${storefront.brand.borderRadius}px`,
                }}
              >
                <Text className="brand-logo">{storefront.brand.logoText}</Text>
                <Text className="brand-sub">{storefront.tenant?.name}</Text>
              </View>
              <View className="swatch-row">
                <View
                  className="swatch"
                  style={{ backgroundColor: storefront.brand.primaryColor }}
                />
                <View
                  className="swatch"
                  style={{ backgroundColor: storefront.brand.accentColor }}
                />
                <Text className="meta">
                  主色 {storefront.brand.primaryColor} · 辅色{" "}
                  {storefront.brand.accentColor}
                </Text>
              </View>
              <Text className="meta">
                圆角 {storefront.brand.borderRadius}px · 配置版本 v
                {storefront.version ?? 0}
              </Text>
            </View>
          ) : null}

          {storefront?.state === "config_error" ? (
            <View className="unavailable">
              <Text>门店配置异常，当前暂不可用（CONFIG_ERROR）。</Text>
            </View>
          ) : null}

          {storefront?.state === "not_found" ? (
            <View className="unavailable">
              <Text>未找到门店前台配置。</Text>
            </View>
          ) : null}

          {storefront?.state === "error" ? (
            <View className="unavailable">
              <Text>品牌配置加载失败。</Text>
              <Button onClick={() => void load()}>重试</Button>
            </View>
          ) : null}
        </View>
      ) : null}

      {info?.state === "inactive" ? (
        <View className="unavailable">
          <Text>该门店已停用，暂不可用。</Text>
        </View>
      ) : null}

      {info?.state === "not_found" ? (
        <View className="unavailable">
          <Text>未找到对应门店。</Text>
        </View>
      ) : null}

      {info?.state === "error" ? (
        <View className="unavailable">
          <Text>门店加载失败。</Text>
          <Button onClick={() => void load()}>重试</Button>
        </View>
      ) : null}

      {info?.state === "unconfigured" ? (
        <View>
          <Text>当前平台未配置租户定位（小程序适配暂缓）。</Text>
        </View>
      ) : null}
    </View>
  );
}
