"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../../_lib/api";
import { fenToYuanText, yuanToFenString } from "../../../_lib/money";
import { TenantNav } from "../../../_lib/tenant-nav";

type FieldType =
  "text" | "select" | "multiline" | "datetime" | "duration" | "note";

interface FieldDraft {
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  optionsText: string;
  placeholder: string;
  enabled: boolean;
}

interface PositionDraft {
  label: string;
  defaultCount: number;
  enabled: boolean;
}

interface RankDraft {
  rankLabel: string;
  yuanText: string;
}

interface CopyDraft {
  label: string;
  valueKey: string;
}

interface TemplatePayload {
  id: string;
  name: string;
  enabled: boolean;
  fields: Array<{
    fieldKey: string;
    label: string;
    fieldType: FieldType;
    required: boolean;
    options: string[];
    placeholder: string | null;
    sortOrder: number;
    enabled: boolean;
  }>;
  positions: Array<{
    label: string;
    defaultCount: number;
    enabled: boolean;
    sortOrder: number;
  }>;
  rankRules: Array<{ rankLabel: string; addPriceFen: string }>;
  copyLines: Array<{ label: string; valueKey: string | null }>;
}

type PageState =
  | { phase: "loading" }
  | { phase: "unauthenticated" }
  | { phase: "error"; message: string }
  | { phase: "ready" };

export default function GameTemplateEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [page, setPage] = useState<PageState>({ phase: "loading" });
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [fields, setFields] = useState<FieldDraft[]>([]);
  const [positions, setPositions] = useState<PositionDraft[]>([]);
  const [ranks, setRanks] = useState<RankDraft[]>([]);
  const [copies, setCopies] = useState<CopyDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPage({ phase: "loading" });
    try {
      const data = await apiFetch<TemplatePayload>(
        `/api/v1/tenant/game-templates/${params.id}`,
      );
      setName(data.name);
      setEnabled(data.enabled);
      setFields(
        data.fields.map((f) => ({
          fieldKey: f.fieldKey,
          label: f.label,
          fieldType: f.fieldType,
          required: f.required,
          optionsText: f.options.join("，"),
          placeholder: f.placeholder ?? "",
          enabled: f.enabled,
        })),
      );
      setPositions(
        data.positions.map((p) => ({
          label: p.label,
          defaultCount: p.defaultCount,
          enabled: p.enabled,
        })),
      );
      setRanks(
        data.rankRules.map((r) => ({
          rankLabel: r.rankLabel,
          yuanText: fenToYuanText(r.addPriceFen),
        })),
      );
      setCopies(
        data.copyLines.map((c) => ({
          label: c.label,
          valueKey: c.valueKey ?? "",
        })),
      );
      setPage({ phase: "ready" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        setPage({ phase: "unauthenticated" });
      else
        setPage({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    setOkMsg(null);
    if (!name.trim()) {
      setMsg("模板名称必填");
      setBusy(false);
      return;
    }
    const fieldsPayload = fields.map((f, index) => {
      const options = f.optionsText
        .split(/[,，\n]/)
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
      return {
        fieldKey: f.fieldKey.trim() || `field_${index}`,
        label: f.label.trim() || "未命名字段",
        fieldType: f.fieldType,
        required: f.required,
        options,
        placeholder: f.placeholder.trim() || null,
        sortOrder: index,
        enabled: f.enabled,
      };
    });
    const positionsPayload = positions.map((p, index) => ({
      label: p.label.trim(),
      defaultCount: p.defaultCount,
      enabled: p.enabled,
      sortOrder: index,
    }));
    if (positionsPayload.some((p) => p.label.length === 0)) {
      setMsg("位置名称不能为空");
      setBusy(false);
      return;
    }
    if (ranks.some((r) => r.rankLabel.trim().length === 0)) {
      setMsg("段位名称不能为空");
      setBusy(false);
      return;
    }
    for (const r of ranks) {
      if (yuanToFenString(r.yuanText) === null) {
        setMsg(`段位「${r.rankLabel}」加价需为非负金额`);
        setBusy(false);
        return;
      }
    }
    const rankRulesPayload = ranks.map((r, index) => ({
      rankLabel: r.rankLabel.trim(),
      addPriceFen: yuanToFenString(r.yuanText) as string,
      sortOrder: index,
    }));
    const copyLinesPayload = copies.map((c) => ({
      label: c.label.trim(),
      valueKey: c.valueKey.trim() || null,
    }));
    try {
      await apiFetch<unknown>(`/api/v1/tenant/game-templates/${params.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          enabled,
          fields: fieldsPayload,
          positions: positionsPayload,
          rankRules: rankRulesPayload,
          copyLines: copyLinesPayload,
        }),
      });
      setMsg(null);
      setOkMsg("模板已保存。");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
      setOkMsg(null);
    } finally {
      setBusy(false);
    }
  };

  const mutate = <T,>(
    list: T[],
    setList: (next: T[]) => void,
    index: number,
    patch: Partial<T>,
  ) =>
    setList(
      list.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );

  const removeAt = <T,>(
    list: T[],
    setList: (next: T[]) => void,
    index: number,
  ) => setList(list.filter((_, i) => i !== index));

  return (
    <main>
      <TenantNav />
      <div className="page">
        <h1 className="page-title">编辑陪玩模板</h1>
        {msg ? <p className="banner banner-error">{msg}</p> : null}
        {okMsg ? <p className="banner banner-success">{okMsg}</p> : null}
        {page.phase === "unauthenticated" ? (
          <div className="card">
            <p>尚未登录门店账号。</p>
            <Link className="btn btn-primary" href="/store/login">
              去登录
            </Link>
          </div>
        ) : null}
        {page.phase === "error" ? (
          <p className="banner banner-error">加载失败：{page.message}</p>
        ) : null}
        {page.phase === "ready" ? (
          <>
            <div className="card">
              <div className="row-actions">
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="模板名称"
                  style={{ maxWidth: 280 }}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  启用模板
                </label>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  保存
                </button>
                <Link className="btn" href="/game-templates">
                  返回列表
                </Link>
              </div>
            </div>

            <div className="card">
              <h2 className="card-title">下单字段</h2>
              <p className="card-desc">
                例如“区 / 目标段位 / 模式 / 开始时间 /
                补充需求”。段位建议用“下拉选择”。
              </p>
              {fields.map((f, i) => (
                <div
                  key={i}
                  className="row-actions"
                  style={{ marginBottom: 8 }}
                >
                  <input
                    className="input"
                    value={f.label}
                    placeholder="显示名称"
                    onChange={(e) =>
                      mutate(fields, setFields, i, { label: e.target.value })
                    }
                    style={{ maxWidth: 150 }}
                  />
                  <input
                    className="input"
                    value={f.fieldKey}
                    placeholder="字段标识"
                    onChange={(e) =>
                      mutate(fields, setFields, i, { fieldKey: e.target.value })
                    }
                    style={{ maxWidth: 150 }}
                  />
                  <select
                    className="input"
                    value={f.fieldType}
                    onChange={(e) =>
                      mutate(fields, setFields, i, {
                        fieldType: e.target.value as FieldType,
                      })
                    }
                  >
                    <option value="text">单行文本</option>
                    <option value="select">下拉选择</option>
                    <option value="multiline">多行文本</option>
                    <option value="datetime">时间</option>
                    <option value="duration">时长</option>
                    <option value="note">备注</option>
                  </select>
                  <input
                    className="input"
                    value={f.optionsText}
                    placeholder="下拉选项，用逗号分隔"
                    onChange={(e) =>
                      mutate(fields, setFields, i, {
                        optionsText: e.target.value,
                      })
                    }
                    style={{ maxWidth: 240 }}
                  />
                  <label title="必填">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) =>
                        mutate(fields, setFields, i, {
                          required: e.target.checked,
                        })
                      }
                    />
                    必填
                  </label>
                  <button
                    className="btn btn-danger"
                    onClick={() => removeAt(fields, setFields, i)}
                  >
                    删除
                  </button>
                </div>
              ))}
              <button
                className="btn"
                onClick={() =>
                  setFields([
                    ...fields,
                    {
                      fieldKey: `field_${fields.length}`,
                      label: "",
                      fieldType: "text",
                      required: false,
                      optionsText: "",
                      placeholder: "",
                      enabled: true,
                    },
                  ])
                }
              >
                + 添加字段
              </button>
            </div>

            <div className="card">
              <h2 className="card-title">位置与人数</h2>
              <p className="card-desc">
                同一位置需要几个人就填几个，例如“打野×2”。
              </p>
              {positions.map((p, i) => (
                <div
                  key={i}
                  className="row-actions"
                  style={{ marginBottom: 8 }}
                >
                  <input
                    className="input"
                    value={p.label}
                    placeholder="位置，如 打野"
                    onChange={(e) =>
                      mutate(positions, setPositions, i, {
                        label: e.target.value,
                      })
                    }
                    style={{ maxWidth: 180 }}
                  />
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={10}
                    value={p.defaultCount}
                    onChange={(e) =>
                      mutate(positions, setPositions, i, {
                        defaultCount: Math.max(
                          1,
                          Math.min(10, Number(e.target.value) || 1),
                        ),
                      })
                    }
                    style={{ maxWidth: 80 }}
                  />
                  <button
                    className="btn btn-danger"
                    onClick={() => removeAt(positions, setPositions, i)}
                  >
                    删除
                  </button>
                </div>
              ))}
              <button
                className="btn"
                onClick={() =>
                  setPositions([
                    ...positions,
                    { label: "", defaultCount: 1, enabled: true },
                  ])
                }
              >
                + 添加位置
              </button>
            </div>

            <div className="card">
              <h2 className="card-title">段位加价（元/小时）</h2>
              {ranks.map((r, i) => (
                <div
                  key={i}
                  className="row-actions"
                  style={{ marginBottom: 8 }}
                >
                  <input
                    className="input"
                    value={r.rankLabel}
                    placeholder="段位，如 钻石"
                    onChange={(e) =>
                      mutate(ranks, setRanks, i, { rankLabel: e.target.value })
                    }
                    style={{ maxWidth: 180 }}
                  />
                  <input
                    className="input"
                    inputMode="decimal"
                    value={r.yuanText}
                    placeholder="如 20"
                    onChange={(e) =>
                      mutate(ranks, setRanks, i, { yuanText: e.target.value })
                    }
                    style={{ maxWidth: 120 }}
                  />
                  <button
                    className="btn btn-danger"
                    onClick={() => removeAt(ranks, setRanks, i)}
                  >
                    删除
                  </button>
                </div>
              ))}
              <button
                className="btn"
                onClick={() =>
                  setRanks([...ranks, { rankLabel: "", yuanText: "" }])
                }
              >
                + 添加段位
              </button>
            </div>

            <div className="card">
              <h2 className="card-title">派单群文案行</h2>
              {copies.map((c, i) => (
                <div
                  key={i}
                  className="row-actions"
                  style={{ marginBottom: 8 }}
                >
                  <input
                    className="input"
                    value={c.label}
                    placeholder="如：派单编号 / 区 / 模式"
                    onChange={(e) =>
                      mutate(copies, setCopies, i, { label: e.target.value })
                    }
                    style={{ maxWidth: 260 }}
                  />
                  <select
                    className="input"
                    value={c.valueKey}
                    onChange={(e) =>
                      mutate(copies, setCopies, i, { valueKey: e.target.value })
                    }
                    style={{ maxWidth: 200 }}
                  >
                    <option value="">自动取值</option>
                    {fields.map((f) => (
                      <option key={f.fieldKey || f.label} value={f.fieldKey}>
                        {f.label || f.fieldKey}
                      </option>
                    ))}
                    <option value="dispatchNo">派单编号</option>
                    <option value="positions">位置与人数</option>
                    <option value="duration">时长</option>
                    <option value="startAt">开始时间</option>
                    <option value="applyUrl">陪玩报名链接</option>
                    <option value="bossUrl">老板选人链接</option>
                  </select>
                  <button
                    className="btn btn-danger"
                    onClick={() => removeAt(copies, setCopies, i)}
                  >
                    删除
                  </button>
                </div>
              ))}
              <button
                className="btn"
                onClick={() =>
                  setCopies([...copies, { label: "", valueKey: "" }])
                }
              >
                + 添加工文行
              </button>
            </div>

            <div className="row-actions">
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void save()}
              >
                保存模板
              </button>
              <Link className="btn" href="/game-templates">
                返回列表
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
