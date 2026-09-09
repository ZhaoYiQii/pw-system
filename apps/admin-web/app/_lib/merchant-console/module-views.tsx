"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Download, Search, UserPlus } from "lucide-react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "../api";
import {
  formatFenYuan,
  yuanToFenString,
} from "../money";
import { DemoEmptyState } from "./demo-ui";
import {
  type AuditRow,
  type CatalogGame,
  type CatalogProduct,
  type CustomerRow,
  type DisputeRow,
  type FinanceLedger,
  type PendingEarning,
  type PlayerRow,
  type PricingRule,
  type SettlementBatchRow,
  type SessionRow,
  dateTime,
  formatDuration,
  statusLabel,
  toneFor,
} from "./merchant-api";

export function ModuleHeader({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="mc-pagehead">
      <div>
        <div className="mc-kicker">{kicker}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children ? <div className="mc-button-row">{children}</div> : null}
    </div>
  );
}

export function Badge({ status }: { status: string }) {
  return <span className={`mc-status st-${toneFor(status)}`}>{statusLabel(status)}</span>;
}

function useSearch<T>(rows: T[], fields: (row: T) => string[]) {
  const [query, setQuery] = useState("");
  const result = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) =>
      fields(row).some((value) => value.toLowerCase().includes(keyword)),
    );
  }, [rows, query, fields]);
  return { query, setQuery, rows: result };
}

// ---------------------------------------------------------------- customers
export function CustomersModuleView() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [remark, setRemark] = useState("");
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["merchant", "customers"],
    queryFn: () => apiFetch<CustomerRow[]>("/api/v1/tenant/customers"),
  });
  const create = useMutation({
    mutationFn: () =>
      apiFetch<CustomerRow>("/api/v1/tenant/customers", {
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
      void queryClient.invalidateQueries({ queryKey: ["merchant", "customers"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const search = useSearch(query.data ?? [], (row) => [
    row.name,
    row.mobile ?? "",
  ]);
  return (
    <div>
      <ModuleHeader kicker="RECORDS / CUSTOMERS" title="客户档案" description="真实客户档案与账户余额入口。">
        <Link href="/merchant-console/finance" className="mc-btn">
          收入账本
        </Link>
      </ModuleHeader>
      {error ? <div className="mc-notice">{error}</div> : null}
      <section className="mc-panel mc-form-panel">
        <div className="mc-section-head">
          <div>
            <h2>新建客户</h2>
            <p>为门店档案新增客户，可后续绑定老板账号。</p>
          </div>
        </div>
        <div className="mc-form-grid">
          <input
            className="mc-input"
            placeholder="姓名 *"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="mc-input"
            placeholder="手机（可选）"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
          />
          <input
            className="mc-input"
            placeholder="备注（可选）"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
          <button
            type="button"
            className="mc-btn mc-btn-primary"
            disabled={create.isPending || !name.trim()}
            onClick={() => create.mutate()}
          >
            <UserPlus size={15} /> 新建
          </button>
        </div>
      </section>

      <section className="mc-panel">
        <div className="mc-filterbar">
          <label className="mc-searchbox">
            <Search size={15} aria-hidden="true" />
            <input
              value={search.query}
              onChange={(e) => search.setQuery(e.target.value)}
              placeholder="搜索客户姓名/手机"
              aria-label="搜索客户"
            />
          </label>
          <span className="mc-muted-text">共 {search.rows.length} 条</span>
        </div>
        {search.rows.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>手机</th>
                  <th>备注</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {search.rows.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <b className="mc-cell-title">{customer.name}</b>
                    </td>
                    <td>{customer.mobile ?? "-"}</td>
                    <td>{customer.remark ?? "-"}</td>
                    <td><Badge status={customer.status} /></td>
                    <td>{dateTime(customer.createdAt)}</td>
                    <td>
                      <Link
                        href={`/merchant-console/customers/${customer.id}`}
                        className="mc-btn mc-btn-ghost mc-btn-small"
                      >
                        详情
                        <ArrowRight size={13} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <DemoEmptyState title="暂无客户" description="先新建客户档案。" />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- players
export function PlayersModuleView() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [priceYuan, setPriceYuan] = useState("");
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["merchant", "players"],
    queryFn: () => apiFetch<PlayerRow[]>("/api/v1/tenant/players"),
  });
  const create = useMutation({
    mutationFn: () => {
      const baseFen = yuanToFenString(priceYuan);
      if (!name.trim() || baseFen === null) {
        setError("请填写姓名和合法的非负小时价");
        throw new Error("invalid");
      }
      return apiFetch<PlayerRow>("/api/v1/tenant/players", {
        method: "POST",
        body: JSON.stringify({
          name,
          mobile: mobile || undefined,
          basePricePerHourFen: baseFen,
        }),
      });
    },
    onSuccess: () => {
      setName("");
      setMobile("");
      setPriceYuan("");
      void queryClient.invalidateQueries({ queryKey: ["merchant", "players"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const search = useSearch(query.data ?? [], (row) => [
    row.name,
    row.mobile ?? "",
  ]);
  return (
    <div>
      <ModuleHeader kicker="RECORDS / PLAYERS" title="陪玩档案" description="陪玩资料、接单状态与结算信息。">
        <Link href="/merchant-console/settlements" className="mc-btn">
          结算批次
        </Link>
      </ModuleHeader>
      {error ? <div className="mc-notice">{error}</div> : null}
      <section className="mc-panel mc-form-panel">
        <div className="mc-section-head">
          <div>
            <h2>新建陪玩</h2>
            <p>基础小时价为店铺陪玩默认报价。</p>
          </div>
        </div>
        <div className="mc-form-grid">
          <input className="mc-input" placeholder="姓名 *" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="mc-input" placeholder="手机（可选）" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          <input className="mc-input" placeholder="基础小时价(元)" inputMode="decimal" value={priceYuan} onChange={(e) => setPriceYuan(e.target.value)} />
          <button type="button" className="mc-btn mc-btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>
            <UserPlus size={15} /> 新建
          </button>
        </div>
      </section>
      <section className="mc-panel">
        <div className="mc-filterbar">
          <label className="mc-searchbox">
            <Search size={15} aria-hidden="true" />
            <input value={search.query} onChange={(e) => search.setQuery(e.target.value)} placeholder="搜索陪玩姓名/手机" aria-label="搜索陪玩" />
          </label>
          <span className="mc-muted-text">共 {search.rows.length} 条</span>
        </div>
        {search.rows.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead>
                <tr><th>姓名</th><th>手机</th><th>状态</th><th>接单</th><th>小时价</th><th>操作</th></tr>
              </thead>
              <tbody>
                {search.rows.map((player) => (
                  <tr key={player.id}>
                    <td><b className="mc-cell-title">{player.name}</b></td>
                    <td>{player.mobile ?? "-"}</td>
                    <td><Badge status={player.status} /></td>
                    <td>{player.acceptingOrders ? "可接单" : "休息中"}</td>
                    <td>{formatFenYuan(player.basePricePerHourFen)}/小时</td>
                    <td>
                      <Link href={`/merchant-console/players/${player.id}`} className="mc-btn mc-btn-ghost mc-btn-small">
                        详情 <ArrowRight size={13} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <DemoEmptyState title="暂无陪玩" description="先新建陪玩档案。" />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- catalog
export function CatalogModuleView() {
  const queryClient = useQueryClient();
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameName, setGameName] = useState("");
  const [productName, setProductName] = useState("");
  const [productRegion, setProductRegion] = useState("");
  const [ruleDuration, setRuleDuration] = useState("");
  const [rulePrice, setRulePrice] = useState("");
  const [ruleCost, setRuleCost] = useState("");
  const [error, setError] = useState<string | null>(null);

  const gamesQuery = useQuery({
    queryKey: ["merchant", "catalog", "games"],
    queryFn: () => apiFetch<CatalogGame[]>("/api/v1/tenant/catalog/games"),
  });
  const productsQuery = useQuery({
    queryKey: ["merchant", "catalog", "products", gameId],
    queryFn: () =>
      apiFetch<CatalogProduct[]>(
        `/api/v1/tenant/catalog/products?gameId=${gameId}`,
      ),
    enabled: gameId !== null,
  });
  const games = gamesQuery.data ?? [];
  const products = productsQuery.data ?? [];

  const invalidate = () =>
    void queryClient.invalidateQueries({
      queryKey: ["merchant", "catalog"],
    });
  const run = (fn: () => Promise<unknown>) =>
    fn().catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );

  const addGame = () =>
    run(() =>
      apiFetch<CatalogGame>("/api/v1/tenant/catalog/games", {
        method: "POST",
        body: JSON.stringify({ name: gameName.trim() }),
      }).then(() => {
        setGameName("");
        invalidate();
      }),
    );
  const toggleGame = (g: CatalogGame) =>
    run(() =>
      apiFetch<CatalogGame>(`/api/v1/tenant/catalog/games/${g.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !g.enabled }),
      }).then(() => invalidate()),
    );
  const addProduct = () =>
    run(() =>
      apiFetch<CatalogProduct>("/api/v1/tenant/catalog/products", {
        method: "POST",
        body: JSON.stringify({
          gameId,
          ...(productRegion ? { gameRegionId: productRegion } : {}),
          name: productName.trim(),
        }),
      }).then(() => {
        setProductName("");
        setProductRegion("");
        invalidate();
      }),
    );
  const toggleProduct = (p: CatalogProduct) =>
    run(() =>
      apiFetch<CatalogProduct>(`/api/v1/tenant/catalog/products/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !p.enabled }),
      }).then(() => invalidate()),
    );
  const rulesQuery = useQuery({
    queryKey: ["merchant", "catalog", "rules", gameId],
    queryFn: () =>
      Promise.all(
        products.map((p) =>
          apiFetch<PricingRule[]>(
            `/api/v1/tenant/catalog/products/${p.id}/pricing`,
          ),
        ),
      ).then((groups) => groups.flat()),
    enabled: gameId !== null && products.length > 0,
  });
  const rules = rulesQuery.data ?? [];
  const regionsQuery = useQuery({
    queryKey: ["merchant", "catalog", "regions", gameId],
    queryFn: () =>
      apiFetch<{ id: string; name: string }[]>(
        `/api/v1/tenant/catalog/regions?gameId=${gameId}`,
      ),
    enabled: gameId !== null,
  });
  const regions = regionsQuery.data ?? [];
  const [selectedProductId, setSelectedProductId] = useState("");
  const addRule = () =>
    run(() =>
      apiFetch<PricingRule>(
        `/api/v1/tenant/catalog/products/${selectedProductId}/pricing`,
        {
          method: "POST",
          body: JSON.stringify({
            durationSeconds: Number(ruleDuration),
            priceFen: rulePrice.trim(),
            ...(ruleCost.trim() !== "" ? { playerCostFen: ruleCost.trim() } : {}),
          }),
        },
      ).then(() => {
        setRuleDuration("");
        setRulePrice("");
        setRuleCost("");
        invalidate();
      }),
    );
  const toggleRule = (r: PricingRule) =>
    run(() =>
      apiFetch<PricingRule>(`/api/v1/tenant/catalog/pricing/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !r.enabled }),
      }).then(() => invalidate()),
    );
  const removeRule = (r: PricingRule) =>
    run(() =>
      apiFetch<unknown>(`/api/v1/tenant/catalog/pricing/${r.id}`, {
        method: "DELETE",
      }).then(() => invalidate()),
    );

  return (
    <div>
      <ModuleHeader kicker="RECORDS / CATALOG" title="服务目录" description="游戏、区服、服务产品与计价规则的真实配置入口。">
        <Link href="/merchant-console/customers" className="mc-btn">客户档案</Link>
      </ModuleHeader>
      {error ? <div className="mc-notice">{error}</div> : null}
      <section className="mc-panel mc-form-panel">
        <div className="mc-section-head">
          <div><h2>游戏与产品</h2><p>启停与增删会真实写入目录。</p></div>
        </div>
        <div className="mc-form-grid">
          <input className="mc-input" placeholder="新游戏名称" value={gameName} onChange={(e) => setGameName(e.target.value)} />
          <button type="button" className="mc-btn" disabled={!gameName.trim()} onClick={() => void addGame()}>添加游戏</button>
        </div>
        <div className="mc-form-grid">
          <label className="mc-field">
            <span>选择游戏</span>
            <select value={gameId ?? ""} onChange={(e) => { setGameId(e.target.value || null); setSelectedProductId(""); }}>
              <option value="">选择游戏…</option>
              {games.map((game) => (
                <option key={game.id} value={game.id}>{game.name}{game.enabled ? "" : "（停用）"}</option>
              ))}
            </select>
          </label>
          {gameId ? (
            <>
              <label className="mc-field"><span>区服</span>
                <select value={productRegion} onChange={(e) => setProductRegion(e.target.value)}>
                  <option value="">不限区服</option>
                  {regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
                </select>
              </label>
              <label className="mc-field"><span>服务产品名称</span>
                <input value={productName} onChange={(e) => setProductName(e.target.value)} />
              </label>
              <button type="button" className="mc-btn" disabled={!productName.trim()} onClick={() => void addProduct()}>添加产品</button>
            </>
          ) : null}
        </div>
      </section>

      {gameId && (
        <>
          <section className="mc-panel">
            <div className="mc-section-head">
              <div><h2>服务产品</h2><p>切换启停后前端下单立即可见变化。</p></div>
              <span>{products.length} 个</span>
            </div>
            {products.length ? (
              <div className="mc-table-wrap">
                <table>
                  <thead><tr><th>产品</th><th>区服</th><th>状态</th><th>操作</th></tr></thead>
                  <tbody>
                    {products.map((product) => (
                      <tr key={product.id}>
                        <td><b className="mc-cell-title">{product.name}</b></td>
                        <td>{product.regionName ?? "不限"}</td>
                        <td><Badge status={product.enabled ? "ACTIVE" : "INACTIVE"} /></td>
                        <td>
                          <button type="button" className="mc-btn mc-btn-ghost mc-btn-small" onClick={() => void toggleProduct(product)}>
                            {product.enabled ? "停用" : "启用"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <DemoEmptyState title="暂无服务产品" description="先在上方添加产品。" />}
          </section>

          <section className="mc-panel">
            <div className="mc-section-head">
              <div><h2>计价规则</h2><p>时价规则（分）真实生效。</p></div>
            </div>
            <div className="mc-form-grid">
              <label className="mc-field"><span>产品</span>
                <select value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)}>
                  <option value="">选择产品…</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
              </label>
              <label className="mc-field"><span>时长（分钟）</span><input type="number" min={1} value={ruleDuration} onChange={(e) => setRuleDuration(e.target.value)} /></label>
              <label className="mc-field"><span>售价（元）</span><input value={rulePrice} onChange={(e) => setRulePrice(e.target.value)} placeholder="120" /></label>
              <label className="mc-field"><span>陪玩成本（元，可选）</span><input value={ruleCost} onChange={(e) => setRuleCost(e.target.value)} placeholder="100" /></label>
              <button type="button" className="mc-btn mc-btn-primary" disabled={!selectedProductId || !ruleDuration || !rulePrice} onClick={() => void addRule()}>
                添加规则
              </button>
            </div>
            {rules.length ? (
              <div className="mc-table-wrap">
                <table>
                  <thead><tr><th>时长</th><th>售价</th><th>陪玩成本</th><th>状态</th><th>操作</th></tr></thead>
                  <tbody>
                    {rules.map((rule) => (
                      <tr key={rule.id}>
                        <td>{Math.floor(rule.durationSeconds / 60)} 分钟</td>
                        <td>{formatFenYuan(rule.priceFen)}</td>
                        <td>{rule.playerCostFen ? formatFenYuan(rule.playerCostFen) : "-"}</td>
                        <td><Badge status={rule.enabled ? "ACTIVE" : "INACTIVE"} /></td>
                        <td>
                          <div className="mc-button-row">
                            <button type="button" className="mc-btn mc-btn-ghost mc-btn-small" onClick={() => void toggleRule(rule)}>
                              {rule.enabled ? "停用" : "启用"}
                            </button>
                            <button type="button" className="mc-btn mc-btn-ghost mc-btn-small" onClick={() => void removeRule(rule)}>删除</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="mc-panel">
            <div className="mc-section-head">
              <div><h2>游戏列表</h2><p>管理启停。</p></div>
            </div>
            <div className="mc-table-wrap">
              <table>
                <tbody>
                  {games.map((game) => (
                    <tr key={game.id}>
                      <td><b className="mc-cell-title">{game.name}</b></td>
                      <td><Badge status={game.enabled ? "ACTIVE" : "INACTIVE"} /></td>
                      <td><button type="button" className="mc-btn mc-btn-ghost mc-btn-small" onClick={() => void toggleGame(game)}>{game.enabled ? "停用" : "启用"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- sessions
export function SessionsModuleView() {
  const [status, setStatus] = useState("");
  const query = useQuery({
    queryKey: ["merchant", "sessions", status],
    queryFn: () => {
      const q = status ? `?status=${encodeURIComponent(status)}` : "";
      return apiFetch<SessionRow[]>(`/api/v1/tenant/sessions${q}`);
    },
  });
  const rows = query.data ?? [];
  return (
    <div>
      <ModuleHeader kicker="RECORDS / SESSIONS" title="场次与证据" description="CLASSIC 与 GD 场次统一台账：状态、计时、证据与待复核调整。">
        <Link href="/merchant-console/live" className="mc-btn">进行中场次</Link>
      </ModuleHeader>
      <section className="mc-panel">
        <div className="mc-filterbar">
          <select className="mc-select" aria-label="按场次状态筛选" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            {["SCHEDULED","NOT_STARTED","STARTED","ENDED","ADJUSTMENT_PENDING","CONFIRMED"].map((s) => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
          <span className="mc-muted-text">共 {rows.length} 场</span>
        </div>
        {rows.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead>
                <tr><th>场次/订单</th><th>流程</th><th>客户</th><th>陪玩</th><th>状态</th><th>时长</th><th>证据</th><th>待复核调整</th><th>操作</th></tr>
              </thead>
              <tbody>
                {rows.map((session) => (
                  <tr key={session.id}>
                    <td><Link href={`/merchant-console/sessions/${session.id}`} className="mc-order-link">{session.orderNo}</Link></td>
                    <td>{session.flow === "GAME_DISPATCH" ? "GD" : "CLASSIC"}</td>
                    <td>{session.customerName}</td>
                    <td>{session.playerName}</td>
                    <td><Badge status={session.status} /></td>
                    <td>{formatDuration(session.durationSeconds)}</td>
                    <td>{session.evidenceCount}</td>
                    <td>{session.adjustmentPendingCount}</td>
                    <td>
                      <Link href={`/merchant-console/sessions/${session.id}`} className="mc-btn mc-btn-ghost mc-btn-small">
                        详情 <ArrowRight size={13} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : query.isPending ? <div className="mc-empty">加载场次中…</div> : <DemoEmptyState title="暂无场次" description="订单开始服务后自动生成。" />}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- finance
export function FinanceModuleView() {
  const [storeCut, setStoreCut] = useState("");
  const [amount, setAmount] = useState("");
  const [split, setSplit] = useState<{ platformFeeFen: string; storeCutFen: string; playerShareFen: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const rulesQuery = useQuery({
    queryKey: ["merchant", "finance", "rules"],
    queryFn: () =>
      apiFetch<{ platformFeeBp: number; storeCutBp: number }>(
        "/api/v1/tenant/finance-rules",
      ),
  });
  const ledgerQuery = useQuery({
    queryKey: ["merchant", "finance", "ledger"],
    queryFn: () =>
      apiFetch<FinanceLedger>("/api/v1/tenant/settlements/ledger"),
  });
  const saveStoreCut = useMutation({
    mutationFn: () =>
      apiFetch<{ platformFeeBp: number; storeCutBp: number }>(
        "/api/v1/tenant/finance-rules/store-cut",
        { method: "POST", body: JSON.stringify({ storeCutBp: Number(storeCut) }) },
      ),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["merchant", "finance", "rules"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const preview = useMutation({
    mutationFn: () =>
      apiFetch<{ platformFeeFen: string; storeCutFen: string; playerShareFen: string }>(
        "/api/v1/tenant/finance-rules/split-preview",
        { method: "POST", body: JSON.stringify({ amountFen: amount }) },
      ),
    onSuccess: setSplit,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const rules = rulesQuery.data;
  const ledger = ledgerQuery.data;
  return (
    <div>
      <ModuleHeader kicker="RECORDS / FINANCE" title="收入账本" description="陪玩应收、账本与门店分账规则。">
        <Link href="/merchant-console/settlements" className="mc-btn">结算批次</Link>
      </ModuleHeader>
      {error ? <div className="mc-notice">{error}</div> : null}
      {rules ? (
        <section className="mc-panel mc-form-panel">
          <div className="mc-section-head"><div><h2>分账规则</h2><p>平台费率与门店抽成。</p></div></div>
          <div className="mc-summary-line"><span>平台费率</span><b>{(rules.platformFeeBp / 100).toFixed(2)}%</b></div>
          <div className="mc-form-grid">
            <label className="mc-field"><span>门店抽成（基点）</span>
              <input type="number" value={storeCut} onChange={(e) => setStoreCut(e.target.value)} placeholder={String(rules.storeCutBp)} />
            </label>
            <button type="button" className="mc-btn mc-btn-primary" disabled={saveStoreCut.isPending || !storeCut} onClick={() => saveStoreCut.mutate()}>
              保存门店抽成
            </button>
          </div>
          <div className="mc-form-grid">
            <label className="mc-field"><span>拆分明细预览（元）</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="120" />
            </label>
            <button type="button" className="mc-btn" disabled={!amount} onClick={() => preview.mutate()}>预览拆分</button>
          </div>
          {split ? (
            <div className="mc-table-wrap">
              <table>
                <tbody>
                  <tr><td>平台服务费</td><td>{formatFenYuan(split.platformFeeFen)}</td></tr>
                  <tr><td>门店抽成</td><td>{formatFenYuan(split.storeCutFen)}</td></tr>
                  <tr><td>陪玩收入</td><td>{formatFenYuan(split.playerShareFen)}</td></tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
      <section className="mc-panel">
        <div className="mc-section-head">
          <div><h2>应收账本</h2><p>已付 {ledger ? formatFenYuan(ledger.paidFen) : "-"} · 未付 {ledger ? formatFenYuan(ledger.unpaidFen) : "-"}</p></div>
        </div>
        {(ledger?.rows ?? []).length ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>订单</th><th>陪玩</th><th>来源</th><th>金额</th><th>状态</th><th>批次</th><th>创建时间</th></tr></thead>
              <tbody>
                {ledger!.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.orderNo}</td><td>{row.playerName}</td><td>{row.source}</td>
                    <td>{formatFenYuan(row.amountFen)}</td><td><Badge status={row.status} /></td>
                    <td>{row.batchNo ?? "-"}</td><td>{dateTime(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <DemoEmptyState title="暂无应收记录" description="场次确认结算后生成。" />}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- settlements
export function SettlementsModuleView() {
  const queryClient = useQueryClient();
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const batchesQuery = useQuery({
    queryKey: ["merchant", "settlements", "batches"],
    queryFn: () => apiFetch<SettlementBatchRow[]>("/api/v1/tenant/settlements"),
  });
  const earningsQuery = useQuery({
    queryKey: ["merchant", "settlements", "earnings"],
    queryFn: () =>
      apiFetch<PendingEarning[]>("/api/v1/tenant/settlements/earnings"),
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["merchant", "settlements"] });
  };
  const addToBatch = useMutation({
    mutationFn: async () => {
      const rows = (earningsQuery.data ?? []).filter((e) => pendingIds.includes(e.id));
      const legacyIds = rows.filter((r) => r.source === "LEGACY").map((r) => r.id);
      const slotIds = rows.filter((r) => r.source === "SLOT").map((r) => r.id);
      const draft = (batchesQuery.data ?? []).find((b) => b.status === "DRAFT");
      const batchId = draft?.id ?? (await apiFetch<{ id: string }>("/api/v1/tenant/settlements", { method: "POST" })).id;
      await apiFetch<unknown>(`/api/v1/tenant/settlements/${batchId}/items`, {
        method: "POST",
        body: JSON.stringify({ earningIds: legacyIds, slotEarningIds: slotIds }),
      });
      return batchId;
    },
    onSuccess: () => {
      setPendingIds([]);
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const rows = batchesQuery.data ?? [];
  const earnings = earningsQuery.data ?? [];
  return (
    <div>
      <ModuleHeader kicker="RECORDS / SETTLEMENTS" title="结算批次" description="批次状态机：生成、复核、批准、登记支付与冲正。">
        <Link href="/merchant-console/finance" className="mc-btn">收入账本</Link>
      </ModuleHeader>
      {error ? <div className="mc-notice">{error}</div> : null}
      <section className="mc-panel">
        <div className="mc-section-head">
          <div><h2>待入批应收</h2><p>勾选应收加入草稿批次（自动创建）。</p></div>
          <button type="button" className="mc-btn mc-btn-primary" disabled={pendingIds.length === 0 || addToBatch.isPending} onClick={() => addToBatch.mutate()}>
            加入批次（{pendingIds.length}）
          </button>
        </div>
        {earnings.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>选择</th><th>订单</th><th>陪玩</th><th>来源</th><th>金额</th><th>时间</th></tr></thead>
              <tbody>
                {earnings.map((e) => (
                  <tr key={e.id}>
                    <td><input type="checkbox" checked={pendingIds.includes(e.id)} onChange={() => setPendingIds((prev) => prev.includes(e.id) ? prev.filter((x) => x !== e.id) : [...prev, e.id])} /></td>
                    <td>{e.orderNo}</td><td>{e.playerName}</td><td>{e.source}</td><td>{formatFenYuan(e.amountFen)}</td><td>{dateTime(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <DemoEmptyState title="暂无待结算应收" description="确认结算后出现。" />}
      </section>
      <section className="mc-panel">
        <div className="mc-section-head"><div><h2>批次列表</h2><p>进入详情执行复核、批准、支付与作废。</p></div><span>{rows.length} 批</span></div>
        {rows.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>批次号</th><th>状态</th><th>总额</th><th>笔数</th><th>创建人</th><th>创建时间</th><th>操作</th></tr></thead>
              <tbody>
                {rows.map((batch) => (
                  <tr key={batch.id}>
                    <td><Link href={`/merchant-console/settlements/${batch.id}`} className="mc-order-link">{batch.batchNo}</Link></td>
                    <td><Badge status={batch.status} /></td>
                    <td>{formatFenYuan(batch.totalAmountFen)}</td>
                    <td>{batch.itemCount}</td><td>{batch.createdBy ?? "系统"}</td><td>{dateTime(batch.createdAt)}</td>
                    <td><Link href={`/merchant-console/settlements/${batch.id}`} className="mc-btn mc-btn-ghost mc-btn-small">详情 <ArrowRight size={13} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <DemoEmptyState title="暂无批次" description="从上方应收生成批次。" />}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- disputes
export function DisputesModuleView() {
  const query = useQuery({
    queryKey: ["merchant", "disputes"],
    queryFn: () => apiFetch<DisputeRow[]>("/api/v1/tenant/disputes"),
  });
  const rows = query.data ?? [];
  return (
    <div>
      <ModuleHeader kicker="RECORDS / DISPUTES" title="客诉记录" description="争议证据、处理时间线、结算冻结状态集中查看。">
        <Link href="/merchant-console/risk" className="mc-btn">异常与争议</Link>
      </ModuleHeader>
      <section className="mc-panel">
        <div className="mc-filterbar"><span className="mc-muted-text">共 {rows.length} 条</span></div>
        {rows.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>订单</th><th>客户</th><th>陪玩</th><th>争议原因</th><th>状态</th><th>发起时间</th><th>操作</th></tr></thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>{d.orderNo}</td><td>{d.customerName}</td><td>{d.playerName}</td><td>{d.reason}</td>
                    <td><Badge status={d.status} /></td><td>{dateTime(d.createdAt)}</td>
                    <td><Link href={`/merchant-console/disputes/${d.id}`} className="mc-btn mc-btn-ghost mc-btn-small">处理 <ArrowRight size={13} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <DemoEmptyState title="暂无客诉" description="老板或陪玩发起争议后会显示在此。" />}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- audit
export function AuditModuleView() {
  const [keyword, setKeyword] = useState("");
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const [download, setDownload] = useState<string | null>(null);
  const PAGE_SIZE = 50;
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (keyword.trim()) params.set("q", keyword.trim());
  if (action.trim()) params.set("action", action.trim());
  const query = useQuery({
    queryKey: ["merchant", "audit", keyword, action, offset],
    queryFn: () => apiFetch<AuditRow[]>(`/api/v1/tenant/audit?${params.toString()}`),
  });
  const rows = query.data ?? [];
  const hasMore = rows.length === PAGE_SIZE;
  const exportCsv = async () => {
    try {
      const data = await apiFetch<{ csv: string; filename: string }>(
        `/api/v1/tenant/audit/export?${params.toString()}`,
      );
      const blob = new Blob(["\uFEFF" + data.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = data.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDownload(`已导出 ${data.csv.split("\n").length - 1} 条记录。`);
    } catch (e) {
      setDownload(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div>
      <ModuleHeader kicker="RECORDS / AUDIT" title="审计日志" description="敏感操作、状态变更与操作者追踪。">
        <button type="button" className="mc-btn" onClick={() => void exportCsv()}><Download size={15} /> 导出 CSV</button>
      </ModuleHeader>
      {download ? <div className="mc-notice">{download}</div> : null}
      <section className="mc-panel">
        <div className="mc-filterbar">
          <label className="mc-searchbox">
            <Search size={15} aria-hidden="true" />
            <input value={keyword} onChange={(e) => { setKeyword(e.target.value); setOffset(0); }} placeholder="搜索摘要/操作" aria-label="搜索审计" />
          </label>
          <input className="mc-input" style={{ maxWidth: 180 }} placeholder="动作名" value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }} />
        </div>
        {rows.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead><tr><th>动作</th><th>资源</th><th>操作者</th><th>摘要</th><th>时间</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><b className="mc-mono">{row.action}</b></td>
                    <td>{row.resourceType ?? "-"} · {row.resourceId ?? "-"}</td>
                    <td>{row.actorType ?? "-"} · {row.actorId ?? "-"}</td>
                    <td>{row.summary ?? "-"}</td>
                    <td>{dateTime(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mc-table-foot">
              <button type="button" className="mc-btn mc-btn-ghost mc-btn-small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</button>
              <span>偏移 {offset} · 每页 {PAGE_SIZE}</span>
              <button type="button" className="mc-btn mc-btn-ghost mc-btn-small" disabled={!hasMore} onClick={() => setOffset(offset + PAGE_SIZE)}>下一页</button>
            </div>
          </div>
        ) : <DemoEmptyState title="暂无审计记录" description="调整筛选条件后重试。" />}
      </section>
    </div>
  );
}
