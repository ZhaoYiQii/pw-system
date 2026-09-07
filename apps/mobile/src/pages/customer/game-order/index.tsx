import { Button, Input, Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState, type CSSProperties } from "react";
import { identityAdapter } from "@platform-identity";
import { session } from "@platform-session";
import { apiAdapter } from "@platform-api";

interface TemplateOption {
  id: string;
  name: string;
}
interface TemplateDetail {
  id: string;
  name: string;
  fields: Array<{
    fieldKey: string;
    label: string;
    fieldType: string;
    required: boolean;
    options: string[];
  }>;
  positions: Array<{ id: string; label: string; defaultCount: number }>;
}

export default function GameOrderPage() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [duration, setDuration] = useState("60");
  const [msg, setMsg] = useState<string | null>(null);

  const loadTemplates = async (t: string) => {
    const list = await apiAdapter.request<TemplateOption[]>(
      "/api/v1/tenant/game-dispatch/customer/templates",
      { token: t },
    );
    setTemplates(list);
  };

  useLoad(() => {
    const t = session.getToken();
    setToken(t);
    if (t) void loadTemplates(t);
  });

  const login = async () => {
    try {
      const s = await identityAdapter.login({
        kind: "tenant",
        tenantCode,
        username,
        password,
      });
      session.setToken(s.accessToken);
      setToken(s.accessToken);
      await loadTemplates(s.accessToken);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const selectTemplate = async (id: string) => {
    if (!token) return;
    setValues({});
    setCounts({});
    try {
      const data = await apiAdapter.request<TemplateDetail>(
        `/api/v1/tenant/game-dispatch/customer/templates/${id}`,
        { token },
      );
      setDetail(data);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const submit = async () => {
    if (!token || !detail) return;
    try {
      const formValues: Record<string, string> = {};
      for (const f of detail.fields) {
        if (f.fieldType === "duration") continue;
        const v = values[f.fieldKey]?.trim() ?? "";
        if (f.required && !v) throw new Error(`请填写 ${f.label}`);
        if (v) formValues[f.fieldKey] = v;
      }
      const lines = detail.positions.map((p) => ({
        positionLabel: p.label,
        requiredCount: Math.max(1, counts[p.id] ?? p.defaultCount),
      }));
      await apiAdapter.request("/api/v1/tenant/game-dispatch/customer/orders", {
        method: "POST",
        token,
        body: {
          templateId: detail.id,
          formValues,
          durationMinutes: Number(duration),
          lines,
        },
      });
      setMsg("下单成功，等待门店确认后即可选人。");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <View
      style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}
    >
      <Text style={{ fontSize: 20, fontWeight: "bold" }}>老板自助下单</Text>
      {msg ? <Text style={{ color: "#dc2626" }}>{msg}</Text> : null}
      {!token ? (
        <>
          <Input
            style={inputStyle}
            value={tenantCode}
            placeholder="门店 code"
            onInput={(e) => setTenantCode(e.detail.value)}
          />
          <Input
            style={inputStyle}
            value={username}
            placeholder="老板账号"
            onInput={(e) => setUsername(e.detail.value)}
          />
          <Input
            style={inputStyle}
            password
            value={password}
            placeholder="密码"
            onInput={(e) => setPassword(e.detail.value)}
          />
          <Button onClick={() => void login()}>登录</Button>
        </>
      ) : (
        <>
          <Text style={labelStyle}>选择游戏模板</Text>
          {templates.map((t) => (
            <Button
              key={t.id}
              size="mini"
              onClick={() => void selectTemplate(t.id)}
            >
              {t.name}
            </Button>
          ))}
          {detail ? (
            <>
              <Text style={{ fontWeight: "bold" }}>{detail.name}</Text>
              {detail.fields
                .filter((f) => f.fieldType !== "duration")
                .map((f) => (
                  <View key={f.fieldKey}>
                    <Text style={labelStyle}>{f.label}</Text>
                    {f.fieldType === "select" ? (
                      <Input
                        style={inputStyle}
                        value={values[f.fieldKey] ?? ""}
                        placeholder="选择"
                        onInput={(e) =>
                          setValues({ ...values, [f.fieldKey]: e.detail.value })
                        }
                      />
                    ) : (
                      <Input
                        style={inputStyle}
                        value={values[f.fieldKey] ?? ""}
                        placeholder="填写"
                        onInput={(e) =>
                          setValues({ ...values, [f.fieldKey]: e.detail.value })
                        }
                      />
                    )}
                  </View>
                ))}
              <Text style={labelStyle}>时长（分钟）</Text>
              <Input
                style={inputStyle}
                type="number"
                value={duration}
                onInput={(e) => setDuration(e.detail.value)}
              />
              {detail.positions.map((p) => (
                <View
                  key={p.id}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <Text style={{ flex: 1 }}>{p.label} 人数</Text>
                  <Input
                    style={{ ...inputStyle, width: 80 }}
                    type="number"
                    value={String(counts[p.id] ?? p.defaultCount)}
                    onInput={(e) =>
                      setCounts({
                        ...counts,
                        [p.id]: Math.max(1, Number(e.detail.value) || 1),
                      })
                    }
                  />
                </View>
              ))}
              <Button onClick={() => void submit()}>提交订单</Button>
            </>
          ) : null}
        </>
      )}
    </View>
  );
}

const inputStyle: CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: 8,
  height: 40,
};
const labelStyle: CSSProperties = {
  fontSize: 14,
  color: "#6b7280",
  marginTop: 4,
};
