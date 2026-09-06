"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { TenantNav } from "../../_lib/tenant-nav";
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

type PageState =
  | { phase: "loading" }
  | { phase: "unauthenticated" }
  | { phase: "error"; message: string }
  | { phase: "ready" };

export default function CatalogPage() {
  const [page, setPage] = useState<PageState>({ phase: "loading" });
  const [games, setGames] = useState<Game[]>([]);
  const [gameId, setGameId] = useState<string | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState<string | null>(null);
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [newGame, setNewGame] = useState("");
  const [newRegion, setNewRegion] = useState("");
  const [newProduct, setNewProduct] = useState("");
  const [newProductRegion, setNewProductRegion] = useState("");
  const [ruleDuration, setRuleDuration] = useState("");
  const [rulePrice, setRulePrice] = useState("");
  const [ruleCost, setRuleCost] = useState("");

  const loadGames = useCallback(async () => {
    setPage({ phase: "loading" });
    try {
      const list = await apiFetch<Game[]>("/api/v1/tenant/catalog/games");
      setGames(list);
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
  }, []);

  useEffect(() => {
    void loadGames();
  }, [loadGames]);

  const selectGame = async (id: string | null) => {
    setGameId(id);
    setProductId(null);
    setProducts([]);
    setRegions([]);
    setRules([]);
    if (!id) return;
    try {
      const [regionList, productList] = await Promise.all([
        apiFetch<Region[]>(`/api/v1/tenant/catalog/regions?gameId=${id}`),
        apiFetch<Product[]>(`/api/v1/tenant/catalog/products?gameId=${id}`),
      ]);
      setRegions(regionList);
      setProducts(productList);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const selectProduct = async (id: string | null) => {
    setProductId(id);
    setRules([]);
    if (!id) return;
    try {
      setRules(
        await apiFetch<PricingRule[]>(
          `/api/v1/tenant/catalog/products/${id}/pricing`,
        ),
      );
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const createGame = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<Game>("/api/v1/tenant/catalog/games", {
        method: "POST",
        body: JSON.stringify({ name: newGame }),
      });
      setNewGame("");
      setOkMsg("已创建游戏。");
      await loadGames();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleGame = async (g: Game) => {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<Game>(`/api/v1/tenant/catalog/games/${g.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !g.enabled }),
      });
      setOkMsg(`已${g.enabled ? "停用" : "启用"}游戏 ${g.name}。`);
      await loadGames();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const createRegion = async () => {
    if (!gameId) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<Region>(`/api/v1/tenant/catalog/games/${gameId}/regions`, {
        method: "POST",
        body: JSON.stringify({ name: newRegion }),
      });
      setNewRegion("");
      await selectGame(gameId);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleRegion = async (r: Region) => {
    if (!gameId) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<Region>(`/api/v1/tenant/catalog/regions/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !r.enabled }),
      });
      await selectGame(gameId);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const createProduct = async () => {
    if (!gameId) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<Product>("/api/v1/tenant/catalog/products", {
        method: "POST",
        body: JSON.stringify({
          gameId,
          ...(newProductRegion ? { gameRegionId: newProductRegion } : {}),
          name: newProduct,
        }),
      });
      setNewProduct("");
      setNewProductRegion("");
      setOkMsg("已创建服务产品。");
      await selectGame(gameId);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleProduct = async (p: Product) => {
    if (!gameId) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<Product>(`/api/v1/tenant/catalog/products/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !p.enabled }),
      });
      await selectGame(gameId);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const createRule = async () => {
    if (!productId) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<PricingRule>(
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
      );
      setRuleDuration("");
      setRulePrice("");
      setRuleCost("");
      await selectProduct(productId);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleRule = async (r: PricingRule) => {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<PricingRule>(`/api/v1/tenant/catalog/pricing/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !r.enabled }),
      });
      if (productId) await selectProduct(productId);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const removeRule = async (r: PricingRule) => {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch<unknown>(`/api/v1/tenant/catalog/pricing/${r.id}`, {
        method: "DELETE",
      });
      if (productId) await selectProduct(productId);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const selectedGame = games.find((g) => g.id === gameId) ?? null;
  const selectedProduct = products.find((p) => p.id === productId) ?? null;

  return (
    <main>
      <TenantNav />
      <div className="page">
        <h1 className="page-title">服务目录</h1>
        <p className="page-desc">
          游戏 → 区服 → 服务产品 → 价格（金额以“分”存储，禁止浮点/负价）。
        </p>
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
              <h2 className="card-title">游戏</h2>
              <div className="row-actions" style={{ marginBottom: 12 }}>
                <input
                  className="input"
                  placeholder="游戏名"
                  value={newGame}
                  onChange={(e) => setNewGame(e.target.value)}
                  style={{ maxWidth: 220 }}
                />
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void createGame()}
                >
                  新建游戏
                </button>
              </div>
              {games.length === 0 ? (
                <p className="muted">暂无游戏，先新建一个。</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {games.map((g) => (
                      <tr
                        key={g.id}
                        className={gameId === g.id ? "row-selected" : ""}
                      >
                        <td>{g.name}</td>
                        <td>
                          <span
                            className={
                              g.enabled
                                ? "badge badge-active"
                                : "badge badge-inactive"
                            }
                          >
                            {g.enabled ? "上架" : "停用"}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="btn"
                              onClick={() => void selectGame(g.id)}
                            >
                              区服/产品
                            </button>
                            <button
                              className="btn"
                              disabled={busy}
                              onClick={() => void toggleGame(g)}
                            >
                              {g.enabled ? "停用" : "启用"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {selectedGame ? (
              <>
                <div className="card">
                  <div
                    className="row-actions"
                    style={{ justifyContent: "space-between" }}
                  >
                    <h2 className="card-title">{selectedGame.name} · 区服</h2>
                    <button
                      className="btn"
                      onClick={() => void selectGame(null)}
                    >
                      收起
                    </button>
                  </div>
                  <div className="row-actions" style={{ marginBottom: 12 }}>
                    <input
                      className="input"
                      placeholder="区服名"
                      value={newRegion}
                      onChange={(e) => setNewRegion(e.target.value)}
                      style={{ maxWidth: 220 }}
                    />
                    <button
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void createRegion()}
                    >
                      新建区服
                    </button>
                  </div>
                  {regions.length === 0 ? (
                    <p className="muted">暂无区服（可选）。</p>
                  ) : (
                    <table className="data-table">
                      <tbody>
                        {regions.map((r) => (
                          <tr key={r.id}>
                            <td>{r.name}</td>
                            <td>
                              <span
                                className={
                                  r.enabled
                                    ? "badge badge-active"
                                    : "badge badge-inactive"
                                }
                              >
                                {r.enabled ? "启用" : "停用"}
                              </span>
                            </td>
                            <td>
                              <button
                                className="btn"
                                disabled={busy}
                                onClick={() => void toggleRegion(r)}
                              >
                                {r.enabled ? "停用" : "启用"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="card">
                  <h2 className="card-title">服务产品与价格</h2>
                  <div className="row-actions" style={{ marginBottom: 12 }}>
                    <input
                      className="input"
                      placeholder="产品名（如 王者1小时）"
                      value={newProduct}
                      onChange={(e) => setNewProduct(e.target.value)}
                      style={{ maxWidth: 240 }}
                    />
                    <select
                      className="input"
                      value={newProductRegion}
                      onChange={(e) => setNewProductRegion(e.target.value)}
                      style={{ maxWidth: 180 }}
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
                    <button
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void createProduct()}
                    >
                      新建产品
                    </button>
                  </div>
                  {products.length === 0 ? (
                    <p className="muted">暂无服务产品。</p>
                  ) : (
                    <table className="data-table">
                      <tbody>
                        {products.map((p) => (
                          <tr
                            key={p.id}
                            className={productId === p.id ? "row-selected" : ""}
                          >
                            <td>{p.name}</td>
                            <td className="muted">
                              {p.regionName ?? "不限区服"}
                            </td>
                            <td>
                              <span
                                className={
                                  p.enabled
                                    ? "badge badge-active"
                                    : "badge badge-inactive"
                                }
                              >
                                {p.enabled ? "上架" : "停用"}
                              </span>
                            </td>
                            <td>
                              <div className="row-actions">
                                <button
                                  className="btn"
                                  onClick={() => void selectProduct(p.id)}
                                >
                                  价格
                                </button>
                                <button
                                  className="btn"
                                  disabled={busy}
                                  onClick={() => void toggleProduct(p)}
                                >
                                  {p.enabled ? "停用" : "启用"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            ) : null}

            {selectedProduct ? (
              <div className="card">
                <div
                  className="row-actions"
                  style={{ justifyContent: "space-between" }}
                >
                  <h2 className="card-title">
                    {selectedProduct.name} · 价格（分）
                  </h2>
                  <button
                    className="btn"
                    onClick={() => void selectProduct(null)}
                  >
                    收起
                  </button>
                </div>
                <div className="row-actions" style={{ marginBottom: 12 }}>
                  <input
                    className="input"
                    type="number"
                    placeholder="时长(秒)"
                    value={ruleDuration}
                    onChange={(e) => setRuleDuration(e.target.value)}
                    style={{ maxWidth: 140 }}
                  />
                  <input
                    className="input"
                    type="number"
                    placeholder="售价(分)"
                    value={rulePrice}
                    onChange={(e) => setRulePrice(e.target.value)}
                    style={{ maxWidth: 140 }}
                  />
                  <input
                    className="input"
                    type="number"
                    placeholder="成本(分,可选)"
                    value={ruleCost}
                    onChange={(e) => setRuleCost(e.target.value)}
                    style={{ maxWidth: 140 }}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void createRule()}
                  >
                    新增价格
                  </button>
                </div>
                {rules.length === 0 ? (
                  <p className="muted">暂无价格规则。</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>时长</th>
                        <th>售价</th>
                        <th>成本</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map((r) => (
                        <tr key={r.id}>
                          <td>{Math.floor(r.durationSeconds / 60)} 分钟</td>
                          <td>
                            {yuan(r.priceFen)}（{r.priceFen}分）
                          </td>
                          <td className="muted">{yuan(r.playerCostFen)}</td>
                          <td>
                            <span
                              className={
                                r.enabled
                                  ? "badge badge-active"
                                  : "badge badge-inactive"
                              }
                            >
                              {r.enabled ? "启用" : "停用"}
                            </span>
                          </td>
                          <td>
                            <div className="row-actions">
                              <button
                                className="btn"
                                disabled={busy}
                                onClick={() => void toggleRule(r)}
                              >
                                {r.enabled ? "停用" : "启用"}
                              </button>
                              <button
                                className="btn btn-danger"
                                disabled={busy}
                                onClick={() => void removeRule(r)}
                              >
                                删除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
