import { Button, Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { apiAdapter } from "@platform-api";
import { session } from "@platform-session";
import { tenantLocator } from "@platform-locator";
import {
  CustomerMessage,
  CustomerPhoneLoginCard,
  CustomerShell,
  goCustomer,
} from "../../../components/customer-ui";
import {
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

  const login = async () => {
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
    <CustomerShell title={storeName} subtitle="老板端" active="home">
      {!token ? (
        <>
          <View className="cu-login-hero">
            <Text className="cu-store-name">今晚，选个合拍的队友</Text>
            <Text className="cu-store-caption">
              {storeName} · 登录后下单、选人与管理钱包
            </Text>
          </View>
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
            onLogin={() => void login()}
            showWechatLogin={isWechatBrowser(
              typeof navigator !== "undefined"
                ? navigator.userAgent
                : undefined,
            )}
            onWechatLogin={() =>
              startWechatAuthorize(tenantCode, "/pages/customer/home/index")
            }
          />
        </>
      ) : null}
      {msg ? (
        <CustomerMessage tone={msg.tone}>{msg.text}</CustomerMessage>
      ) : null}
      {token && me ? (
        <>
          <View className="cu-stat">
            <Text className="cu-stat-label">欢迎回来</Text>
            <Text className="cu-stat-value">{me.name}</Text>
            <Text className="cu-stat-note">
              老板编号请在我的钱包中查看 · 服务状态以门店为准
            </Text>
          </View>
          <Button
            className="cu-button cu-button-primary cu-button-full"
            onClick={() => goCustomer("/pages/customer/orders/index")}
          >
            我的订单
          </Button>
          <Button
            className="cu-button cu-button-outline cu-button-full"
            onClick={() => goCustomer("/pages/customer/game-order/index")}
          >
            自助下单
          </Button>
          <Button
            className="cu-button cu-button-outline cu-button-full"
            onClick={() => goCustomer("/pages/customer/wallet/index")}
          >
            我的钱包
          </Button>
          <Button
            className="cu-button cu-button-outline cu-button-full"
            onClick={() => goCustomer("/pages/customer/disputes/index")}
          >
            我的争议
          </Button>
        </>
      ) : null}
    </CustomerShell>
  );
}
