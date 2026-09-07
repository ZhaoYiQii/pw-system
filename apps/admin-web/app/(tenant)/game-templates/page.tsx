"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, apiFetch } from "../../_lib/api";
import { TenantNav } from "../../_lib/tenant-nav";

interface TemplateRow {
  id: string;
  name: string;
  enabled: boolean;
  updatedAt: string;
}

function Inner() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const {
    data,
    isPending,
    isError,
    error: queryError,
  } = useQuery({
    queryKey: ["game-templates"],
    queryFn: () => apiFetch<TemplateRow[]>("/api/v1/tenant/game-templates"),
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>("/api/v1/tenant/game-templates", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim() }),
      }),
    onSuccess: (row) => {
      setNotice("模板已创建，请补充字段与价目。");
      setNewName("");
      router.push(`/game-templates/${row.id}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const copy = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string }>(`/api/v1/tenant/game-templates/${id}/copy`, {
        method: "POST",
      }),
    onSuccess: (row) => {
      setNotice("已复制为新模板。");
      void queryClient.invalidateQueries({ queryKey: ["game-templates"] });
      router.push(`/game-templates/${row.id}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/api/v1/tenant/game-templates/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      setNotice("模板已删除。");
      void queryClient.invalidateQueries({ queryKey: ["game-templates"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  if (isError) {
    return queryError instanceof ApiError && queryError.status === 401 ? (
      <Button asChild variant="outline">
        <Link href="/store/login">去登录</Link>
      </Button>
    ) : (
      <p className="text-sm text-destructive">
        加载失败：
        {queryError instanceof Error ? queryError.message : String(queryError)}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}
      <Card>
        <CardHeader>
          <CardTitle>新建游戏模板</CardTitle>
          <CardDescription>例如：英雄联盟 / 王者荣耀。</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) create.mutate();
            }}
          >
            <Input
              className="max-w-72"
              placeholder="游戏模板名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button
              type="submit"
              disabled={create.isPending || !newName.trim()}
            >
              创建并配置
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>模板列表（{data?.length ?? 0}）</CardTitle>
          <CardDescription>不同游戏配置不同表单与价目。</CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              加载中…
            </p>
          ) : null}
          {!isPending && data?.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              暂无模板。
            </p>
          ) : null}
          {data && data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.enabled ? "启用" : "停用"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/game-templates/${row.id}`}>编辑</Link>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={copy.isPending}
                          onClick={() => copy.mutate(row.id)}
                        >
                          复制
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `确认删除模板「${row.name}」？已发布派单不受影响。`,
                              )
                            )
                              remove.mutate(row.id);
                          }}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default function GameTemplatesPage() {
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
      <div className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">陪玩模板</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          每个游戏一套模板：下单字段、位置人数、段位加价与派单文案。
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
