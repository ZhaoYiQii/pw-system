import { Button, Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { tenantLocator } from "@platform-locator";
import { runtimeInfo } from "@platform-runtime";
import type { ResolvedTenantInfo } from "../../platform/contracts/tenant-locator";
import "./index.css";

export default function Index() {
  const [info, setInfo] = useState<ResolvedTenantInfo | null>(null);

  const load = async () => {
    setInfo(null);
    const result = await tenantLocator.resolveTenant();
    setInfo(result);
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
          <Text>门店：{info.tenant.name}</Text>
          <Text>状态：{info.tenant.status}</Text>
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
