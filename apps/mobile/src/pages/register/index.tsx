import { Button, Input, Text, Textarea, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useState } from "react";
import { tenantLocator } from "@platform-locator";
import {
  CustomerMessage,
  CustomerShell,
} from "../../components/customer-ui";
import { sendPhoneCode } from "../../features/customer-ui/session";
import {
  applyAsPlayer,
  registerAccount,
} from "../../features/account-ui/actions";

type Message = { tone: "error" | "success" | "info"; text: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function RegisterPage() {
  const [storeName, setStoreName] = useState("陪玩门店");
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [debugCode, setDebugCode] = useState("");
  const [sending, setSending] = useState(false);
  const [asPlayer, setAsPlayer] = useState(false);
  const [playerIntro, setPlayerIntro] = useState("");
  /** 非 null ⇒ 账号已建好、陪玩申请未提交：只允许重试申请或直接进入老板端。 */
  const [pendingIntro, setPendingIntro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Message | null>(null);

  useLoad(async () => {
    const info = await tenantLocator.resolveTenant();
    if (info.state === "ok" && info.tenant) {
      setTenantCode(info.tenant.code);
      if (info.tenant.name) setStoreName(info.tenant.name);
    }
  });

  const sendCode = async () => {
    setSending(true);
    setMsg(null);
    try {
      const result = await sendPhoneCode(tenantCode.trim(), phone.trim());
      setDebugCode(result.debugCode ?? "");
      setMsg({ tone: "info", text: "验证码已发送，请在有效期内填写。" });
    } catch (error) {
      setMsg({ tone: "error", text: messageOf(error) });
    } finally {
      setSending(false);
    }
  };

  const enterBossHome = async () => {
    await Taro.redirectTo({ url: "/pages/customer/home/index" });
  };

  const submit = async () => {
    if (!tenantCode.trim()) {
      setMsg({ tone: "error", text: "请填写门店码" });
      return;
    }
    if (password !== confirm) {
      setMsg({ tone: "error", text: "两次输入的密码不一致" });
      return;
    }
    if (phone.trim() && !code.trim()) {
      setMsg({ tone: "error", text: "已填手机号，请先获取并填写验证码" });
      return;
    }
    if (asPlayer && !playerIntro.trim()) {
      setMsg({
        tone: "error",
        text: "选择陪玩身份需要填写申请说明，或取消勾选先以老板身份注册",
      });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const outcome = await registerAccount({
        tenantCode: tenantCode.trim(),
        username: username.trim(),
        password,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim(), code: code.trim() } : {}),
        asPlayer,
        ...(asPlayer ? { playerIntro: playerIntro.trim() } : {}),
      });
      if (outcome.playerApplication === "failed") {
        setPendingIntro(playerIntro.trim());
        setMsg({
          tone: "info",
          text:
            "账号已创建，陪玩申请未提交，可重试。" +
            (outcome.playerError ? `（${outcome.playerError}）` : ""),
        });
        return;
      }
      await enterBossHome();
    } catch (error) {
      setMsg({ tone: "error", text: messageOf(error) });
    } finally {
      setBusy(false);
    }
  };

  const retryPlayerApplication = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await applyAsPlayer(pendingIntro ?? "");
      await enterBossHome();
    } catch (error) {
      setMsg({ tone: "error", text: messageOf(error) });
    } finally {
      setBusy(false);
    }
  };

  if (pendingIntro !== null) {
    return (
      <CustomerShell title="注册账号" subtitle={storeName} active="home">
        {msg ? (
          <CustomerMessage tone={msg.tone}>{msg.text}</CustomerMessage>
        ) : null}
        <View className="cu-card">
          <Text className="cu-card-title">账号已创建</Text>
          <Text className="cu-meta">
            陪玩申请还没有提交成功。重试只会补交申请，不会重复建号。
          </Text>
        </View>
        <Button
          className="cu-button cu-button-primary cu-button-full"
          disabled={busy}
          onClick={() => void retryPlayerApplication()}
        >
          {busy ? "提交中…" : "重试提交陪玩申请"}
        </Button>
        <Button
          className="cu-button cu-button-outline cu-button-full"
          disabled={busy}
          onClick={() => void enterBossHome()}
        >
          先进入老板端
        </Button>
      </CustomerShell>
    );
  }

  return (
    <CustomerShell title="注册账号" subtitle={storeName} active="home">
      {msg ? (
        <CustomerMessage tone={msg.tone}>{msg.text}</CustomerMessage>
      ) : null}
      <View className="cu-card cu-login-card">
        <Text className="cu-section-label">账号信息</Text>
        <View className="cu-field">
          <Text className="cu-label">门店 code</Text>
          <Input
            className="cu-input"
            name="tenantCode"
            aria-label="门店 code"
            value={tenantCode}
            onInput={(event) => setTenantCode(event.detail.value)}
            placeholder="demo"
          />
        </View>
        <View className="cu-field">
          <Text className="cu-label">用户名</Text>
          <Input
            className="cu-input"
            name="username"
            aria-label="用户名"
            value={username}
            onInput={(event) => setUsername(event.detail.value)}
            placeholder="字母开头，可含数字与下划线"
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
            onInput={(event) => setPassword(event.detail.value)}
            placeholder="至少 8 位"
          />
        </View>
        <View className="cu-field">
          <Text className="cu-label">确认密码</Text>
          <Input
            className="cu-input"
            password
            name="confirmPassword"
            aria-label="确认密码"
            value={confirm}
            onInput={(event) => setConfirm(event.detail.value)}
            placeholder="再输入一次"
          />
        </View>
        <View className="cu-field">
          <Text className="cu-label">昵称（可选）</Text>
          <Input
            className="cu-input"
            name="displayName"
            aria-label="昵称"
            value={displayName}
            onInput={(event) => setDisplayName(event.detail.value)}
            placeholder="留空则自动生成"
          />
        </View>
      </View>

      <View className="cu-card">
        <Text className="cu-section-label">手机号（可选）</Text>
        <Text className="cu-meta">
          绑定后可用手机号快捷登录同一账号；不填也能注册。
        </Text>
        <View className="cu-field">
          <Text className="cu-label">手机号</Text>
          <Input
            className="cu-input"
            type="number"
            name="phone"
            aria-label="手机号"
            value={phone}
            onInput={(event) => setPhone(event.detail.value)}
            placeholder="请输入手机号"
          />
        </View>
        <View className="cu-field">
          <Text className="cu-label">验证码</Text>
          <Input
            className="cu-input"
            type="number"
            name="phoneCode"
            aria-label="验证码"
            value={code}
            onInput={(event) => setCode(event.detail.value)}
            placeholder="6 位验证码"
          />
          <Button
            className="cu-button cu-button-outline cu-button-small"
            disabled={sending || !/^1\d{10}$/.test(phone)}
            onClick={() => void sendCode()}
          >
            {sending ? "发送中…" : "获取验证码"}
          </Button>
        </View>
        {debugCode ? (
          <Text className="cu-footnote">
            本地调试验证码：{debugCode}（正式环境不会显示）
          </Text>
        ) : null}
      </View>

      <View className="cu-card">
        <Text className="cu-section-label">身份</Text>
        <Button
          className={`cu-choice${asPlayer ? " is-active" : ""}`}
          aria-label="我是陪玩"
          aria-pressed={asPlayer}
          onClick={() => setAsPlayer(!asPlayer)}
        >
          <View className="cu-grow">
            <Text className="cu-choice-title">我是陪玩</Text>
            <Text className="cu-choice-note">
              注册后自动提交陪玩申请，由老板审核；审核前可先当老板使用。
            </Text>
          </View>
          <Text className="cu-choice-tag">{asPlayer ? "已选择" : "可选"}</Text>
        </Button>
        {asPlayer ? (
          <Textarea
            className="cu-textarea"
            name="playerIntro"
            aria-label="陪玩申请说明"
            value={playerIntro}
            onInput={(event) => setPlayerIntro(event.detail.value)}
            placeholder="介绍擅长游戏与段位，便于老板审核"
          />
        ) : null}
      </View>

      <Button
        className="cu-button cu-button-primary cu-button-full"
        disabled={busy}
        onClick={() => void submit()}
      >
        {busy ? "提交中…" : "注册并进入老板端"}
      </Button>
      <Text className="cu-footnote">
        已有账号？用手机号或账号密码在老板端首页登录即可。
      </Text>
    </CustomerShell>
  );
}
