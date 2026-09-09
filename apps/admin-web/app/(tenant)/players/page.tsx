"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
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
import { fenToYuanText, yuanToFenString } from "../../_lib/money";
import { TenantNav } from "../../_lib/tenant-nav";

interface Player {
  id: string;
  name: string;
  mobile: string | null;
  status: "ACTIVE" | "INACTIVE";
  acceptingOrders: boolean;
  basePricePerHourFen: string;
}
interface Game {
  id: string;
  name: string;
  enabled: boolean;
}
interface Skill {
  id: string;
  gameName: string;
  title: string | null;
}
interface Availability {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}
interface PlayerDetail extends Player {
  skills: Skill[];
  availability: Availability[];
}
interface PlayerEarningRecord {
  id: string;
  source: "LEGACY" | "SLOT";
  amountFen: string;
  status: string;
  orderId: string;
  orderNo: string;
  createdAt: string;
}
interface PlayerAccount {
  id: string;
  name: string;
  finance: {
    paidFen: string;
    unpaidFen: string;
    records: PlayerEarningRecord[];
  };
}

function Inner() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newMobile, setNewMobile] = useState("");
  const [baseYuan, setBaseYuan] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [skillGameId, setSkillGameId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const players = useQuery({
    queryKey: ["players"],
    queryFn: () => apiFetch<Player[]>("/api/v1/tenant/players"),
  });
  const games = useQuery({
    queryKey: ["catalog-games"],
    queryFn: () => apiFetch<Game[]>("/api/v1/tenant/catalog/games"),
  });
  const detail = useQuery({
    queryKey: ["player-detail", selectedId],
    queryFn: () =>
      apiFetch<PlayerDetail>(`/api/v1/tenant/players/${selectedId as string}`),
    enabled: selectedId !== null,
  });
  const account = useQuery({
    queryKey: ["player-account", selectedId],
    queryFn: () =>
      apiFetch<PlayerAccount>(
        `/api/v1/tenant/players/${selectedId as string}/account`,
      ),
    enabled: selectedId !== null,
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["players"] });
    void queryClient.invalidateQueries({ queryKey: ["player-detail"] });
  };

  const create = useMutation({
    mutationFn: () => {
      const baseFen = yuanToFenString(baseYuan);
      if (!newName.trim() || baseFen === null) {
        setMessage("请填写姓名和合法的非负小时价");
        throw new Error("invalid input");
      }
      return apiFetch<Player>("/api/v1/tenant/players", {
        method: "POST",
        body: JSON.stringify({
          name: newName,
          mobile: newMobile || undefined,
          basePricePerHourFen: baseFen,
        }),
      });
    },
    onSuccess: () => {
      setNewName("");
      setNewMobile("");
      setBaseYuan("");
      setMessage("已创建陪玩。");
      refreshAll();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const toggle = useMutation({
    mutationFn: (p: Player) =>
      apiFetch<Player>(`/api/v1/tenant/players/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ acceptingOrders: !p.acceptingOrders }),
      }),
    onSuccess: refreshAll,
  });

  const remove = useMutation({
    mutationFn: (p: Player) =>
      apiFetch<unknown>(`/api/v1/tenant/players/${p.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setSelectedId(null);
      refreshAll();
    },
  });

  const addSkill = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(
        `/api/v1/tenant/players/${selectedId as string}/skills`,
        {
          method: "POST",
          body: JSON.stringify({ gameId: skillGameId }),
        },
      ),
    onSuccess: () => {
      setSkillGameId("");
      refreshAll();
    },
  });

  const removeSkill = useMutation({
    mutationFn: (skillId: string) =>
      apiFetch<unknown>(
        `/api/v1/tenant/players/${selectedId as string}/skills/${skillId}`,
        { method: "DELETE" },
      ),
    onSuccess: refreshAll,
  });

  const addAvailability = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(
        `/api/v1/tenant/players/${selectedId as string}/availability`,
        {
          method: "POST",
          body: JSON.stringify({
            startsAt: new Date(from).toISOString(),
            endsAt: new Date(to).toISOString(),
            ...(reason ? { reason } : {}),
          }),
        },
      ),
    onSuccess: () => {
      setFrom("");
      setTo("");
      setReason("");
      refreshAll();
    },
  });

  const removeAvailability = useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(
        `/api/v1/tenant/players/${selectedId as string}/availability/${id}`,
        { method: "DELETE" },
      ),
    onSuccess: refreshAll,
  });

  if (players.isError || games.isError) {
    const e = players.error ?? games.error;
    return e instanceof ApiError && e.status === 401 ? (
      <Button asChild variant="outline">
        <Link href="/store/login">去登录</Link>
      </Button>
    ) : (
      <p className="text-sm text-destructive">
        加载失败：{e instanceof Error ? e.message : String(e)}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
      <Card>
        <CardHeader>
          <CardTitle>新建陪玩</CardTitle>
          <CardDescription>基础小时价为店铺陪玩默认报价。</CardDescription>
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
              required
              placeholder="姓名 *"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Input
              placeholder="手机（可选）"
              value={newMobile}
              onChange={(e) => setNewMobile(e.target.value)}
            />
            <Input
              required
              inputMode="decimal"
              placeholder="基础小时价(元)"
              value={baseYuan}
              onChange={(e) => setBaseYuan(e.target.value)}
            />
            <Button type="submit" disabled={create.isPending}>
              新建
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>陪玩列表（{players.data?.length ?? 0}）</CardTitle>
        </CardHeader>
        <CardContent>
          {players.isPending ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              加载中…
            </p>
          ) : null}
          {players.data && players.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>手机</TableHead>
                  <TableHead>小时价</TableHead>
                  <TableHead>接单</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {players.data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.mobile ?? "-"}</TableCell>
                    <TableCell>
                      {fenToYuanText(p.basePricePerHourFen)} 元/小时
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={p.acceptingOrders ? "default" : "outline"}
                      >
                        {p.acceptingOrders ? "接单中" : "暂停"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedId(p.id)}
                        >
                          {selectedId === p.id ? "刷新" : "详情"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggle.mutate(p)}
                        >
                          {p.acceptingOrders ? "暂停接单" : "恢复接单"}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            if (window.confirm(`确认删除陪玩「${p.name}」？`))
                              remove.mutate(p);
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

      {selectedId && detail.data ? (
        <Card>
          <CardHeader>
            <CardTitle>{detail.data.name} · 详情</CardTitle>
            <CardDescription>维护游戏技能与不可接单时间。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <section>
              <h3 className="mb-2 text-sm font-semibold">技能</h3>
              {detail.data.skills.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无技能。</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {detail.data.skills.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between"
                    >
                      <span>{s.gameName}</span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => removeSkill.mutate(s.id)}
                      >
                        移除
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={skillGameId}
                  onChange={(e) => setSkillGameId(e.target.value)}
                >
                  <option value="">选择游戏…</option>
                  {(games.data ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <Button
                  disabled={!skillGameId}
                  onClick={() => addSkill.mutate()}
                >
                  添加技能
                </Button>
              </div>
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">不可接单时间</h3>
              {detail.data.availability.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无设置。</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {detail.data.availability.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between"
                    >
                      <span>
                        {new Date(a.startsAt).toLocaleString()} →{" "}
                        {new Date(a.endsAt).toLocaleString()}
                      </span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => removeAvailability.mutate(a.id)}
                      >
                        删除
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <Input
                  type="datetime-local"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
                <Input
                  type="datetime-local"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
                <Input
                  placeholder="原因（可选）"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button
                  disabled={!from || !to}
                  onClick={() => addAvailability.mutate()}
                >
                  添加
                </Button>
              </div>
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">收入与结算</h3>
              {account.isPending ? (
                <p className="text-sm text-muted-foreground">加载中…</p>
              ) : null}
              {!account.isPending && account.data ? (
                <div className="flex flex-col gap-3">
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <p>
                      已付{" "}
                      <b className="font-mono">
                        {fenToYuanText(account.data.finance.paidFen)} 元
                      </b>
                    </p>
                    <p>
                      待付/未入账{" "}
                      <b className="font-mono">
                        {fenToYuanText(account.data.finance.unpaidFen)} 元
                      </b>
                    </p>
                  </div>
                  {account.data.finance.records.length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂无收入记录。</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>来源</TableHead>
                          <TableHead>订单</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead className="text-right">金额</TableHead>
                          <TableHead>时间</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {account.data.finance.records.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell>
                              <Badge variant="outline">
                                {r.source === "SLOT" ? "GD 档位" : "CLASSIC"}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {r.orderNo}
                            </TableCell>
                            <TableCell>{r.status}</TableCell>
                            <TableCell className="text-right font-medium">
                              {fenToYuanText(r.amountFen)} 元
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {new Date(r.createdAt).toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              ) : null}
              {!account.isPending && !account.data ? (
                <p className="text-sm text-muted-foreground">
                  收入数据加载失败，请刷新。
                </p>
              ) : null}
            </section>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default function PlayersPage() {
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
        <h1 className="text-2xl font-semibold tracking-tight">陪玩</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          陪玩档案、基础小时价、技能与不可接单时间。
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
