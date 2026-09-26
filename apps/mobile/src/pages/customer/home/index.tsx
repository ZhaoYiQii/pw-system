import { Button, Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { apiAdapter } from "@platform-api";
import { session } from "@platform-session";
import { tenantLocator } from "@platform-locator";
import {
  CustomerLoginCard,
  CustomerGreetCard,
  CustomerMessage,
  CustomerPhoneLoginCard,
  CustomerShell,
  goCustomer,
} from "../../../components/customer-ui";
import {
  customerLogin,
  phoneLogin,
  resolveTenantCode,
  sendPhoneCode,
} from "../../../features/customer-ui/session";
import {
  isWechatBrowser,
  startWechatAuthorize,
} from "../../../features/wechat-login";

interface CustomerMe {
  id: string;
  name: string;
  mobile: string | null;
  status: string;
}

export default function CustomerHomePage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [storeName, setStoreName] = useState("陪玩门店");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [debugCode, setDebugCode] = useState("");
  /** 登录方式：手机号（免注册直达）/ 账号密码（已注册账号）。 */
  const [mode, setMode] = useState<"phone" | "password">("phone");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<CustomerMe | null>(null);
  const [msg, setMsg] = useState<{
    tone: "error" | "success" | "info";
    text: string;
  } | null>(null);

  const loadMe = async (accessToken: string) => {
    try {
      setMe(
        await apiAdapter.request<CustomerMe>("/api/v1/tenant/customer/me", {
          token: accessToken,
        }),
      );
    } catch (error) {
      const err = error as Error & { status?: number };
      if (err.status === 404) {
        setMsg({
          tone: "error",
          text: "当前账号尚未绑定老板档案，请联系门店开通。",
        });
      } else {
        setMsg({
          tone: "error",
          text: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  useLoad(async () => {
    const accessToken = session.getToken();
    setToken(accessToken);
    if (accessToken) await loadMe(accessToken);
    const code = await resolveTenantCode();
    if (code) setTenantCode(code);
    const info = await tenantLocator.resolveTenant();
    if (info.state === "ok" && info.tenant?.name)
      setStoreName(info.tenant.name);
  });

  const loginByPhone = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const accessToken = await phoneLogin(tenantCode, phone, code);
      setToken(accessToken);
      setCode("");
      setDebugCode("");
      await loadMe(accessToken);
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const loginByPassword = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const accessToken = await customerLogin(tenantCode, username, password);
      setToken(accessToken);
      setPassword("");
      await loadMe(accessToken);
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    setSending(true);
    setMsg(null);
    try {
      const result = await sendPhoneCode(tenantCode, phone);
      setDebugCode(result.debugCode ?? "");
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <CustomerShell
        title={storeName}
        subtitle="老板端"
        active="home"
        greeting={{
          hello: me ? `晚上好，${me.name}` : "晚上好",
          sub: `${storeName} · 老板端`,
        }}
        avatarName={me?.name}
      >
      {!token ? (
        <>
          <View className="cu-login-hero">
            <Text className="cu-store-name">今晚，选个合拍的队友</Text>
            <Text className="cu-store-caption">
              {storeName} · 登录后下单、选人与管理钱包
            </Text>
          </View>
          {/* 两个窗口并列：手机号可免注册直达，账号密码给已注册账号（用户 2026-09-26 指令）。 */}
          <View className="cu-login-tabs">
            <Button
              className={`cu-login-tab${mode === "phone" ? " is-active" : ""}`}
              onClick={() => {
                setMode("phone");
                setMsg(null);
              }}
            >
              手机号登录
            </Button>
            <Button
              className={`cu-login-tab${mode === "password" ? " is-active" : ""}`}
              onClick={() => {
                setMode("password");
                setMsg(null);
              }}
            >
              账号密码登录
            </Button>
          </View>
          {mode === "phone" ? (
            <CustomerPhoneLoginCard
              tenantCode={tenantCode}
              phone={phone}
              code={code}
              debugCode={debugCode}
              busy={busy}
              sending={sending}
              onTenantCode={setTenantCode}
              onPhone={setPhone}
              onCode={setCode}
              onSend={() => void sendCode()}
              onLogin={() => void loginByPhone()}
              showWechatLogin={isWechatBrowser(
                typeof navigator !== "undefined"
                  ? navigator.userAgent
                  : undefined,
              )}
              onWechatLogin={() =>
                startWechatAuthorize(tenantCode, "/pages/customer/home/index")
              }
              onRegister={() => goCustomer("/pages/register/index")}
            />
          ) : (
            <>
              <CustomerLoginCard
                tenantCode={tenantCode}
                username={username}
                password={password}
                busy={busy}
                actionLabel="登录老板端"
                onTenantCode={setTenantCode}
                onUsername={setUsername}
                onPassword={setPassword}
                onLogin={() => void loginByPassword()}
              />
              <Button
                className="cu-button cu-button-outline cu-button-full"
                onClick={() => goCustomer("/pages/register/index")}
              >
                注册新账号
              </Button>
            </>
          )}
        </>
      ) : null}
      {msg ? (
        <CustomerMessage tone={msg.tone}>{msg.text}</CustomerMessage>
      ) : null}
      {token && me ? (
        <>
          <CustomerGreetCard name={me.name} />
          <View className="cu-quick">
            <Button
              className="cu-quick-item"
              onClick={() => goCustomer("/pages/customer/game-order/index")}
            >
              <View className="cu-quick-icon">
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
              </View>
              <Text className="cu-quick-label">去下单</Text>
            </Button>
            <Button
              className="cu-quick-item"
              onClick={() => goCustomer("/pages/customer/orders/index")}
            >
              <View className="cu-quick-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M8 6h11M8 12h11M8 18h11" />
                  <circle cx="4" cy="6" r="1" />
                  <circle cx="4" cy="12" r="1" />
                  <circle cx="4" cy="18" r="1" />
                </svg>
              </View>
              <Text className="cu-quick-label">我的订单</Text>
            </Button>
            <Button
              className="cu-quick-item"
              onClick={() => goCustomer("/pages/customer/wallet/index")}
            >
              <View className="cu-quick-icon">
                <svg viewBox="0 0 24 24">
                  <rect x="3" y="7" width="18" height="13" rx="3" />
                  <path d="M3 11h18M16 15h2" />
                </svg>
              </View>
              <Text className="cu-quick-label">钱包</Text>
            </Button>
            <Button
              className="cu-quick-item"
              onClick={() => goCustomer("/pages/customer/disputes/index")}
            >
              <View className="cu-quick-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M12 3l9 16H3z" />
                  <path d="M12 10v4M12 17.5v.5" />
                </svg>
              </View>
              <Text className="cu-quick-label">争议</Text>
            </Button>
          </View>
        </>
      ) : null}
    </CustomerShell>
  );
}
