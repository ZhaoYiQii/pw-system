"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Plus, Save, Search } from "lucide-react";
import { apiFetch } from "../api";
import { formatFenYuan, sumFen, yuanToFenString } from "../money";
import type {
  BatchDetail,
  BatchRow,
  FinanceLedger,
  FinanceRules,
  FinanceSplit,
  GameRow,
  PendingEarning,
  PricingRule,
  ProductRow,
  RegionRow,
} from "./record-api";

export function SettlementsConsoleView() {
  const queryClient = useQueryClient();
  const [selectedEarningIds, setSelectedEarningIds] = useState<string[]>([]);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const batchesQuery = useQuery({
    queryKey: ["mc-settlements-batches"],
    queryFn: () => apiFetch<BatchRow[]>("/api/v1/tenant/settlements"),
  });
  const earningsQuery = useQuery({
    queryKey: ["mc-settlements-earnings"],
    queryFn: () =>
      apiFetch<PendingEarning[]>("/api/v1/tenant/settlements/earnings"),
  });
  const detailQuery = useQuery({
    queryKey: ["mc-settlements-batch", activeBatchId],
    queryFn: () =>
      apiFetch<BatchDetail>(`/api/v1/tenant/settlements/${activeBatchId}`),
    enabled: activeBatchId !== null,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["mc-settlements-batches"] });
    void queryClient.invalidateQueries({ queryKey: ["mc-settlements-earnings"] });
    if (activeBatchId)
      void queryClient.invalidateQueries({
        queryKey: ["mc-settlements-batch", activeBatchId],
      });
  };

  const addToBatch = useMutation({
    mutationFn: async (earningIds: string[]) => {
      const rows = (earningsQuery.data ?? []).filter((earning) =>
        earningIds.includes(earning.id),
      );
      const legacyIds = rows
        .filter((row) => row.source === "LEGACY")
        .map((row) => row.id);
      const slotIds = rows
        .filter((row) => row.source === "SLOT")
        .map((row) => row.id);
      const draft = batchesQuery.data?.find(
        (batch) => batch.status === "DRAFT",
      );
      const batchId = draft?.id ?? (await apiFetch<{ id: string }>("/api/v1/tenant/settlements", { method: "POST" })).id;
      await apiFetch<unknown>(`/api/v1/tenant/settlements/${batchId}/items`, {
        method: "POST",
        body: JSON.stringify({ earningIds: legacyIds, slotEarningIds: slotIds }),
      });
      return batchId;
    },
    onSuccess: (batchId) => {
      setSelectedEarningIds([]);
      setActiveBatchId(batchId);
      setMessage("已将所选应收加入结算批次。");
      refresh();
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      apiFetch<unknown>(`/api/v1/tenant/settlements/${id}/${action}`, {
        method: "POST",
      }),
    onSuccess: () => {
      setMessage("批次状态已更新。");
      refresh();
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });

  const earnings = earningsQuery.data ?? [];
  const batches = batchesQuery.data ?? [];
  const draftBatch = batches.find((batch) => batch.status === "DRAFT");

  const toggleEarning = (id: string) => {
    setSelectedEarningIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">RECORDS / SETTLEMENTS</div>
          <h1>结算批次</h1>
          <p>应收入批、复核、批准、登记支付与作废。</p>
        </div>
        <span className="mc-chip">真实接口</span>
      </div>

      {message ? <p className="mc-form-error">{message}</p> : null}

      <section className="mc-panel">
        <div className="mc-section-head">
          <div>
            <h2>待结算应收</h2>
            <p>
              {draftBatch
                ? `当前草稿批次：${draftBatch.batchNo}`
                : "暂无草稿批次"}
            </p>
          </div>
          <button
            type="button"
            className="mc-btn mc-btn-primary mc-btn-small"
            disabled={selectedEarningIds.length === 0}
            onClick={() => addToBatch.mutate(selectedEarningIds)}
          >
            {draftBatch ? "加入草稿批次" : "新建批次并加入"}
          </button>
        </div>
        {earningsQuery.isPending ? (
          <p className="mc-loading-text">加载中…</p>
        ) : null}
        {!earningsQuery.isPending && earnings.length === 0 ? (
          <div className="mc-empty">
            <p>暂无待结算应收。</p>
          </div>
        ) : null}
        {earnings.length > 0 ? (
          <div className="mc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th aria-label="选择" />
                  <th>类型</th>
                  <th>陪玩</th>
                  <th>订单</th>
                  <th>应收金额</th>
                </tr>
              </thead>
              <tbody>
                {earnings.map((earning) => (
                  <tr key={earning.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择 ${earning.orderNo}`}
                        checked={selectedEarningIds.includes(earning.id)}
                        onChange={() => toggleEarning(earning.id)}
                      />
                    </td>
                    <td>
                      {earning.source === "SLOT" ? "档位收入" : "旧流程"}
                    </td>
                    <td>{earning.playerName}</td>
                    <td className="mc-mono">{earning.orderNo}</td>
                    <td className="mc-mono">
                      {formatFenYuan(earning.amountFen)}
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
          <div>
            <h2>批次列表（{batches.length}）</h2>
            <p>状态机：草稿 → 已复核 → 已批准 → 已支付 / 作废</p>
          </div>
        </div>
        {batchesQuery.isPending ? (
          <p className="mc-loading-text">加载中…</p>
        ) : batches.length === 0 ? (
          <div className="mc-empty">
            <p>暂无批次，请先在待结算应收创建。</p>
          </div>
        ) : (
          <div className="mc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>批次号</th>
                  <th>状态</th>
                  <th>笔数</th>
                  <th>合计</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td>
                      <button
                        type="button"
                        className="mc-order-link"
                        onClick={() => setActiveBatchId(batch.id)}
                      >
                        {batch.batchNo}
                      </button>
                    </td>
                    <td>
                      <BatchStatusChip status={batch.status} />
                    </td>
                    <td>{batch.itemCount}</td>
                    <td className="mc-mono">
                      {formatFenYuan(batch.totalAmountFen)}
                    </td>
                    <td>
                      <BatchActions
                        batch={batch}
                        disabled={transition.isPending}
                        onAction={(action) =>
                          transition.mutate({ id: batch.id, action })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {activeBatchId ? (
        <section className="mc-panel">
          <div className="mc-section-head">
            <div>
              <h2>
                批次明细：{detailQuery.data?.batchNo ?? "…"}（
                {formatFenYuan(detailQuery.data?.totalAmountFen ?? "0")}）
              </h2>
              <p>
                创建：{detailQuery.data?.createdByName ?? "-"}
                {detailQuery.data?.reviewedByName
                  ? ` · 复核：${detailQuery.data.reviewedByName}`
                  : ""}
                {detailQuery.data?.approvedByName
                  ? ` · 批准：${detailQuery.data.approvedByName}`
                  : ""}
              </p>
            </div>
            <button
              type="button"
              className="mc-btn mc-btn-small"
              onClick={() => setActiveBatchId(null)}
            >
              收起
            </button>
          </div>
          {detailQuery.isPending ? (
            <p className="mc-loading-text">加载中…</p>
          ) : null}
          {detailQuery.data && detailQuery.data.items.length === 0 ? (
            <p className="mc-empty-compact">该批次暂无明细。</p>
          ) : null}
          {detailQuery.data && detailQuery.data.items.length > 0 ? (
            <div className="mc-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>陪玩</th>
                    <th>订单</th>
                    <th>金额</th>
                  </tr>
                </thead>
                <tbody>
                  {detailQuery.data.items.map((item) => (
                    <tr key={item.itemId}>
                      <td>{item.source === "SLOT" ? "档位收入" : "旧流程"}</td>
                      <td>{item.playerName}</td>
                      <td className="mc-mono">{item.orderNo}</td>
                      <td className="mc-mono">
                        {formatFenYuan(item.amountFen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function FinanceConsoleView() {
  const queryClient = useQueryClient();
  const [storeCut, setStoreCut] = useState("");
  const [amount, setAmount] = useState("");
  const [split, setSplit] = useState<FinanceSplit | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const rulesQuery = useQuery({
    queryKey: ["mc-finance-rules"],
    queryFn: () => apiFetch<FinanceRules>("/api/v1/tenant/finance-rules"),
  });
  const ledgerQuery = useQuery({
    queryKey: ["mc-finance-ledger"],
    queryFn: () =>
      apiFetch<FinanceLedger>("/api/v1/tenant/settlements/ledger"),
  });
  const saveStoreCut = useMutation({
    mutationFn: () =>
      apiFetch<FinanceRules>("/api/v1/tenant/finance-rules/store-cut", {
        method: "POST",
        body: JSON.stringify({ storeCutBp: Number(storeCut) }),
      }),
    onSuccess: () => {
      setStoreCut("");
      void queryClient.invalidateQueries({ queryKey: ["mc-finance-rules"] });
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });
  const preview = useMutation({
    mutationFn: () =>
      apiFetch<FinanceSplit>("/api/v1/tenant/finance-rules/split-preview", {
        method: "POST",
        body: JSON.stringify({ amountFen: amount }),
      }),
    onSuccess: setSplit,
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });

  const rules = rulesQuery.data;
  const ledger = ledgerQuery.data;

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">RECORDS / FINANCE</div>
          <h1>收入账本</h1>
          <p>费率、收入账本与分账试算。</p>
        </div>
        <span className="mc-chip">真实接口</span>
      </div>

      {message ? <p className="mc-form-error">{message}</p> : null}

      <section className="mc-panel">
        <div className="mc-section-head">
          <div>
            <h2>当前费率（bp，1% = 100bp）</h2>
            <p>平台费 / 门店抽成 / 陪玩到手</p>
          </div>
        </div>
        {rules ? (
          <div className="mc-table-wrap">
            <table>
              <tbody>
                <tr>
                  <td>平台服务费</td>
                  <td className="mc-mono">
                    {rules.platformFeeBp} bp（{(rules.platformFeeBp / 100).toFixed(2)}%）
                  </td>
                </tr>
                <tr>
                  <td>门店抽成</td>
                  <td className="mc-mono">
                    {rules.storeCutBp} bp（{(rules.storeCutBp / 100).toFixed(2)}%）
                  </td>
                </tr>
                <tr>
                  <td>陪玩到手</td>
                  <td className="mc-mono">
                    {10000 - rules.platformFeeBp - rules.storeCutBp} bp
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="mc-filter-row">
          <input
            className="mc-input-inline"
            type="number"
            placeholder="门店抽成（bp）"
            value={storeCut}
            onChange={(event) => setStoreCut(event.target.value)}
          />
          <button
            type="button"
            className="mc-btn"
            disabled={saveStoreCut.isPending || !storeCut.trim()}
            onClick={() => saveStoreCut.mutate()}
          >
            <Save size={14} />
            保存门店抽成
          </button>
        </div>
      </section>

      <section className="mc-panel">
        <div className="mc-section-head">
          <div>
            <h2>收入账本</h2>
            <p>
              已付 {formatFenYuan(ledger?.paidFen ?? "0")} · 未付{" "}
              {formatFenYuan(ledger?.unpaidFen ?? "0")} ·{" "}
              {ledger?.rows.length ?? 0} 条
            </p>
          </div>
        </div>
        {ledgerQuery.isPending ? (
          <p className="mc-loading-text">加载中…</p>
        ) : null}
        {ledger && ledger.rows.length > 0 ? (
          <div className="mc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>来源</th>
                  <th>陪玩</th>
                  <th>订单</th>
                  <th>状态</th>
                  <th>批次</th>
                  <th>金额</th>
                </tr>
              </thead>
              <tbody>
                {ledger.rows.slice(0, 100).map((row) => (
                  <tr key={row.id}>
                    <td>{row.source === "SLOT" ? "GD 档位" : "CLASSIC"}</td>
                    <td>{row.playerName}</td>
                    <td className="mc-mono">{row.orderNo}</td>
                    <td>{row.status}</td>
                    <td>{row.batchNo ?? "-"}</td>
                    <td className="mc-mono">{formatFenYuan(row.amountFen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !ledgerQuery.isPending ? (
          <p className="mc-empty-compact">暂无收入记录。</p>
        ) : null}
      </section>

      <section className="mc-panel">
        <div className="mc-section-head">
          <div>
            <h2>分账试算</h2>
            <p>输入老板应付金额（分）</p>
          </div>
        </div>
        <div className="mc-filter-row">
          <input
            className="mc-input-inline"
            type="number"
            placeholder="10000 = ¥100.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <button
            type="button"
            className="mc-btn"
            disabled={preview.isPending || !amount.trim()}
            onClick={() => preview.mutate()}
          >
            试算
          </button>
        </div>
        {split ? (
          <div className="mc-table-wrap">
            <table>
              <tbody>
                <tr>
                  <td>平台服务费</td>
                  <td className="mc-mono">{formatFenYuan(split.platformFeeFen)}</td>
                </tr>
                <tr>
                  <td>门店抽成</td>
                  <td className="mc-mono">{formatFenYuan(split.storeCutFen)}</td>
                </tr>
                <tr>
                  <td>陪玩到手</td>
                  <td className="mc-mono">{formatFenYuan(split.playerShareFen)}</td>
                </tr>
                <tr>
                  <td>合计</td>
                  <td className="mc-mono">
                    {formatFenYuan(
                      sumFen([
                        split.platformFeeFen,
                        split.storeCutFen,
                        split.playerShareFen,
                      ]),
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function CatalogConsoleView() {
  const queryClient = useQueryClient();
  const [gameId, setGameId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");

  const [newGame, setNewGame] = useState("");
  const [newRegion, setNewRegion] = useState("");
  const [newProduct, setNewProduct] = useState("");
  const [newProductRegion, setNewProductRegion] = useState("");
  const [ruleDuration, setRuleDuration] = useState("");
  const [rulePrice, setRulePrice] = useState("");
  const [ruleCost, setRuleCost] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const gamesQuery = useQuery({
    queryKey: ["mc-catalog-games"],
    queryFn: () => apiFetch<GameRow[]>("/api/v1/tenant/catalog/games"),
  });
  const regionsQuery = useQuery({
    queryKey: ["mc-catalog-regions", gameId],
    queryFn: () =>
      apiFetch<RegionRow[]>(`/api/v1/tenant/catalog/regions?gameId=${gameId}`),
    enabled: gameId !== null,
  });
  const productsQuery = useQuery({
    queryKey: ["mc-catalog-products", gameId],
    queryFn: () =>
      apiFetch<ProductRow[]>(
        `/api/v1/tenant/catalog/products?gameId=${gameId}`,
      ),
    enabled: gameId !== null,
  });
  const rulesQuery = useQuery({
    queryKey: ["mc-catalog-pricing", productId],
    queryFn: () =>
      apiFetch<PricingRule[]>(
        `/api/v1/tenant/catalog/products/${productId}/pricing`,
      ),
    enabled: productId !== null,
  });

  const games = gamesQuery.data ?? [];
  const filteredGames = useMemoFiltered(
    games,
    keyword,
    (game) => `${game.name}`,
  );
  const regions = regionsQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const rules = rulesQuery.data ?? [];
  const selectedProduct = products.find((product) => product.id === productId);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["mc-catalog"] });
  const runMutation = <T,>(promise: Promise<T>): Promise<T> => promise;

  const mutateCreateGame = useMutation({
    mutationFn: () =>
      runMutation(
        apiFetch<GameRow>("/api/v1/tenant/catalog/games", {
          method: "POST",
          body: JSON.stringify({ name: newGame.trim() }),
        }),
      ),
    onSuccess: () => {
      setNewGame("");
      refresh();
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });

  const mutateToggleGame = useMutation({
    mutationFn: (game: GameRow) =>
      apiFetch<GameRow>(`/api/v1/tenant/catalog/games/${game.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !game.enabled }),
      }),
    onSuccess: refresh,
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });

  const mutateCreateRegion = useMutation({
    mutationFn: () =>
      apiFetch<RegionRow>(
        `/api/v1/tenant/catalog/games/${gameId as string}/regions`,
        {
          method: "POST",
          body: JSON.stringify({ name: newRegion.trim() }),
        },
      ),
    onSuccess: () => {
      setNewRegion("");
      refresh();
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });

  const mutateCreateProduct = useMutation({
    mutationFn: () =>
      apiFetch<ProductRow>("/api/v1/tenant/catalog/products", {
        method: "POST",
        body: JSON.stringify({
          gameId,
          ...(newProductRegion ? { gameRegionId: newProductRegion } : {}),
          name: newProduct.trim(),
        }),
      }),
    onSuccess: () => {
      setNewProduct("");
      setNewProductRegion("");
      refresh();
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });

  const mutateCreateRule = useMutation({
    mutationFn: () => {
      const priceFen = yuanToFenString(rulePrice);
      const costFen = ruleCost.trim() ? yuanToFenString(ruleCost) : null;
      if (priceFen === null || Number(ruleDuration) <= 0)
        throw new Error("请填写时长与合法售价");
      return apiFetch<PricingRule>(
        `/api/v1/tenant/catalog/products/${productId as string}/pricing`,
        {
          method: "POST",
          body: JSON.stringify({
            durationSeconds: Number(ruleDuration),
            priceFen,
            ...(costFen !== null ? { playerCostFen: costFen } : {}),
          }),
        },
      );
    },
    onSuccess: () => {
      setRuleDuration("");
      setRulePrice("");
      setRuleCost("");
      refresh();
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : String(error)),
  });

  const mutateToggleRule = useMutation({
    mutationFn: (rule: PricingRule) =>
      apiFetch<PricingRule>(`/api/v1/tenant/catalog/pricing/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !rule.enabled }),
      }),
    onSuccess: refresh,
  });
  const mutateDeleteRule = useMutation({
    mutationFn: (rule: PricingRule) =>
      apiFetch<unknown>(`/api/v1/tenant/catalog/pricing/${rule.id}`, {
        method: "DELETE",
      }),
    onSuccess: refresh,
  });

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">RECORDS / CATALOG</div>
          <h1>服务目录</h1>
          <p>游戏 → 区服 → 服务产品 → 价格规则。</p>
        </div>
        <span className="mc-chip">真实接口</span>
      </div>
      {message ? <p className="mc-form-error">{message}</p> : null}

      <section className="mc-panel">
        <div className="mc-section-head">
          <div>
            <h2>游戏</h2>
            <p>搜索或新建游戏后管理区服与产品</p>
          </div>
        </div>
        <div className="mc-filter-row">
          <label className="mc-searchbox">
            <Search size={15} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索游戏"
            />
          </label>
          <input
            className="mc-input-inline"
            value={newGame}
            onChange={(event) => setNewGame(event.target.value)}
            placeholder="新游戏名称"
          />
          <button
            type="button"
            className="mc-btn"
            disabled={mutateCreateGame.isPending || !newGame.trim()}
            onClick={() => mutateCreateGame.mutate()}
          >
            <Plus size={14} />
            新建游戏
          </button>
        </div>
        <RecordTable
          loading={gamesQuery.isPending}
          headers={["游戏", "状态", "操作"]}
          rows={filteredGames}
          empty={<p>暂无游戏，先新建一个。</p>}
          renderRow={(game) => (
            <>
              <td>
                <b className="mc-cell-title">{game.name}</b>
              </td>
              <td>
                <StatusText text={game.enabled ? "上架" : "停用"} />
              </td>
              <td>
                <div className="mc-button-row">
                  <button
                    type="button"
                    className="mc-btn mc-btn-ghost mc-btn-small"
                    onClick={() => {
                      setGameId(game.id);
                      setProductId(null);
                    }}
                  >
                    区服/产品
                  </button>
                  <button
                    type="button"
                    className="mc-btn mc-btn-small"
                    onClick={() => mutateToggleGame.mutate(game)}
                  >
                    {game.enabled ? "停用" : "启用"}
                  </button>
                </div>
              </td>
            </>
          )}
        />
      </section>

      {gameId ? (
        <>
          <section className="mc-panel">
            <div className="mc-section-head">
              <div>
                <h2>区服</h2>
                <p>区服可选；产品可绑定区服。</p>
              </div>
            </div>
            <div className="mc-filter-row">
              <input
                className="mc-input-inline"
                value={newRegion}
                onChange={(event) => setNewRegion(event.target.value)}
                placeholder="区服名称"
              />
              <button
                type="button"
                className="mc-btn"
                disabled={mutateCreateRegion.isPending || !newRegion.trim()}
                onClick={() => mutateCreateRegion.mutate()}
              >
                <Plus size={14} />
                新建区服
              </button>
            </div>
            {regions.length === 0 ? (
              <p className="mc-empty-compact">暂无区服（可选）。</p>
            ) : (
              <div className="mc-table-wrap">
                <table>
                  <tbody>
                    {regions.map((region) => (
                      <tr key={region.id}>
                        <td>{region.name}</td>
                        <td>
                          <StatusText
                            text={region.enabled ? "启用" : "停用"}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mc-panel">
            <div className="mc-section-head">
              <div>
                <h2>服务产品</h2>
                <p>选择产品后可维护价格（金额按分存储）</p>
              </div>
            </div>
            <div className="mc-filter-row">
              <input
                className="mc-input-inline"
                value={newProduct}
                onChange={(event) => setNewProduct(event.target.value)}
                placeholder="产品名称"
              />
              <select
                className="mc-input-inline"
                value={newProductRegion}
                onChange={(event) => setNewProductRegion(event.target.value)}
              >
                <option value="">不限区服</option>
                {regions
                  .filter((region) => region.enabled)
                  .map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className="mc-btn"
                disabled={mutateCreateProduct.isPending || !newProduct.trim()}
                onClick={() => mutateCreateProduct.mutate()}
              >
                <Plus size={14} />
                新建产品
              </button>
            </div>
            <RecordTable
              loading={false}
              headers={["产品", "区服", "状态", "操作"]}
              rows={products}
              empty={<p>暂无服务产品。</p>}
              renderRow={(product) => (
                <>
                  <td>
                    <b className="mc-cell-title">{product.name}</b>
                  </td>
                  <td>{product.regionName ?? "不限区服"}</td>
                  <td>
                    <StatusText text={product.enabled ? "上架" : "停用"} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="mc-btn mc-btn-ghost mc-btn-small"
                      onClick={() => setProductId(product.id)}
                    >
                      价格
                    </button>
                  </td>
                </>
              )}
            />
          </section>
        </>
      ) : null}

      {selectedProduct ? (
        <section className="mc-panel">
          <div className="mc-section-head">
            <div>
              <h2>{selectedProduct.name} · 价格</h2>
              <p>时长按秒，金额按分输入</p>
            </div>
          </div>
          <div className="mc-filter-row">
            <input
              className="mc-input-inline"
              type="number"
              value={ruleDuration}
              onChange={(event) => setRuleDuration(event.target.value)}
              placeholder="时长（秒）"
            />
            <input
              className="mc-input-inline"
              type="text"
              inputMode="decimal"
              value={rulePrice}
              onChange={(event) => setRulePrice(event.target.value)}
              placeholder="售价（元）"
            />
            <input
              className="mc-input-inline"
              type="text"
              inputMode="decimal"
              value={ruleCost}
              onChange={(event) => setRuleCost(event.target.value)}
              placeholder="成本（元，可选）"
            />
            <button
              type="button"
              className="mc-btn"
              disabled={
                mutateCreateRule.isPending ||
                !ruleDuration ||
                !rulePrice.trim()
              }
              onClick={() => mutateCreateRule.mutate()}
            >
              <Plus size={14} />
              新增价格
            </button>
          </div>
          <RecordTable
            loading={rulesQuery.isPending}
            headers={["时长", "售价", "成本", "状态", "操作"]}
            rows={rules}
            empty={<p>暂无价格规则。</p>}
            renderRow={(rule) => (
              <>
                <td>{durationLabel(rule.durationSeconds)}</td>
                <td className="mc-mono">{formatFenYuan(rule.priceFen)}</td>
                <td className="mc-mono">
                  {formatFenYuan(rule.playerCostFen)}
                </td>
                <td>
                  <StatusText text={rule.enabled ? "启用" : "停用"} />
                </td>
                <td>
                  <div className="mc-button-row">
                    <button
                      type="button"
                      className="mc-btn mc-btn-small"
                      onClick={() => mutateToggleRule.mutate(rule)}
                    >
                      {rule.enabled ? "停用" : "启用"}
                    </button>
                    <button
                      type="button"
                      className="mc-btn mc-btn-small"
                      onClick={() => {
                        if (window.confirm("确认删除该价格规则？"))
                          mutateDeleteRule.mutate(rule);
                      }}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </>
            )}
          />
        </section>
      ) : null}
    </div>
  );
}

function BatchStatusChip({
  status,
}: {
  status: BatchRow["status"];
}) {
  const map: Record<BatchRow["status"], string> = {
    DRAFT: "草稿",
    REVIEWED: "已复核",
    APPROVED: "已批准",
    PAID: "已支付",
    VOID: "已作废",
  };
  const toneMap: Record<BatchRow["status"], string> = {
    DRAFT: "pending",
    REVIEWED: "assigned",
    APPROVED: "running",
    PAID: "done",
    VOID: "cancelled",
  };
  return (
    <span className={`mc-status st-${toneMap[status]}`}>
      {map[status]}
    </span>
  );
}

function BatchActions({
  batch,
  disabled,
  onAction,
}: {
  batch: BatchRow;
  disabled: boolean;
  onAction: (action: string) => void;
}) {
  const button = (label: string, action: string) => (
    <button
      type="button"
      className="mc-btn mc-btn-small"
      disabled={disabled}
      onClick={() => onAction(action)}
    >
      {label}
    </button>
  );
  if (batch.status === "DRAFT") {
    return (
      <div className="mc-button-row">
        {button("复核", "review")}
        {button("作废", "void")}
      </div>
    );
  }
  if (batch.status === "REVIEWED") {
    return (
      <div className="mc-button-row">
        {button("批准", "approve")}
        {button("作废", "void")}
      </div>
    );
  }
  if (batch.status === "APPROVED") {
    return (
      <div className="mc-button-row">
        {button("登记线下支付", "pay")}
      </div>
    );
  }
  return <span className="mc-muted-text">已完成</span>;
}

function StatusText({ text }: { text: string }) {
  return <span className="mc-status st-done">{text}</span>;
}

function RecordTable<T>({
  loading,
  headers,
  rows,
  empty,
  renderRow,
}: {
  loading: boolean;
  headers: string[];
  rows: T[];
  empty: ReactNode;
  renderRow: (row: T) => ReactNode;
}) {
  return (
    <>
      {loading ? <p className="mc-loading-text">加载中…</p> : null}
      {!loading && rows.length === 0 ? (
        <div className="mc-empty">{empty}</div>
      ) : null}
      {!loading && rows.length > 0 ? (
        <div className="mc-table-wrap">
          <table>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>{renderRow(row)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function durationLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
    : `${minutes} 分钟`;
}

function useMemoFiltered<T>(
  rows: T[],
  keyword: string,
  text: (row: T) => string,
): T[] {
  const q = keyword.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => text(row).toLowerCase().includes(q));
}
