import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState } from "react";
import { session } from "@platform-session";
import {
  CustomerMessage,
  CustomerShell,
} from "../../../components/customer-ui";
import { setAccountPassword } from "../../../features/account-ui/actions";

type Message = { tone: "error" | "success" | "info"; text: string };

/** 服务端「需验证原密码」的唯一信号：400 + 该消息（`errors.ts` 的 CurrentPasswordInvalidError）。 */
const CURRENT_PASSWORD_REQUIRED = "原密码不正确";
const TOAST_MS = 1500;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function AccountPasswordPage() {
  const [hasToken] = useState(() => session.getToken() !== null);
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  /** 首屏不要求原密码（初次免验）；服务端要求时才把输入框显示出来。 */
  const [needsCurrent, setNeedsCurrent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Message | null>(null);

  const finish = () => {
    setMsg({ tone: "success", text: "密码已设置，可用账号密码登录。" });
    Taro.showToast({
      title: "密码已设置",
      icon: "success",
      duration: TOAST_MS,
    });
    setTimeout(() => {
      Taro.navigateBack({ delta: 1 }).catch(() => {
        void Taro.redirectTo({ url: "/pages/customer/home/index" });
      });
    }, TOAST_MS);
  };

  const submit = async () => {
    if (!newPassword) {
      setMsg({ tone: "error", text: "请填写新密码" });
      return;
    }
    if (newPassword !== confirm) {
      setMsg({ tone: "error", text: "两次输入的密码不一致" });
      return;
    }
    if (needsCurrent && !currentPassword) {
      setMsg({ tone: "error", text: "请填写原密码" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await setAccountPassword({
        newPassword,
        ...(currentPassword ? { currentPassword } : {}),
      });
      finish();
    } catch (error) {
      const err = error as Error & { status?: number };
      if (err.status === 400 && err.message === CURRENT_PASSWORD_REQUIRED) {
        setNeedsCurrent(true);
        setMsg({
          tone: "info",
          text: "该账号已设置过密码，需验证原密码后才能修改。",
        });
        return;
      }
      setMsg({ tone: "error", text: messageOf(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CustomerShell
      title="设置密码"
      subtitle="设置后可用账号密码登录"
      active="profile"
    >
      {!hasToken ? (
        <CustomerMessage tone="error">
          登录状态已失效，请重新登录后再设置密码。
        </CustomerMessage>
      ) : null}
      {msg ? (
        <CustomerMessage tone={msg.tone}>{msg.text}</CustomerMessage>
      ) : null}
      <View className="cu-card cu-login-card">
        <Text className="cu-section-label">新密码</Text>
        <Text className="cu-meta">
          初次设置不需要原密码；已经设置过的账号需要验证原密码。
        </Text>
        <View className="cu-field">
          <Text className="cu-label">新密码</Text>
          <Input
            className="cu-input"
            password
            name="newPassword"
            aria-label="新密码"
            value={newPassword}
            onInput={(event) => setNewPassword(event.detail.value)}
            placeholder="至少 8 位"
          />
        </View>
        <View className="cu-field">
          <Text className="cu-label">确认新密码</Text>
          <Input
            className="cu-input"
            password
            name="confirmPassword"
            aria-label="确认新密码"
            value={confirm}
            onInput={(event) => setConfirm(event.detail.value)}
            placeholder="再输入一次"
          />
        </View>
        {needsCurrent ? (
          <View className="cu-field">
            <Text className="cu-label">原密码</Text>
            <Input
              className="cu-input"
              password
              name="currentPassword"
              aria-label="原密码"
              value={currentPassword}
              onInput={(event) => setCurrentPassword(event.detail.value)}
              placeholder="当前正在使用的密码"
            />
          </View>
        ) : null}
      </View>
      <Button
        className="cu-button cu-button-primary cu-button-full"
        disabled={busy || !hasToken}
        onClick={() => void submit()}
      >
        {busy ? "提交中…" : "保存密码"}
      </Button>
    </CustomerShell>
  );
}
