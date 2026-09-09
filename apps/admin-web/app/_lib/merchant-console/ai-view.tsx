"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Sparkles, WandSparkles } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";
import { DemoEmptyState, useDemoToast } from "./demo-ui";
import {
  type CustomerRow,
  type FeatureState,
  type GameProduct,
  type OrderRow,
} from "./merchant-api";
import { useMerchantRole } from "./role-context";

const SAMPLE_TEXT = "今晚8点 王者荣耀双排，2小时，找一个打野，预算200以内";

interface Capabilities {
  supported: boolean;
  provider?: string;
  reason?: string;
}
interface PricingOption {
  id: string;
  durationSeconds: number;
  enabled: boolean;
}
interface ParseResult {
  runId: string;
  missing: string[];
  confidenceBp: number;
  status: string;
  note: string;
}

const MISSING_LABELS: Record<string, string> = {
  description: "需求描述",
  serviceProductId: "服务项目",
  durationSeconds: "服务时长",
  desiredStartAt: "期望开始时间",
};

export function AiAssistantView() {
  const router = useRouter();
  const { role } = useMerchantRole();
  const { toast, showToast } = useDemoToast();
  const [text, setText] = useState(SAMPLE_TEXT);
  const [productId, setProductId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [desiredStart, setDesiredStart] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ["merchant", "ai", "overview"],
    queryFn: async () => {
      const [features, capabilities, products, customers] = await Promise.all([
        apiFetch<FeatureState[]>("/api/v1/tenant/features"),
        apiFetch<Capabilities>("/api/v1/tenant/ai/capabilities"),
        apiFetch<GameProduct[]>("/api/v1/tenant/catalog/products"),
        apiFetch<CustomerRow[]>("/api/v1/tenant/customers"),
      ]);
      return { features, capabilities, products, customers };
    },
  });
  const pricingQuery = useQuery({
    queryKey: ["merchant", "ai", "pricing", productId],
    queryFn: () =>
      apiFetch<PricingOption[]>(
        `/api/v1/tenant/catalog/products/${productId}/pricing`,
      ),
    enabled: productId !== "",
  });
  const parse = useMutation({
    mutationFn: () =>
      apiFetch<ParseResult>("/api/v1/tenant/ai/parse-requirement", {
        method: "POST",
        body: JSON.stringify({
          description: text,
          serviceProductId: productId || null,
          durationSeconds: durationSeconds ? Number(durationSeconds) : null,
          desiredStartAt: desiredStart
            ? new Date(desiredStart).toISOString()
            : null,
        }),
      }),
    onSuccess: (result) => {
      setError(null);
      setParseResult(result);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const createOrder = useMutation({
    mutationFn: async () => {
      if (!parseResult || parseResult.missing.length > 0)
        throw new Error("解析字段不完整，无法创建订单");
      if (!customerId) throw new Error("请选择老板客户");
      return apiFetch<OrderRow>("/api/v1/tenant/orders", {
        method: "POST",
        body: JSON.stringify({
          customerProfileId: customerId,
          requirement: {
            description: text,
            serviceProductId: productId,
            durationSeconds: durationSeconds
              ? Number(durationSeconds)
              : null,
            ...(desiredStart
              ? { desiredStartAt: new Date(desiredStart).toISOString() }
              : {}),
          },
        }),
      });
    },
    onSuccess: (order) => {
      showToast(`订单草稿已创建：${order.orderNo}`);
      router.push(
        `/merchant-console/dispatch/${order.id}?kind=CLASSIC`,
      );
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const features = overview.data?.features ?? [];
  const aiEnabled = features.some(
    (feature) =>
      feature.featureKey === "addon.ai_requirement_parser" && feature.enabled,
  );
  const capabilities = overview.data?.capabilities;
  const products = (overview.data?.products ?? []).filter((p) => p.enabled);
  const customers = overview.data?.customers ?? [];
  const durations = (pricingQuery.data ?? []).filter((d) => d.enabled);
  const ready = parseResult?.missing.length === 0;
  const canOperate = role === "OWNER" || role === "ADMIN" || role === "CS";

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">ASSISTANT / AI</div>
          <h1>AI 需求助手</h1>
          <p>真实解析接口：粘贴需求 → 结构化校验 → 人工确认后创建订单。</p>
        </div>
        <span className={`mc-status ${capabilities?.supported ? "st-done" : "st-pending"}`}>
          {capabilities?.supported
            ? `外部 AI：${capabilities.provider ?? "-"}`
            : "本地确定性预检"}
        </span>
      </div>

      {error ? <div className="mc-notice">{error}</div> : null}
      {!aiEnabled ? (
        <section className="mc-panel">
          <DemoEmptyState
            title="AI 需求解析未开通"
            description="请联系平台方在门店套餐中开启 addon.ai_requirement_parser。"
          />
        </section>
      ) : (
        <div className="mc-ai-grid">
          <section className="mc-panel mc-ai-panel">
            <div className="mc-section-head">
              <div>
                <h2>客户需求原文</h2>
                <p>支持粘贴聊天记录或语音转文字片段</p>
              </div>
            </div>
            <div className="mc-ai-body">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="例如：今晚8点 王者荣耀双排 2小时 需要一个打野"
                aria-label="客户需求原文"
              />
              <div className="mc-form-grid">
                <label className="mc-field">
                  <span>服务项目</span>
                  <select
                    value={productId}
                    onChange={(e) => {
                      setProductId(e.target.value);
                      setDurationSeconds("");
                    }}
                  >
                    <option value="">请选择…</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mc-field">
                  <span>服务时长</span>
                  <select
                    value={durationSeconds}
                    onChange={(e) => setDurationSeconds(e.target.value)}
                    disabled={!productId}
                  >
                    <option value="">先选服务项目…</option>
                    {durations.map((pricing) => (
                      <option
                        key={pricing.id}
                        value={String(pricing.durationSeconds)}
                      >
                        {Math.round(pricing.durationSeconds / 60)} 分钟
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mc-field">
                  <span>老板客户</span>
                  <select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                  >
                    <option value="">选择客户…</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mc-field">
                  <span>期望开始时间</span>
                  <input
                    type="datetime-local"
                    value={desiredStart}
                    onChange={(e) => setDesiredStart(e.target.value)}
                  />
                </label>
              </div>
              <div className="mc-button-row">
                <button
                  type="button"
                  className="mc-btn mc-btn-primary"
                  disabled={parse.isPending || !text.trim()}
                  onClick={() => parse.mutate()}
                >
                  <WandSparkles size={15} />
                  {parse.isPending ? "解析中…" : "解析为结构化建议"}
                </button>
              </div>
            </div>
          </section>

          <section className="mc-panel mc-ai-panel">
            <div className="mc-section-head">
              <div>
                <h2>解析预览</h2>
                <p>客服核对后才创建订单</p>
              </div>
              {parseResult ? (
                <span className={`mc-status ${ready ? "st-done" : "st-pending"}`}>
                  {ready ? "字段完整" : "缺少必要需求"}
                </span>
              ) : null}
            </div>
            <div className="mc-ai-body">
              {parseResult ? (
                <div>
                  <div className="mc-summary-line">
                    <span>置信度</span>
                    <b>{Math.round(parseResult.confidenceBp / 100)}%</b>
                  </div>
                  <div className="mc-summary-line">
                    <span>状态</span>
                    <b>{parseResult.status}</b>
                  </div>
                  <div className="mc-summary-line">
                    <span>结论</span>
                    <b>{parseResult.note}</b>
                  </div>
                  {parseResult.missing.length > 0 ? (
                    <ul className="mc-feature-list">
                      {parseResult.missing.map((key) => (
                        <li key={key} className="mc-feature-row">
                          <span className="mc-status st-pending">
                            缺 {MISSING_LABELS[key] ?? key}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {ready && canOperate ? (
                    <div className="mc-button-row mc-ai-actions">
                      <button
                        type="button"
                        className="mc-btn mc-btn-primary"
                        disabled={createOrder.isPending || !customerId}
                        onClick={() => createOrder.mutate()}
                      >
                        {createOrder.isPending ? "创建中…" : "创建经典订单草稿"}
                        <ArrowRight size={15} />
                      </button>
                      <button
                        type="button"
                        className="mc-btn"
                        onClick={() => router.push("/merchant-console/dispatch/new")}
                      >
                        去新建 GD 派单
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mc-empty mc-empty-compact">
                  <Sparkles size={22} aria-hidden="true" />
                  <p>解析结果会显示在这里，可继续编辑后创建订单。</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      {toast}
    </div>
  );
}
