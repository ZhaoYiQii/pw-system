"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { apiFetch } from "../../_lib/api";
import { featureLabel } from "../../_lib/feature-catalog";
import { PlatformShell } from "../../_lib/platform-shell";

const tenantHostSuffix = (
  process.env.NEXT_PUBLIC_TENANT_HOST_SUFFIX ?? "17ai.club"
).replace(/^\./, "");

interface PackageOption {
  code: string;
  name: string;
  addons: string[];
  durationDays: number;
}

interface OnboardResult {
  tenantId: string;
  tenantCode: string;
}

const WIZARD_STEPS = ["基本信息", "品牌与域名", "店主账号", "套餐开通", "确认开通"];
const CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function defaultHostFor(code: string): string {
  const c = code.trim().toLowerCase();
  return c ? `${c}.${tenantHostSuffix}` : "";
}

function Field({
  label,
  htmlFor,
  hint,
  children,
  full = false,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <div className={`pw-field ${full ? "pw-full" : ""}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? (
        <span style={{ fontSize: 11, color: "var(--pw-muted)" }}>{hint}</span>
      ) : null}
    </div>
  );
}

function Inner() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [created, setCreated] = useState<OnboardResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [host, setHost] = useState("");
  const [logoText, setLogoText] = useState("");
  const [brandPrimary, setBrandPrimary] = useState("#2f54eb");
  const [brandAccent, setBrandAccent] = useState("#fa8c16");
  const [storeCutBp, setStoreCutBp] = useState("2000");
  const [ownerUsername, setOwnerUsername] = useState("owner");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [packageCode, setPackageCode] = useState("BASIC");

  const packagesQuery = useQuery({
    queryKey: ["platform-packages"],
    queryFn: () => apiFetch<PackageOption[]>("/api/v1/platform/packages"),
  });

  const onboard = useMutation({
    mutationFn: (): Promise<OnboardResult> => {
      const resolvedHost = host.trim() !== "" ? host.trim() : defaultHostFor(code);
      return apiFetch<OnboardResult>("/api/v1/platform/onboarding/tenants", {
        method: "POST",
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          host: resolvedHost,
          ownerUsername: ownerUsername.trim(),
          ownerPassword,
          brandPrimary,
          ...(brandAccent.trim() !== "" ? { brandAccent: brandAccent.trim() } : {}),
          ...(logoText.trim() !== "" ? { logoText: logoText.trim() } : {}),
          storeCutBp: Number(storeCutBp),
          packageCode,
        }),
      });
    },
    onSuccess: (result) => {
      setCreated(result);
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
      void queryClient.invalidateQueries({ queryKey: ["platform-packages"] });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : String(error)),
  });

  const packages = packagesQuery.data ?? [];
  const selectedPackage = packages.find((p) => p.code === packageCode);
  const resolvedHost = host.trim() !== "" ? host.trim() : defaultHostFor(code);
  const bp = Number(storeCutBp);
  const bpValid =
    storeCutBp.trim() !== "" &&
    Number.isInteger(bp) &&
    bp >= 0 &&
    bp <= 9700;

  const validate = (): boolean => {
    setFormError(null);
    if (step === 0) {
      if (!name.trim()) {
        setFormError("请填写门店名称。");
        return false;
      }
      if (!CODE_PATTERN.test(code.trim())) {
        setFormError(
          "门店 Code 需为 2–32 位小写字母/数字，可用 _ 或 -，且不能以符号开头。",
        );
        return false;
      }
      return true;
    }
    if (step === 1) {
      if (!COLOR_PATTERN.test(brandPrimary)) {
        setFormError("品牌主色必须是 #RRGGBB 格式。");
        return false;
      }
      if (brandAccent.trim() !== "" && !COLOR_PATTERN.test(brandAccent.trim())) {
        setFormError("品牌点缀色必须是 #RRGGBB 格式。");
        return false;
      }
      if (!bpValid) {
        setFormError("门店抽成需为 0–9700 之间的整数 bp（1% = 100bp）。");
        return false;
      }
      return true;
    }
    if (step === 2) {
      if (!ownerUsername.trim()) {
        setFormError("请填写店主用户名。");
        return false;
      }
      if (ownerPassword.length < 8) {
        setFormError("店主临时密码至少 8 位。");
        return false;
      }
      return true;
    }
    if (step === 3) {
      if (!packageCode) {
        setFormError("请选择一个开通套餐。");
        return false;
      }
      return true;
    }
    return true;
  };

  if (created) {
    return (
      <PlatformShell>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div className="pw-page-head">
            <div>
              <div className="pw-eyebrow">Platform / Onboarding</div>
              <h1>门店已开通</h1>
              <p>平台已创建租户、H5 域名、店主账号并开通套餐。</p>
            </div>
          </div>
          <div className="pw-panel">
            <div className="pw-panel-head">
              <h2>开通结果</h2>
              <p>{created.tenantCode}</p>
            </div>
            <div className="pw-panel-body">
              <div className="pw-detail-grid">
                <div className="pw-field">
                  <label>门店</label>
                  <input value={`${name.trim()}（${created.tenantCode}）`} readOnly />
                </div>
                <div className="pw-field">
                  <label>H5 主域名</label>
                  <input value={resolvedHost} readOnly />
                </div>
                <div className="pw-field">
                  <label>店主账号</label>
                  <input value={ownerUsername.trim()} readOnly />
                </div>
                <div className="pw-field">
                  <label>开通套餐</label>
                  <input
                    value={`${selectedPackage?.name ?? packageCode}（${
                      selectedPackage?.durationDays ?? "—"
                    } 天）`}
                    readOnly
                  />
                </div>
              </div>
              <div className="pw-notice">
                临时密码仅本次交付店主；平台不留存明文。请继续为门店配置增值功能。
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <Link
                  className="pw-btn pw-primary"
                  href={`/packages?tenantId=${encodeURIComponent(created.tenantId)}`}
                >
                  进入套餐配置
                </Link>
                <Link className="pw-btn" href="/tenants">
                  返回门店管理
                </Link>
              </div>
            </div>
          </div>
        </div>
      </PlatformShell>
    );
  }

  return (
    <PlatformShell>
      <div className="pw-page-head">
        <div>
          <div className="pw-eyebrow">Platform / Onboarding</div>
          <h1>一键开店</h1>
          <p>15 分钟内完成配置并交付店主账号。</p>
        </div>
      </div>

      <div className="pw-wizard">
        {WIZARD_STEPS.map((label, index) => {
          const cls =
            index < step ? "pw-wz pw-done" : index === step ? "pw-wz pw-now" : "pw-wz";
          return (
            <button
              key={label}
              type="button"
              className={cls}
              disabled={index >= step}
              onClick={() => {
                setFormError(null);
                setStep(index);
              }}
            >
              <b>{String(index + 1).padStart(2, "0")}</b>
              {label}
            </button>
          );
        })}
      </div>

      <div className="pw-panel">
        <div className="pw-panel-head">
          <h2>{WIZARD_STEPS[step] ?? "开通向导"}</h2>
          <p>
            {step === 0
              ? "门店将作为独立租户开通"
              : step === 1
                ? "配置 H5 域名与品牌外观"
                : step === 2
                  ? "店主账号用于登录商家端"
                  : step === 3
                    ? "套餐决定随门店开通的增值功能"
                    : "确认后一次性创建租户与店主账号"}
          </p>
        </div>
        <div className="pw-panel-body">
          {formError ? (
            <div
              className="pw-notice"
              style={{ background: "var(--pw-red-soft)", color: "var(--pw-red)" }}
            >
              {formError}
            </div>
          ) : null}

          {step === 0 ? (
            <div className="pw-form">
              <Field label="门店名称" htmlFor="name" hint="例如：星尘电竞">
                <input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="如 星尘电竞"
                  autoFocus
                  required
                />
              </Field>
              <Field label="门店 Code" htmlFor="code" hint="小写字母/数字开头，2–32 位，全局唯一">
                <input
                  id="code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="如 xingchen"
                  autoComplete="off"
                  required
                />
              </Field>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="pw-form">
              <Field
                label="门店域名 Host（必填，用于 H5 定位）"
                htmlFor="host"
                full
                hint={`留空自动生成：${defaultHostFor(code) || `{code}.${tenantHostSuffix}`}`}
              >
                <input
                  id="host"
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  placeholder={defaultHostFor(code) || `shop.${tenantHostSuffix}`}
                  autoComplete="off"
                />
              </Field>
              <Field label="品牌文字（Logo Text）" htmlFor="logoText">
                <input
                  id="logoText"
                  value={logoText}
                  onChange={(event) => setLogoText(event.target.value)}
                  placeholder={name.trim() || "默认使用门店名称"}
                />
              </Field>
              <Field label="品牌主色（H5）" htmlFor="brandPrimary">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    id="brandPrimary"
                    type="color"
                    value={brandPrimary}
                    onChange={(event) => setBrandPrimary(event.target.value)}
                    style={{ width: 52 }}
                  />
                  <span className="pw-mono" style={{ color: "var(--pw-muted)" }}>
                    {brandPrimary}
                  </span>
                </div>
              </Field>
              <Field label="品牌点缀色" htmlFor="brandAccent">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    id="brandAccent"
                    type="color"
                    value={brandAccent}
                    onChange={(event) => setBrandAccent(event.target.value)}
                    style={{ width: 52 }}
                  />
                  <span className="pw-mono" style={{ color: "var(--pw-muted)" }}>
                    {brandAccent}
                  </span>
                </div>
              </Field>
              <Field label="门店抽成（bp，1% = 100bp）" htmlFor="storeCutBp">
                <input
                  id="storeCutBp"
                  type="number"
                  min={0}
                  max={9700}
                  value={storeCutBp}
                  onChange={(event) => setStoreCutBp(event.target.value)}
                />
              </Field>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="pw-form">
              <Field label="店主用户名" htmlFor="ownerUsername">
                <input
                  id="ownerUsername"
                  value={ownerUsername}
                  onChange={(event) => setOwnerUsername(event.target.value)}
                  autoComplete="off"
                  required
                />
              </Field>
              <Field
                label="临时密码"
                htmlFor="ownerPassword"
                hint="至少 8 位；密码仅首次交付店主，平台不留存明文。"
              >
                <input
                  id="ownerPassword"
                  type="password"
                  value={ownerPassword}
                  onChange={(event) => setOwnerPassword(event.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  required
                />
              </Field>
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              {packagesQuery.isPending ? (
                <div className="pw-empty">加载套餐…</div>
              ) : null}
              {packages.map((pkg) => {
                const selected = pkg.code === packageCode;
                return (
                  <div className="pw-addon-row" key={pkg.code}>
                    <span>
                      <b>{pkg.name}</b>
                      <span
                        className="pw-mono"
                        style={{
                          display: "block",
                          color: "var(--pw-muted)",
                          fontSize: 11,
                        }}
                      >
                        {pkg.durationDays} 天 ·{" "}
                        {pkg.addons.length > 0
                          ? pkg.addons.map((key) => featureLabel(key)).join(" · ")
                          : "仅核心功能"}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={`pw-toggle ${selected ? "pw-on" : ""}`}
                      aria-label={`选择${pkg.name}`}
                      onClick={() => setPackageCode(pkg.code)}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}

          {step === 4 ? (
            <div>
              <div className="pw-detail-grid">
                <div className="pw-field">
                  <label>门店</label>
                  <input value={`${name.trim()}（${code.trim()}）`} readOnly />
                </div>
                <div className="pw-field">
                  <label>H5 域名</label>
                  <input value={resolvedHost} readOnly />
                </div>
                <div className="pw-field">
                  <label>店主账号</label>
                  <input value={ownerUsername.trim()} readOnly />
                </div>
                <div className="pw-field">
                  <label>套餐 / 门店抽成</label>
                  <input
                    value={`${selectedPackage?.name ?? packageCode} / ${bpValid ? `${bp} bp` : "—"}`}
                    readOnly
                  />
                </div>
              </div>
              <div className="pw-notice">
                提交后将创建租户、域名、品牌、店主账号与套餐；临时密码直接交付店主。
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <button
          type="button"
          className="pw-btn"
          disabled={step === 0 || onboard.isPending}
          onClick={() => {
            setFormError(null);
            setStep((s) => Math.max(0, s - 1));
          }}
        >
          上一步
        </button>
        {step < WIZARD_STEPS.length - 1 ? (
          <button
            type="button"
            className="pw-btn pw-primary"
            onClick={() => {
              if (validate()) setStep((s) => s + 1);
            }}
          >
            下一步
          </button>
        ) : (
          <button
            type="button"
            className="pw-btn pw-primary"
            disabled={onboard.isPending}
            onClick={() => onboard.mutate()}
          >
            {onboard.isPending ? "开通中…" : "确认开通"}
          </button>
        )}
      </div>
    </PlatformShell>
  );
}

export default function PlatformOnboardPage() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Inner />
    </QueryClientProvider>
  );
}

