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
import { TenantShell } from "../../_lib/tenant-shell";
import { formatFenYuan as yuan } from "../../_lib/money";

interface Game {
  id: string;
  name: string;
  enabled: boolean;
}
interface Region {
  id: string;
  name: string;
  enabled: boolean;
}
interface Product {
  id: string;
  gameId: string;
  gameRegionId: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  regionName: string | null;
}
interface PricingRule {
  id: string;
  serviceProductId: string;
  durationSeconds: number;
  priceFen: string;
  playerCostFen: string;
  enabled: boolean;
}

function durationLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
    : `${minutes} 分钟`;
}

function Inner() {
  const queryClient = useQueryClient();
  const [gameId, setGameId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newGame, setNewGame] = useState("");
  const [newRegion, setNewRegion] = useState("");
  const [newProduct, setNewProduct] = useState("");
  const [newProductRegion, setNewProductRegion] = useState("");
  const [ruleDuration, setRuleDuration] = useState("");
  const [rulePrice, setRulePrice] = useState("");
  const [ruleCost, setRuleCost] = useState("");

  const gamesQuery = useQuery({
    queryKey: ["catalog", "games"],
    queryFn: () => apiFetch<Game[]>("/api/v1/tenant/catalog/games"),
  });
  const regionsQuery = useQuery({
    queryKey: ["catalog", "regions", gameId],
    queryFn: () =>
      apiFetch<Region[]>(`/api/v1/tenant/catalog/regions?gameId=${gameId}`),
    enabled: gameId !== null,
  });
  const productsQuery = useQuery({
    queryKey: ["catalog", "products", gameId],
    queryFn: () =>
      apiFetch<Product[]>(`/api/v1/tenant/catalog/products?gameId=${gameId}`),
    enabled: gameId !== null,
  });
  const rulesQuery = useQuery({
    queryKey: ["catalog", "rules", productId],
    queryFn: () =>
      apiFetch<PricingRule[]>(
        `/api/v1/tenant/catalog/products/${productId}/pricing`,
      ),
    enabled: productId !== null,
  });

  const games = gamesQuery.data ?? [];
  const regions = regionsQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const rules = rulesQuery.data ?? [];
  const selectedGame = games.find((g) => g.id === gameId) ?? null;
  const selectedProduct = products.find((p) => p.id === productId) ?? null;

  const refreshCatalog = () =>
    void queryClient.invalidateQueries({ queryKey: ["catalog"] });
  const runMutation = <T,>(fn: () => Promise<T>) => {
    setMessage(null);
    return fn();
  };

  const createGame = useMutation({
    mutationFn: () =>
      runMutation(() =>
        apiFetch<Game>("/api/v1/tenant/catalog/games", {
          method: "POST",
          body: JSON.stringify({ name: newGame.trim() }),
        }),
      ),
    onSuccess: () => {
      setNewGame("");
      setNotice("已创建游戏。");
      void queryClient.invalidateQueries({ queryKey: ["catalog", "games"] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const toggleGame = useMutation({
    mutationFn: (g: Game) =>
      runMutation(() =>
        apiFetch<Game>(`/api/v1/tenant/catalog/games/${g.id}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: !g.enabled }),
        }),
      ),
    onSuccess: (_d, g) => {
      setNotice(`已${g.enabled ? "停用" : "启用"}游戏 ${g.name}。`);
      void queryClient.invalidateQueries({ queryKey: ["catalog", "games"] });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const createRegion = useMutation({
    mutationFn: () =>
      runMutation(() =>
        apiFetch<Region>(`/api/v1/tenant/catalog/games/${gameId}/regions`, {
          method: "POST",
          body: JSON.stringify({ name: newRegion.trim() }),
        }),
      ),
    onSuccess: () => {
      setNewRegion("");
      setNotice("已创建区服。");
      refreshCatalog();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const toggleRegion = useMutation({
    mutationFn: (r: Region) =>
      runMutation(() =>
        apiFetch<Region>(`/api/v1/tenant/catalog/regions/${r.id}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: !r.enabled }),
        }),
      ),
    onSuccess: () => refreshCatalog(),
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const createProduct = useMutation({
    mutationFn: () =>
      runMutation(() =>
        apiFetch<Product>("/api/v1/tenant/catalog/products", {
          method: "POST",
          body: JSON.stringify({
            gameId,
            ...(newProductRegion ? { gameRegionId: newProductRegion } : {}),
            name: newProduct.trim(),
          }),
        }),
      ),
    onSuccess: () => {
      setNewProduct("");
      setNewProductRegion("");
      setNotice("已创建服务产品。");
      refreshCatalog();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const toggleProduct = useMutation({
    mutationFn: (p: Product) =>
      runMutation(() =>
        apiFetch<Product>(`/api/v1/tenant/catalog/products/${p.id}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: !p.enabled }),
        }),
      ),
    onSuccess: () => refreshCatalog(),
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const createRule = useMutation({
    mutationFn: () =>
      runMutation(() =>
        apiFetch<PricingRule>(
          `/api/v1/tenant/catalog/products/${productId}/pricing`,
          {
            method: "POST",
            body: JSON.stringify({
              durationSeconds: Number(ruleDuration),
              priceFen: rulePrice.trim(),
              ...(ruleCost.trim() !== ""
                ? { playerCostFen: ruleCost.trim() }
                : {}),
            }),
          },
        ),
      ),
    onSuccess: () => {
      setRuleDuration("");
      setRulePrice("");
      setRuleCost("");
      refreshCatalog();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const toggleRule = useMutation({
    mutationFn: (r: PricingRule) =>
      runMutation(() =>
        apiFetch<PricingRule>(`/api/v1/tenant/catalog/pricing/${r.id}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: !r.enabled }),
        }),
      ),
    onSuccess: () => refreshCatalog(),
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const removeRule = useMutation({
    mutationFn: (r: PricingRule) =>
      runMutation(() =>
        apiFetch<unknown>(`/api/v1/tenant/catalog/pricing/${r.id}`, {
          method: "DELETE",
        }),
      ),
    onSuccess: () => refreshCatalog(),
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
  });

  const selectGame = (id: string) => {
    setGameId(id);
    setProductId(null);
  };

  if (gamesQuery.error instanceof ApiError && gamesQuery.error.status === 401) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>尚未登录门店账号</CardTitle>
          <CardDescription>请先以门店角色登录。</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/store/login">去登录</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const busy =
    createGame.isPending ||
    toggleGame.isPending ||
    createRegion.isPending ||
    toggleRegion.isPending ||
    createProduct.isPending ||
    toggleProduct.isPending ||
    createRule.isPending ||
    toggleRule.isPending ||
    removeRule.isPending;

  return (
    <div className="flex flex-col gap-6">
      {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
      {gamesQuery.isError ? (
        <p className="text-sm text-destructive">
          加载失败：
          {gamesQuery.error instanceof Error
            ? gamesQuery.error.message
            : String(gamesQuery.error)}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>游戏</CardTitle>
          <CardDescription>创建后先选游戏，再管理区服与产品。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (newGame.trim()) createGame.mutate();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="new-game">
                游戏名称
              </label>
              <Input
                id="new-game"
                className="max-w-56"
                placeholder="如 英雄联盟"
                value={newGame}
                onChange={(e) => setNewGame(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy || !newGame.trim()}>
              新建游戏
            </Button>
          </form>
          {gamesQuery.isPending ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              加载中…
            </p>
          ) : null}
          {!gamesQuery.isPending && games.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              暂无游戏，先新建一个。
            </p>
          ) : null}
          {games.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {games.map((g) => (
                  <TableRow
                    key={g.id}
                    className={gameId === g.id ? "bg-accent/40" : undefined}
                  >
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell>
                      <Badge variant={g.enabled ? "default" : "outline"}>
                        {g.enabled ? "上架" : "停用"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => selectGame(g.id)}
                        >
                          区服/产品
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={toggleGame.isPending}
                          onClick={() => toggleGame.mutate(g)}
                        >
                          {g.enabled ? "停用" : "启用"}
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

      {selectedGame ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>{selectedGame.name} · 区服</CardTitle>
                <CardDescription>区服可选；产品可绑定区服。</CardDescription>
              </div>
              <Button variant="outline" onClick={() => setGameId(null)}>
                收起
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (newRegion.trim()) createRegion.mutate();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="new-region">
                  区服名称
                </label>
                <Input
                  id="new-region"
                  className="max-w-56"
                  placeholder="如 艾欧尼亚"
                  value={newRegion}
                  onChange={(e) => setNewRegion(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={busy || !newRegion.trim()}>
                新建区服
              </Button>
            </form>
            {regions.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                暂无区服（可选）。
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>区服</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {regions.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>
                        <Badge variant={r.enabled ? "default" : "outline"}>
                          {r.enabled ? "启用" : "停用"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={toggleRegion.isPending}
                          onClick={() => toggleRegion.mutate(r)}
                        >
                          {r.enabled ? "停用" : "启用"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {selectedGame ? (
        <Card>
          <CardHeader>
            <CardTitle>服务产品</CardTitle>
            <CardDescription>
              选择产品后可维护价格（金额以“分”存储）。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (newProduct.trim()) createProduct.mutate();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="new-product">
                  产品名称
                </label>
                <Input
                  id="new-product"
                  className="max-w-64"
                  placeholder="如 王者 1 小时"
                  value={newProduct}
                  onChange={(e) => setNewProduct(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="product-region">
                  区服
                </label>
                <select
                  id="product-region"
                  className="flex h-9 w-48 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={newProductRegion}
                  onChange={(e) => setNewProductRegion(e.target.value)}
                >
                  <option value="">不限区服</option>
                  {regions
                    .filter((r) => r.enabled)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </div>
              <Button type="submit" disabled={busy || !newProduct.trim()}>
                新建产品
              </Button>
            </form>
            {products.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                暂无服务产品。
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>产品</TableHead>
                    <TableHead>区服</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <TableRow
                      key={p.id}
                      className={
                        productId === p.id ? "bg-accent/40" : undefined
                      }
                    >
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.regionName ?? "不限区服"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.enabled ? "default" : "outline"}>
                          {p.enabled ? "上架" : "停用"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setProductId(p.id)}
                          >
                            价格
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={toggleProduct.isPending}
                            onClick={() => toggleProduct.mutate(p)}
                          >
                            {p.enabled ? "停用" : "启用"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {selectedProduct ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>{selectedProduct.name} · 价格</CardTitle>
                <CardDescription>
                  单位售价/成本以分为最小单位，禁止浮点。
                </CardDescription>
              </div>
              <Button variant="outline" onClick={() => setProductId(null)}>
                收起
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  ruleDuration.trim() &&
                  Number(ruleDuration) > 0 &&
                  rulePrice.trim() &&
                  Number(rulePrice) > 0
                ) {
                  createRule.mutate();
                }
              }}
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="rule-duration">
                  时长（秒）
                </label>
                <Input
                  id="rule-duration"
                  type="number"
                  className="w-36"
                  placeholder="3600"
                  value={ruleDuration}
                  onChange={(e) => setRuleDuration(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="rule-price">
                  售价（分）
                </label>
                <Input
                  id="rule-price"
                  type="number"
                  className="w-36"
                  placeholder="200000"
                  value={rulePrice}
                  onChange={(e) => setRulePrice(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="rule-cost">
                  成本（分，可选）
                </label>
                <Input
                  id="rule-cost"
                  type="number"
                  className="w-36"
                  placeholder="100000"
                  value={ruleCost}
                  onChange={(e) => setRuleCost(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                disabled={
                  busy ||
                  !ruleDuration.trim() ||
                  Number(ruleDuration) <= 0 ||
                  !rulePrice.trim() ||
                  Number(rulePrice) <= 0
                }
              >
                新增价格
              </Button>
            </form>
            {rules.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                暂无价格规则。
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时长</TableHead>
                    <TableHead>售价</TableHead>
                    <TableHead>成本</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{durationLabel(r.durationSeconds)}</TableCell>
                      <TableCell>
                        {yuan(r.priceFen)}（{r.priceFen} 分）
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {yuan(r.playerCostFen)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.enabled ? "default" : "outline"}>
                          {r.enabled ? "启用" : "停用"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={toggleRule.isPending}
                            onClick={() => toggleRule.mutate(r)}
                          >
                            {r.enabled ? "停用" : "启用"}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={removeRule.isPending}
                            onClick={() => {
                              if (window.confirm("确认删除该价格规则？")) {
                                removeRule.mutate(r);
                              }
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
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default function CatalogPage() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <TenantShell>
      <h1 className="text-2xl font-semibold tracking-tight">服务目录</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        游戏 → 区服 → 服务产品 → 价格规则。
      </p>
      <div className="mt-6">
        <QueryClientProvider client={queryClient}>
          <Inner />
        </QueryClientProvider>
      </div>
    </TenantShell>
  );
}
