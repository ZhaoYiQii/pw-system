import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { ReactNode } from "react";
import "./styles.css";

type PlayerNavKey = "orders" | "service" | "income" | "profile";

const NAV_ITEMS: Array<{
  key: PlayerNavKey;
  label: string;
  symbol: string;
  url: string;
}> = [
  {
    key: "orders",
    label: "接单",
    symbol: "接",
    url: "/pages/player/order-hall/index?view=hall",
  },
  {
    key: "service",
    label: "服务",
    symbol: "服",
    url: "/pages/player/order-hall/index?view=service",
  },
  {
    key: "income",
    label: "收入",
    symbol: "收",
    url: "/pages/player/income/index",
  },
  {
    key: "profile",
    label: "我的",
    symbol: "我",
    url: "/pages/player/profile/index",
  },
];

export function PlayerPage({
  title,
  subtitle,
  badge,
  activeNav,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  activeNav: PlayerNavKey;
  children: ReactNode;
}) {
  return (
    <View className="pw-page">
      <View className="pw-appbar">
        <View className="pw-appbar-copy">
          <Text className="pw-title">{title}</Text>
          {subtitle ? <Text className="pw-subtitle">{subtitle}</Text> : null}
        </View>
        {badge ? <View className="pw-appbar-badge">{badge}</View> : null}
      </View>
      <View className="pw-content">{children}</View>
      <View className="pw-bottom-nav">
        {NAV_ITEMS.map((item) => (
          <Button
            key={item.key}
            className={`pw-nav-item ${activeNav === item.key ? "is-active" : ""}`}
            onClick={() => void Taro.reLaunch({ url: item.url })}
          >
            <Text className="pw-nav-symbol">{item.symbol}</Text>
            <Text>{item.label}</Text>
          </Button>
        ))}
      </View>
    </View>
  );
}

export function PlayerLoginCard({
  tenantCode,
  username,
  password,
  busy,
  actionLabel,
  onTenantCode,
  onUsername,
  onPassword,
  onLogin,
}: {
  tenantCode: string;
  username: string;
  password: string;
  busy?: boolean;
  actionLabel: string;
  onTenantCode: (value: string) => void;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  onLogin: () => void;
}) {
  return (
    <View className="pw-card pw-login-card">
      <Text className="pw-section-label">登录方式</Text>
      <View className="pw-field">
        <Text className="pw-field-label">门店 code</Text>
        <Input
          className="pw-input"
          value={tenantCode}
          onInput={(event) => onTenantCode(event.detail.value)}
          placeholder="demo"
        />
      </View>
      <View className="pw-field">
        <Text className="pw-field-label">陪玩账号</Text>
        <Input
          className="pw-input"
          value={username}
          onInput={(event) => onUsername(event.detail.value)}
          placeholder="player"
        />
      </View>
      <View className="pw-field">
        <Text className="pw-field-label">密码</Text>
        <Input
          className="pw-input"
          password
          value={password}
          onInput={(event) => onPassword(event.detail.value)}
          placeholder="请输入密码"
        />
      </View>
      <Button
        className="pw-button pw-button-dark"
        disabled={busy ?? false}
        onClick={onLogin}
      >
        {busy ? "正在登录…" : actionLabel}
      </Button>
      <Text className="pw-footnote">
        当前使用门店账号登录；微信与验证码登录将在平台能力接入后开放。
      </Text>
    </View>
  );
}

export function PlayerMessage({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "success";
}) {
  return (
    <View className={`pw-message pw-message-${tone}`}>
      <Text>{children}</Text>
    </View>
  );
}
