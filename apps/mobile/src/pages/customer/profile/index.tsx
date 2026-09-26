import { Button, Text, Textarea, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { apiAdapter } from "@platform-api";
import { session } from "@platform-session";
import {
  CustomerLoginCard,
  CustomerMessage,
  CustomerShell,
  goCustomer,
} from "../../../components/customer-ui";
import { applyAsPlayer } from "../../../features/account-ui/actions";
import {
  customerLogin,
  customerLogout,
  resolveTenantCode,
} from "../../../features/customer-ui/session";

interface CustomerMe {
  id: string;
  name: string;
  mobile: string | null;
  status: string;
}

interface WalletBrief {
  bossNo: string;
}

export default function CustomerProfilePage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<CustomerMe | null>(null);
  const [bossNo, setBossNo] = useState("");
  const [msg, setMsg] = useState<{
    tone: "error" | "success" | "info";
    text: string;
  } | null>(null);
  const [showApply, setShowApply] = useState(false);
  const [applyIntro, setApplyIntro] = useState("");

  const load = async (accessToken: string) => {
    setMsg(null);
    try {
      const [profile, wallet] = await Promise.all([
        apiAdapter.request<CustomerMe>("/api/v1/tenant/customer/me", {
          token: accessToken,
        }),
        apiAdapter
          .request<WalletBrief>("/api/v1/boss/wallet", {
            token: accessToken,
          })
          .catch(() => null),
      ]);
      setMe(profile);
      setBossNo(wallet?.bossNo ?? "");
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    }
  };

  useLoad(async () => {
    const accessToken = session.getToken();
    setToken(accessToken);
    if (accessToken) await load(accessToken);
    const code = await resolveTenantCode();
    if (code) setTenantCode(code);
  });

  const login = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const accessToken = await customerLogin(tenantCode, username, password);
      setToken(accessToken);
      setPassword("");
      await load(accessToken);
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await customerLogout();
    } catch {
      session.clearToken();
    }
    setBusy(false);
    void Taro.reLaunch({ url: "/pages/customer/home/index" });
  };

  /**
   * 陪玩申请：本页账号是 CUSTOMER，申请经老板审核通过后由 SP1 的多角色授权开出 PLAYER 角色，
   * 同一 token 随后可进陪玩端。
   */
  const applyPlayer = async () => {
    if (!applyIntro.trim()) {
      setMsg({ tone: "error", text: "请填写陪玩申请说明" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await applyAsPlayer(applyIntro.trim());
      setApplyIntro("");
      setShowApply(false);
      setMsg({ tone: "success", text: "已提交，等待老板审核。" });
    } catch (error) {
      setMsg({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CustomerShell title="我的" active="profile">
      {!token ? (
        <CustomerLoginCard
          tenantCode={tenantCode}
          username={username}
          password={password}
          busy={busy}
          actionLabel="登录老板端"
          onTenantCode={setTenantCode}
          onUsername={setUsername}
          onPassword={setPassword}
          onLogin={() => void login()}
        />
      ) : null}
      {msg ? (
        <CustomerMessage tone={msg.tone}>{msg.text}</CustomerMessage>
      ) : null}
      {token && me ? (
        <>
          <View className="cu-profile-head">
            <View className="cu-avatar cu-avatar-large">
              {me.name.slice(0, 1)}
            </View>
            <View>
              <Text className="cu-card-title">{me.name}</Text>
              <Text className="cu-meta">
                {bossNo ? `老板编号 ${bossNo}` : "老板编号生成中"}
                {me.mobile ? ` · ${me.mobile}` : ""}
              </Text>
            </View>
          </View>
          <View className="cu-card cu-menu-card">
            <Button
              className="cu-menu cu-menu-button"
              onClick={() => goCustomer("/pages/customer/orders/index")}
            >
              <Text className="cu-menu-label">我的订单</Text>
              <Text className="cu-menu-arrow">›</Text>
            </Button>
            <Button
              className="cu-menu cu-menu-button"
              onClick={() => goCustomer("/pages/customer/wallet/index")}
            >
              <Text className="cu-menu-label">我的钱包</Text>
              <Text className="cu-menu-arrow">›</Text>
            </Button>
            <Button
              className="cu-menu cu-menu-button"
              onClick={() => goCustomer("/pages/customer/disputes/index")}
            >
              <Text className="cu-menu-label">我的争议</Text>
              <Text className="cu-menu-arrow">›</Text>
            </Button>
          </View>
          <Button
            className="cu-button cu-button-outline cu-button-full"
            onClick={() => goCustomer("/pages/account/password/index")}
          >
            设置密码
          </Button>
          <Button
            className="cu-button cu-button-outline cu-button-full"
            disabled={busy}
            aria-pressed={showApply}
            onClick={() => setShowApply(!showApply)}
          >
            {showApply ? "收起陪玩申请" : "申请成为陪玩"}
          </Button>
          {showApply ? (
            <View className="cu-card">
              <Text className="cu-card-title">陪玩申请说明</Text>
              <Textarea
                className="cu-textarea"
                name="playerApplyIntro"
                aria-label="陪玩申请说明"
                value={applyIntro}
                onInput={(event) => setApplyIntro(event.detail.value)}
                placeholder="介绍擅长游戏与段位，便于老板审核"
              />
              <Button
                className="cu-button cu-button-primary cu-button-full"
                disabled={busy}
                onClick={() => void applyPlayer()}
              >
                {busy ? "提交中…" : "提交申请"}
              </Button>
            </View>
          ) : null}
          <Button
            className="cu-button cu-button-outline cu-button-full"
            disabled={busy}
            onClick={() => void logout()}
          >
            {busy ? "正在退出…" : "退出登录"}
          </Button>
        </>
      ) : null}
    </CustomerShell>
  );
}
