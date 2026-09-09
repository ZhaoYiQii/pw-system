import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { ReactNode } from "react";
import { CUSTOMER_NAV_ITEMS, type CustomerNavId } from "./modules";
import "./styles.css";

export function CustomerShell({
  title,
  subtitle,
  badge,
  active,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  active: CustomerNavId;
  children: ReactNode;
}) {
  return (
    <View className="cu-page">
      <View className="cu-appbar">
        <View className="cu-appbar-copy">
          <Text className="cu-title">{title}</Text>
          {subtitle ? <Text className="cu-subtitle">{subtitle}</Text> : null}
        </View>
        {badge ? <View className="cu-chip">{badge}</View> : null}
      </View>
      <View className="cu-content">{children}</View>
      <CustomerBottomNav active={active} />
    </View>
  );
}

export function CustomerBottomNav({ active }: { active: CustomerNavId }) {
  return (
    <View className="cu-bottom-nav">
      {CUSTOMER_NAV_ITEMS.map((item) => (
        <Button
          key={item.id}
          className={`cu-nav-item${active === item.id ? " is-active" : ""}`}
          aria-label={item.label}
          onClick={() => void Taro.redirectTo({ url: item.path })}
        >
          <Text>{item.label}</Text>
        </Button>
      ))}
    </View>
  );
}

export function StatusPill({
  children,
  wait = false,
}: {
  children: ReactNode;
  wait?: boolean;
}) {
  return (
    <Text className={`cu-state${wait ? " is-wait" : ""}`}>{children}</Text>
  );
}

export function CustomerLoginCard({
  tenantCode,
  username,
  password,
  busy = false,
  actionLabel = "登录",
  onTenantCode,
  onUsername,
  onPassword,
  onLogin,
}: {
  tenantCode: string;
  username: string;
  password: string;
  busy?: boolean;
  actionLabel?: string;
  onTenantCode: (value: string) => void;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  onLogin: () => void;
}) {
  return (
    <View className="cu-card cu-login-card">
      <Text className="cu-section-label">账号密码登录</Text>
      <View className="cu-field">
        <Text className="cu-label">门店 code</Text>
        <Input
          className="cu-input"
          name="tenantCode"
          aria-label="门店 code"
          value={tenantCode}
          onInput={(event) => onTenantCode(event.detail.value)}
          placeholder="demo"
        />
      </View>
      <View className="cu-field">
        <Text className="cu-label">老板账号</Text>
        <Input
          className="cu-input"
          name="username"
          aria-label="老板账号"
          value={username}
          onInput={(event) => onUsername(event.detail.value)}
          placeholder="customer"
        />
      </View>
      <View className="cu-field">
        <Text className="cu-label">密码</Text>
        <Input
          className="cu-input"
          password
          name="password"
          aria-label="密码"
          value={password}
          onInput={(event) => onPassword(event.detail.value)}
          placeholder="••••"
        />
      </View>
      <Button
        className="cu-button cu-button-primary cu-button-full"
        disabled={busy}
        onClick={onLogin}
      >
        {busy ? "正在登录…" : actionLabel}
      </Button>
      <Text className="cu-footnote">
        当前使用门店账号登录；微信与验证码登录将在平台能力接入后开放。
      </Text>
    </View>
  );
}

export function CustomerMessage({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "success" | "info";
}) {
  return (
    <View className={`cu-message cu-message-${tone}`} aria-live="polite">
      <Text>{children}</Text>
    </View>
  );
}

export function goCustomer(path: string) {
  void Taro.navigateTo({ url: path });
}
