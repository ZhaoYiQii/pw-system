"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  name: string;
  enabled: boolean;
  fields: Array<{
    fieldKey: string;
    label: string;
    fieldType: FieldType;
    required: boolean;
    options: string[];
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

function Inner({ templateId }: { templateId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [fields, setFields] = useState<FieldDraft[]>([]);
  const [positions, setPositions] = useState<PositionDraft[]>([]);
  const [ranks, setRanks] = useState<RankDraft[]>([]);
  const [copies, setCopies] = useState<CopyDraft[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["game-template", templateId],
    queryFn: () =>
      apiFetch<TemplatePayload>(`/api/v1/tenant/game-templates/${templateId}`),
  });

  if (query.isSuccess && name === "" && query.data) {
    const data = query.data;
    setName(data.name);
    setEnabled(data.enabled);
    setFields(
      data.fields.map((f) => ({
        fieldKey: f.fieldKey,
        label: f.label,
        fieldType: f.fieldType,
        required: f.required,
        optionsText: f.options.join("，"),
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
  }

  const save = useMutation({
    mutationFn: () => {
      const fieldPayload = fields.map((f, index) => ({
        fieldKey: f.fieldKey.trim() || `field_${index}`,
        label: f.label.trim() || "未命名字段",
        fieldType: f.fieldType,
        required: f.required,
        options: f.optionsText
          .split(/[,，\n]/)
          .map((o) => o.trim())
          .filter(Boolean),
        placeholder: null,
        sortOrder: index,
        enabled: f.enabled,
      }));
      const positionPayload = positions.map((p, index) => ({
        label: p.label.trim(),
        defaultCount: p.defaultCount,
        enabled: p.enabled,
        sortOrder: index,
      }));
      const rankPayload = ranks.map((r, index) => ({
        rankLabel: r.rankLabel.trim(),
        addPriceFen: yuanToFenString(r.yuanText) as string,
        sortOrder: index,
      }));
      const copyPayload = copies.map((c) => ({
        label: c.label.trim(),
        valueKey: c.valueKey.trim() || null,
      }));
      return apiFetch<unknown>(`/api/v1/tenant/game-templates/${templateId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          enabled,
          fields: fieldPayload,
          positions: positionPayload,
          rankRules: rankPayload,
          copyLines: copyPayload,
        }),
      });
    },
    onSuccess: () => {
      setMessage("模板已保存。");
      void queryClient.invalidateQueries({ queryKey: ["game-templates"] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const setAt = <T,>(
    list: T[],
    setList: (v: T[]) => void,
    index: number,
    patch: Partial<T>,
  ) =>
    setList(
      list.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );

  const addField = () =>
    setFields([
      ...fields,
      {
        fieldKey: `field_${fields.length}`,
        label: "",
        fieldType: "text",
        required: false,
        optionsText: "",
        enabled: true,
      },
    ]);
  const addPosition = () =>
    setPositions([...positions, { label: "", defaultCount: 1, enabled: true }]);
  const addRank = () => setRanks([...ranks, { rankLabel: "", yuanText: "" }]);
  const addCopy = () => setCopies([...copies, { label: "", valueKey: "" }]);

  if (query.isError) {
    return query.error instanceof ApiError && query.error.status === 401 ? (
      <Button asChild variant="outline">
        <Link href="/store/login">去登录</Link>
      </Button>
    ) : (
      <p className="text-sm text-destructive">
        加载失败：
        {query.error instanceof Error
          ? query.error.message
          : String(query.error)}
      </p>
    );
  }
  if (query.isPending || name === "") {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
    );
  }

  const sectionHeader = (title: string, desc: string) => (
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{desc}</CardDescription>
    </CardHeader>
  );

  return (
    <div className="flex flex-col gap-6">
      {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
      <Card>
        {sectionHeader(
          "模板基本信息",
          "保存后新派单使用；已发布派单不受影响。",
        )}
        <CardContent className="flex flex-wrap items-center gap-3">
          <Input
            className="max-w-72"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            启用模板
          </label>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !name.trim()}
          >
            保存
          </Button>
          <Button asChild variant="ghost">
            <Link href="/game-templates">返回列表</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        {sectionHeader("下单字段", "例如“区 / 目标段位 / 模式 / 补充需求”。")}
        <CardContent className="flex flex-col gap-3">
          {fields.map((f, i) => (
            <div
              key={i}
              className="grid gap-2 sm:grid-cols-[1fr_1fr_120px_160px_auto]"
            >
              <Input
                placeholder="名称"
                value={f.label}
                onChange={(e) =>
                  setAt(fields, setFields, i, { label: e.target.value })
                }
              />
              <Input
                placeholder="字段标识"
                value={f.fieldKey}
                onChange={(e) =>
                  setAt(fields, setFields, i, { fieldKey: e.target.value })
                }
              />
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={f.fieldType}
                onChange={(e) =>
                  setAt(fields, setFields, i, {
                    fieldType: e.target.value as FieldType,
                  })
                }
              >
                <option value="text">文本</option>
                <option value="select">下拉</option>
                <option value="multiline">多行</option>
                <option value="datetime">时间</option>
                <option value="duration">时长</option>
                <option value="note">备注</option>
              </select>
              <Input
                placeholder="下拉选项，逗号分隔"
                value={f.optionsText}
                onChange={(e) =>
                  setAt(fields, setFields, i, { optionsText: e.target.value })
                }
              />
              <div className="flex items-center gap-2">
                <label className="text-sm">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) =>
                      setAt(fields, setFields, i, {
                        required: e.target.checked,
                      })
                    }
                  />{" "}
                  必填
                </label>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setFields(fields.filter((_, x) => x !== i))}
                >
                  删
                </Button>
              </div>
            </div>
          ))}
          <Button variant="outline" onClick={addField}>
            + 添加字段
          </Button>
        </CardContent>
      </Card>

      <Card>
        {sectionHeader("位置与人数", "同一位置可配置多个名额，例如 打野×2。")}
        <CardContent className="flex flex-col gap-3">
          {positions.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-3">
              <Input
                className="max-w-48"
                placeholder="位置"
                value={p.label}
                onChange={(e) =>
                  setAt(positions, setPositions, i, { label: e.target.value })
                }
              />
              <Input
                className="max-w-24"
                type="number"
                min={1}
                max={10}
                value={p.defaultCount}
                onChange={(e) =>
                  setAt(positions, setPositions, i, {
                    defaultCount: Math.max(1, Number(e.target.value) || 1),
                  })
                }
              />
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  setPositions(positions.filter((_, x) => x !== i))
                }
              >
                删
              </Button>
            </div>
          ))}
          <Button variant="outline" onClick={addPosition}>
            + 添加位置
          </Button>
        </CardContent>
      </Card>

      <Card>
        {sectionHeader(
          "段位加价（元/小时）",
          "实际单价 = 陪玩基础小时价 + 段位加价。",
        )}
        <CardContent className="flex flex-col gap-3">
          {ranks.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-3">
              <Input
                className="max-w-48"
                placeholder="段位"
                value={r.rankLabel}
                onChange={(e) =>
                  setAt(ranks, setRanks, i, { rankLabel: e.target.value })
                }
              />
              <Input
                className="max-w-32"
                placeholder="如 20"
                value={r.yuanText}
                onChange={(e) =>
                  setAt(ranks, setRanks, i, { yuanText: e.target.value })
                }
              />
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setRanks(ranks.filter((_, x) => x !== i))}
              >
                删
              </Button>
            </div>
          ))}
          <Button variant="outline" onClick={addRank}>
            + 添加段位
          </Button>
        </CardContent>
      </Card>

      <Card>
        {sectionHeader("派单群文案行", "决定复制到陪玩群的文案顺序。")}
        <CardContent className="flex flex-col gap-3">
          {copies.map((c, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_200px_auto]">
              <Input
                placeholder="如：派单编号 / 区 / 模式"
                value={c.label}
                onChange={(e) =>
                  setAt(copies, setCopies, i, { label: e.target.value })
                }
              />
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={c.valueKey}
                onChange={(e) =>
                  setAt(copies, setCopies, i, { valueKey: e.target.value })
                }
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
                <option value="applyUrl">报名链接</option>
                <option value="bossUrl">选人链接</option>
              </select>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setCopies(copies.filter((_, x) => x !== i))}
              >
                删
              </Button>
            </div>
          ))}
          <Button variant="outline" onClick={addCopy}>
            + 添加工文行
          </Button>
        </CardContent>
      </Card>

      <div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          保存模板
        </Button>
      </div>
    </div>
  );
}

export default function GameTemplateEditorPage() {
  const params = useParams<{ id: string }>();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <main className="min-h-screen bg-[#f4f5f7]">
      <TenantNav />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">编辑陪玩模板</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          配置下单字段、位置人数、段位加价与派单文案。
        </p>
        <div className="mt-6">
          <QueryClientProvider client={queryClient}>
            <Inner templateId={params.id} />
          </QueryClientProvider>
        </div>
      </div>
    </main>
  );
}
