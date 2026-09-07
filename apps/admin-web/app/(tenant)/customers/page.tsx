"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
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

interface Customer {
  id: string;
  name: string;
  mobile: string | null;
  remark: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
}

function CustomerListInner() {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [remark, setRemark] = useState("");

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["customers"],
    queryFn: () => apiFetch<Customer[]>("/api/v1/tenant/customers"),
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch<Customer>("/api/v1/tenant/customers", {
        method: "POST",
        body: JSON.stringify({
          name,
          ...(mobile ? { mobile } : {}),
          ...(remark ? { remark } : {}),
        }),
      }),
    onSuccess: () => {
      setName("");
      setMobile("");
      setRemark("");
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  const rows = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.mobile ?? "").toLowerCase().includes(q),
    );
  }, [data, keyword]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>新建客户</CardTitle>
          <CardDescription>
            样板页：TanStack Query + shadcn/ui + Tailwind token
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Input
              placeholder="姓名 *"
              value={name}
              required
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              placeholder="手机（可选）"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
            />
            <Input
              placeholder="备注（可选）"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "创建中…" : "新建"}
            </Button>
          </form>
          {create.isError ? (
            <p className="mt-3 text-sm text-destructive">
              创建失败：
              {create.error instanceof Error
                ? create.error.message
                : String(create.error)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>客户列表（{rows.length}）</CardTitle>
            <CardDescription>
              支持本地关键字筛选；数据由 TanStack Query 缓存
            </CardDescription>
          </div>
          <Input
            className="max-w-60"
            placeholder="筛选姓名/手机"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </CardHeader>
        <CardContent>
          {isPending ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              加载中…
            </p>
          ) : null}
          {isError ? (
            <div className="py-6 text-center">
              {error instanceof ApiError && error.status === 401 ? (
                <Link className="font-medium text-primary" href="/store/login">
                  尚未登录，去登录
                </Link>
              ) : (
                <p className="text-sm text-destructive">
                  加载失败：
                  {error instanceof Error ? error.message : String(error)}
                </p>
              )}
            </div>
          ) : null}
          {!isPending && !isError && rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              暂无客户。
            </p>
          ) : null}
          {!isPending && !isError && rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>手机</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.mobile ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.remark ?? "-"}
                    </TableCell>
                    <TableCell>
                      {c.status === "ACTIVE" ? (
                        <Badge variant="default">正常</Badge>
                      ) : (
                        <Badge variant="outline">已停用</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(c.createdAt).toLocaleString()}
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

export default function CustomersPage() {
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
        <h1 className="text-2xl font-semibold tracking-tight">客户</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tailwind/shadcn/TanStack Query 样板页（原其它页面样式不受影响）
        </p>
        <div className="mt-6">
          <QueryClientProvider client={queryClient}>
            <CustomerListInner />
          </QueryClientProvider>
        </div>
      </div>
    </main>
  );
}
