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
  /** 灵析重设计 Slice B：问候式页头（首页用）。提供 greeting 时替代纯标题页头。 */
  greeting,
  avatarName,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  active: CustomerNavId;
  children: ReactNode;
  greeting?: { hello: string; sub: string };
  avatarName?: string | undefined;
}) {
  return (
    <View className="cu-page">
      {greeting ? (
        <View className="cu-appbar cu-appbar-greet">
          <View className="cu-appbar-copy">
            <Text className="cu-title">{greeting.hello}</Text>
            <Text className="cu-subtitle">{greeting.sub}</Text>
          </View>
          <View className="cu-avatar">
            <Text>{(avatarName ?? "客").slice(0, 1)}</Text>
          </View>
        </View>
      ) : (
        <View className="cu-appbar">
          <View className="cu-appbar-copy">
            <Text className="cu-title">{title}</Text>
            {subtitle ? <Text className="cu-subtitle">{subtitle}</Text> : null}
          </View>
          {badge ? <View className="cu-chip">{badge}</View> : null}
        </View>
      )}
      <View className="cu-content">{children}</View>
      <CustomerBottomNav active={active} />
    </View>
  );
}

/**
 * 底部导航图标（灵析重设计 Slice A）：线性风格，stroke 跟随文字色。
 * Taro H5 会把 SVG 渲染成内联节点；weapp 端 unsupported-svg 由平台层兜底（当前 weapp 未开工）。
 */
const NAV_ICONS: Record<CustomerNavId, string> = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>',
  order: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  wallet: '<rect x="3" y="7" width="18" height="13" rx="3"/><path d="M3 11h18M16 15h2"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
};

/**
 * 问候卡（灵析重设计 Slice B）：首页登录后的松绿渐变 hero。
 * 文案沿用产品既有标语；不展示后端不存在的统计数据。
 */
export function CustomerGreetCard({ name }: { name: string }) {
  return (
    <View className="cu-greet-card">
      <Text className="cu-greet-title">今晚，选个合拍的队友</Text>
      <Text className="cu-greet-note">
        {name}，欢迎回来 · 资金平台托管 · 服务完成后再结算
      </Text>
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
          <View
            className="cu-nav-icon"
            dangerouslySetInnerHTML={{
              __html: `<svg viewBox="0 0 24 24">${NAV_ICONS[item.id] ?? ""}</svg>`,
            }}
          />
          <Text>{item.label}</Text>
        </Button>
      ))}
    </View>
  );
}

export type StatusTone = "ok" | "wait" | "bad" | "muted";

/** 状态 → 语义色映射（灵析重设计 Slice B）：服务中=陶土（进行态）、待确认=琥珀（需行动）、完成=松绿、终止=灰。 */
export function statusTone(status: string): StatusTone {
  if (status === "IN_PROGRESS" || status === "READY") return "wait";
  if (status === "PENDING_CONFIRMATION") return "bad";
  if (status === "COMPLETED") return "ok";
  if (status === "CANCELLED" || status === "DRAFT") return "muted";
  return "muted";
}

export function StatusPill({
  children,
  wait = false,
  tone,
}: {
  children: ReactNode;
  /** 兼容旧调用：wait=true 等价于 tone="wait"。 */
  wait?: boolean;
  tone?: StatusTone;
}) {
  const resolved = tone ?? (wait ? "wait" : "ok");
  return (
    <Text className={`cu-state is-tone-${resolved}`}>{children}</Text>
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
        已绑定手机号的账号也可用手机验证码登录；忘记密码可先用手机号登录后重设。
      </Text>
    </View>
  );
}

export function CustomerPhoneLoginCard({
  tenantCode,
  phone,
  code,
  debugCode,
  busy = false,
  sending = false,
  onTenantCode,
  onPhone,
  onCode,
  onSend,
  onLogin,
  showWechatLogin = false,
  onWechatLogin,
  onRegister,
}: {
  tenantCode: string;
  phone: string;
  code: string;
  debugCode?: string;
  busy?: boolean;
  sending?: boolean;
  onTenantCode: (value: string) => void;
  onPhone: (value: string) => void;
  onCode: (value: string) => void;
  onSend: () => void;
  onLogin: () => void;
  /** S3d：只用于按钮显隐（微信内置浏览器嗅探），不参与任何安全判断。 */
  showWechatLogin?: boolean;
  onWechatLogin?: () => void;
  /** SP2：未登录者可从这里去自助注册；不传则不渲染。 */
  onRegister?: () => void;
}) {
  return (
    <View className="cu-card cu-login-card">
      <Text className="cu-section-label">手机号登录 / 注册</Text>
      <View className="cu-field">
        <Text className="cu-label">门店 code</Text>
        <Input
          className="cu-input"
          value={tenantCode}
          onInput={(event) => onTenantCode(event.detail.value)}
          placeholder="demo"
        />
      </View>
      <View className="cu-field">
        <Text className="cu-label">手机号</Text>
        <Input
          className="cu-input"
          type="number"
          value={phone}
          onInput={(event) => onPhone(event.detail.value)}
          placeholder="请输入手机号"
        />
      </View>
      <View className="cu-field">
        <Text className="cu-label">验证码</Text>
        <Input
          className="cu-input"
          type="number"
          value={code}
          onInput={(event) => onCode(event.detail.value)}
          placeholder="6 位验证码"
        />
        <Button
          className="cu-button cu-button-outline cu-button-small"
          disabled={sending || !/^1\d{10}$/.test(phone)}
          onClick={onSend}
        >
          {sending ? "发送中…" : "获取验证码"}
        </Button>
      </View>
      {debugCode ? (
        <Text className="cu-footnote">
          本地调试验证码：{debugCode}（正式环境不会显示）
        </Text>
      ) : null}
      <Button
        className="cu-button cu-button-primary cu-button-full"
        disabled={busy}
        onClick={onLogin}
      >
        {busy ? "正在登录…" : "登录老板端"}
      </Button>
      {showWechatLogin && onWechatLogin ? (
        <Button
          className="cu-button cu-button-outline cu-button-full"
          onClick={onWechatLogin}
        >
          微信一键登录
        </Button>
      ) : null}
      <Text className="cu-footnote">
        首次登录会自动创建本店老板账号与客户档案。
      </Text>
      {onRegister ? (
        <Button
          className="cu-button cu-button-outline cu-button-full"
          onClick={onRegister}
        >
          注册新账号
        </Button>
      ) : null}
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
