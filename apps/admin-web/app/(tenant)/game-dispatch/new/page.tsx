"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
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
import { apiFetch } from "../../../_lib/api";
import { TenantNav } from "../../../_lib/tenant-nav";

interface Customer {
  id: string;
  name: string;
}
interface Template {
  id: string;
  name: string;
  enabled: boolean;
}
interface FieldDef {
  fieldKey: string;
  label: string;
  fieldType: "text" | "select" | "multiline" | "datetime" | "duration" | "note";
  required: boolean;
  options: string[];
}
interface TemplateDetail extends Template {
  fields: FieldDef[];
  positions: Array<{ id: string; label: string; defaultCount: number }>;
}

function Inner() {
  const router = useRouter();
  const [templateId, setTemplateId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [duration, setDuration] = useState("60");
  const [message, setMessage] = useState<string | null>(null);

  const templates = useQuery({
    queryKey: ["game-templates"],
    queryFn: () => apiFetch<Template[]>("/api/v1/tenant/game-templates"),
  });
  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: () => apiFetch<Customer[]>("/api/v1/tenant/customers"),
  });
  const template = useQuery({
    queryKey: ["game-template", templateId],
    queryFn: () =>
      apiFetch<TemplateDetail>(`/api/v1/tenant/game-templates/${templateId}`),
    enabled: templateId.length > 0,
  });

  const selectTemplate = (id: string) => {
    setTemplateId(id);
    setValues({});
    setCounts({});
    setDuration("60");
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!template.data || !customerId) throw new Error("请选择模板与客户");
      const formValues: Record<string, string> = {};
      for (const f of template.data.fields) {
        if (f.fieldType === "duration") continue;
        const v = values[f.fieldKey]?.trim() ?? "";
        if (f.required && !v) throw new Error(`请填写 ${f.label}`);
        if (v) formValues[f.fieldKey] = v;
      }
      const datetimeField = template.data.fields.find(
        (f) => f.fieldType === "datetime",
      );
      const desired = values[datetimeField?.fieldKey ?? ""]?.trim();
      const lines = template.data.positions.map((p) => ({
        positionLabel: p.label,
        requiredCount: Math.max(1, counts[p.id] ?? p.defaultCount),
      }));
      if (lines.length === 0) throw new Error("模板至少需要一个位置");
      return apiFetch<{ orderId: string }>(
        "/api/v1/tenant/game-dispatch/orders",
        {
          method: "POST",
          body: JSON.stringify({
            templateId,
            customerProfileId: customerId,
            formValues,
            ...(desired
              ? { desiredStartAt: new Date(desired).toISOString() }
              : {}),
            durationMinutes: Number(duration),
            lines,
          }),
        },
      );
    },
    onSuccess: (row) => {
      setMessage("派单草稿已创建。");
      router.push(`/game-dispatch/${row.orderId}`);
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const selected = template.data;
  return (
    <div className="flex flex-col gap-6">
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
      <Card>
        <CardHeader>
          <CardTitle>新建派单</CardTitle>
          <CardDescription>
            选择游戏模板与老板客户，生成草稿后到详情页发布。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">游戏模板</label>
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={templateId}
              onChange={(e) => selectTemplate(e.target.value)}
            >
              <option value="">选择模板…</option>
              {(templates.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">老板客户</label>
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">选择客户…</option>
              {(customers.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle>{selected.name} · 下单信息</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              {selected.fields
                .filter((f) => f.fieldType !== "duration")
                .map((f) =>
                  f.fieldType === "multiline" ? (
                    <div key={f.fieldKey} className="flex flex-col gap-1">
                      <label className="text-sm font-medium">
                        {f.label}
                        {f.required ? " *" : ""}
                      </label>
                      <textarea
                        className="min-h-24 rounded-md border bg-background p-2 text-sm"
                        value={values[f.fieldKey] ?? ""}
                        onChange={(e) =>
                          setValues({ ...values, [f.fieldKey]: e.target.value })
                        }
                      />
                    </div>
                  ) : (
                    <div key={f.fieldKey} className="flex flex-col gap-1">
                      <label className="text-sm font-medium">
                        {f.label}
                        {f.required ? " *" : ""}
                      </label>
                      {f.fieldType === "select" ? (
                        <select
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={values[f.fieldKey] ?? ""}
                          onChange={(e) =>
                            setValues({
                              ...values,
                              [f.fieldKey]: e.target.value,
                            })
                          }
                        >
                          <option value="">请选择…</option>
                          {f.options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : f.fieldType === "datetime" ? (
                        <Input
                          type="datetime-local"
                          value={values[f.fieldKey] ?? ""}
                          onChange={(e) =>
                            setValues({
                              ...values,
                              [f.fieldKey]: e.target.value,
                            })
                          }
                        />
                      ) : (
                        <Input
                          value={values[f.fieldKey] ?? ""}
                          onChange={(e) =>
                            setValues({
                              ...values,
                              [f.fieldKey]: e.target.value,
                            })
                          }
                        />
                      )}
                    </div>
                  ),
                )}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">目标时长（分钟）</label>
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {selected.positions.map((p) => (
                <div key={p.id} className="flex items-center gap-3">
                  <span className="text-sm">{p.label}</span>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={counts[p.id] ?? p.defaultCount}
                    onChange={(e) =>
                      setCounts({
                        ...counts,
                        [p.id]: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                  />
                </div>
              ))}
            </div>

            <div>
              <Button
                disabled={
                  create.isPending || !customerId || Number(duration) <= 0
                }
                onClick={() => create.mutate()}
              >
                创建派单草稿
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default function NewGameDispatchPage() {
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
        <h1 className="text-2xl font-semibold tracking-tight">新建派单</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          用游戏模板生成一局派单草稿。
        </p>
        <div className="mt-6">
          <QueryClientProvider client={queryClient}>
            <Inner />
          </QueryClientProvider>
        </div>
      </div>
    </main>
  );
}
