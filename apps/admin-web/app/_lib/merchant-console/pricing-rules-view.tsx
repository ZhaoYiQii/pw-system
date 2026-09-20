"use client";

/**
 * 算价模型（S6 Task 2）：店主 / 管理员维护「按游戏的加价规则」与「陪玩×游戏底价」。
 *
 * 规则（仓库 AGENTS「新增页面用新栈」+ ADR-0003）：
 * - 本页用新栈：Tailwind token + components/ui + TanStack Query，不用旧 .mc-* 类；
 * - 金额一律整数分：输入按「分」，旁边给「元」等值提示，不做浮点换算；
 * - 命中键是通用维度键（字段标识=选项值），一行一条加价，PUT 整表替换；
 * - 底价按「专属 → 陪玩级兜底 → 未设置」显示生效来源；未设置即该陪玩不能接这个游戏的单；
 * - 改规则只影响之后的选人计价，历史订单的单价快照不回写。
 */
import { useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Plus, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch } from "../api";
import {
  describePricingError,
  fetchGamePricingRule,
  fetchPlayerGameBase,
  saveGamePricingRule,
  savePlayerGameBase,
  type PlayerGameBaseView,
} from "./pricing-rules-api";
import {
  fenToYuan,
  parseAmountInput,
  playerBaseRow,
  playerBaseSourceLabel,
  ruleRowsFromView,
  toSaveBody,
  validateRuleRows,
  type RuleRow,
} from "./pricing-rules-state";

interface GameRow {
  id: string;
  name: string;
  enabled?: boolean;
}

interface PlayerRow {
  id: string;
  name: string;
}

export function PricingRulesModuleView() {
  const [gameId, setGameId] = useState("");
  const [rows, setRows] = useState<RuleRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const games = useQuery({
    queryKey: ["merchant", "pricing", "games"],
    queryFn: () => apiFetch<GameRow[]>("/api/v1/tenant/catalog/games"),
  });
  useEffect(() => {
    if (gameId === "" && games.data && games.data.length > 0) {
      setGameId(games.data[0]!.id);
    }
  }, [gameId, games.data]);

  const rule = useQuery({
    queryKey: ["merchant", "pricing", "rule", gameId],
    queryFn: () => fetchGamePricingRule(gameId),
    enabled: gameId !== "",
  });
  useEffect(() => {
    if (rule.data) setRows(ruleRowsFromView(rule.data));
  }, [rule.data]);

  const errors = useMemo(() => validateRuleRows(rows), [rows]);
  const save = useMutation({
    mutationFn: () => saveGamePricingRule(gameId, toSaveBody(rows)),
    onSuccess: (view) => {
      setRows(ruleRowsFromView(view));
      setNotice("已保存：之后的选人按新加价计价，历史订单单价不变。");
      void queryClient.invalidateQueries({
        queryKey: ["merchant", "pricing", "rule", gameId],
      });
    },
    onError: (error) => setNotice(describePricingError(error)),
  });

  const players = useQuery({
    queryKey: ["merchant", "pricing", "players"],
    queryFn: () => apiFetch<PlayerRow[]>("/api/v1/tenant/players"),
  });
  const baseViews = useQueries({
    queries: (players.data ?? []).map((player) => ({
      queryKey: ["merchant", "pricing", "base", player.id, gameId],
      queryFn: () => fetchPlayerGameBase(player.id, gameId),
      enabled: gameId !== "",
    })),
  });

  const selectedGame = games.data?.find((game) => game.id === gameId) ?? null;
  const ruleError = rule.error ? describePricingError(rule.error) : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            SETTINGS / PRICING
          </p>
          <h1 className="text-2xl font-semibold">算价模型</h1>
          <p className="text-sm text-muted-foreground">
            单价 = 底价（陪玩×游戏，缺省用陪玩级兜底）+
            命中的加价之和；金额一律整数分。
          </p>
        </div>
        <Badge variant="secondary">{rows.length} 条加价</Badge>
      </header>

      {notice ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md bg-muted px-3 py-2 text-sm"
        >
          {notice}
        </p>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">游戏</span>
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={gameId}
                onChange={(event) => {
                  setGameId(event.target.value);
                  setNotice(null);
                }}
              >
                <option value="">请选择游戏…</option>
                {(games.data ?? []).map((game) => (
                  <option key={game.id} value={game.id}>
                    {game.name}
                  </option>
                ))}
              </select>
            </label>
            {games.isLoading ? (
              <span className="text-sm text-muted-foreground">
                正在读取游戏…
              </span>
            ) : null}
            {selectedGame === null && gameId === "" && !games.isLoading ? (
              <span className="text-sm text-muted-foreground">
                还没有游戏：先到「服务目录」建游戏，再回来配加价。
              </span>
            ) : null}
          </div>

          {ruleError ? (
            <p className="text-sm text-destructive">{ruleError}</p>
          ) : null}

          <table className="w-full text-sm">
            <caption className="sr-only">该游戏的加价规则</caption>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-2">
                  命中键（字段标识=选项值）
                </th>
                <th scope="col" className="py-2">
                  加价（分/小时）
                </th>
                <th scope="col" className="py-2">
                  ≈ 元
                </th>
                <th scope="col" className="py-2 text-right">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-3 text-muted-foreground">
                    这个游戏还没有加价规则：没有命中项时单价就等于底价。
                  </td>
                </tr>
              ) : null}
              {rows.map((row, index) => {
                const rowErrors = errors.filter(
                  (error) => error.index === index,
                );
                return (
                  <tr key={index} className="border-t">
                    <td className="py-2 pr-3">
                      <Input
                        aria-label={`第 ${index + 1} 行命中键`}
                        value={row.dimensionKey}
                        placeholder="mode=ranked"
                        onChange={(event) => {
                          const next = [...rows];
                          next[index] = {
                            ...row,
                            dimensionKey: event.target.value,
                          };
                          setRows(next);
                        }}
                      />
                      {rowErrors
                        .filter((error) => error.field === "dimensionKey")
                        .map((error) => (
                          <span
                            key={error.message}
                            className="text-xs text-destructive"
                          >
                            {error.message}
                          </span>
                        ))}
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        aria-label={`第 ${index + 1} 行加价（分）`}
                        inputMode="numeric"
                        value={row.amountFen}
                        placeholder="1500"
                        onChange={(event) => {
                          const next = [...rows];
                          next[index] = {
                            ...row,
                            amountFen: event.target.value,
                          };
                          setRows(next);
                        }}
                      />
                      {rowErrors
                        .filter((error) => error.field === "amountFen")
                        .map((error) => (
                          <span
                            key={error.message}
                            className="text-xs text-destructive"
                          >
                            {error.message}
                          </span>
                        ))}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {parseAmountInput(row.amountFen) === null
                        ? "—"
                        : fenToYuan(row.amountFen)}
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`删除第 ${index + 1} 行`}
                        onClick={() =>
                          setRows(
                            rows.filter((_, position) => position !== index),
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setRows([
                  ...rows,
                  { kind: "SURCHARGE", dimensionKey: "", amountFen: "" },
                ])
              }
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              新增加价
            </Button>
            <Button
              size="sm"
              disabled={gameId === "" || errors.length > 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {save.isPending ? "保存中…" : "保存规则"}
            </Button>
            {errors.length > 0 ? (
              <span className="text-sm text-destructive">
                先修掉 {errors.length} 处校验错误再保存。
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-lg font-medium">陪玩×游戏底价</h2>
          <p className="text-sm text-muted-foreground">
            专属底价留空表示使用陪玩级兜底；两者都没有时，该陪玩不能接这个游戏的单（选人会被拒绝）。
          </p>
          {gameId === "" ? (
            <p className="text-sm text-muted-foreground">先选游戏。</p>
          ) : null}
          <table className="w-full text-sm">
            <caption className="sr-only">陪玩在该游戏的底价</caption>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-2">
                  陪玩
                </th>
                <th scope="col" className="py-2">
                  生效来源
                </th>
                <th scope="col" className="py-2">
                  当前底价（分/小时）
                </th>
                <th scope="col" className="py-2">
                  设置为
                </th>
                <th scope="col" className="py-2 text-right">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {(players.data ?? []).map((player, index) => {
                const query = baseViews[index];
                return (
                  <PlayerBaseRow
                    key={player.id}
                    gameId={gameId}
                    player={player}
                    view={query?.data ?? null}
                    loading={query?.isLoading ?? false}
                  />
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function PlayerBaseRow({
  gameId,
  player,
  view,
  loading,
}: {
  gameId: string;
  player: PlayerRow;
  view: PlayerGameBaseView | null;
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const row = playerBaseRow({
    playerId: player.id,
    playerName: player.name,
    view,
  });

  const save = useMutation({
    mutationFn: (basePricePerHourFen: string) =>
      savePlayerGameBase(player.id, gameId, {
        basePricePerHourFen,
        status: "ACTIVE",
      }),
    onSuccess: () => {
      setError(null);
      setDraft("");
      void queryClient.invalidateQueries({
        queryKey: ["merchant", "pricing", "base", player.id, gameId],
      });
    },
    onError: (mutationError) => setError(describePricingError(mutationError)),
  });

  const current =
    row.source === "GAME"
      ? (row.basePricePerHourFen ?? "—")
      : row.source === "FALLBACK"
        ? `${row.fallbackBasePricePerHourFen ?? "—"}（兜底）`
        : "—";

  return (
    <tr className="border-t">
      <td className="py-2">{player.name}</td>
      <td className="py-2">
        <Badge variant={row.source === "NONE" ? "destructive" : "secondary"}>
          {loading ? "读取中…" : playerBaseSourceLabel(row)}
        </Badge>
      </td>
      <td className="py-2">{current}</td>
      <td className="py-2">
        <Input
          aria-label={`${player.name} 的底价（分）`}
          inputMode="numeric"
          value={draft}
          placeholder="如 6000"
          onChange={(event) => setDraft(event.target.value)}
          className="w-32"
        />
        {error ? (
          <span className="text-xs text-destructive">{error}</span>
        ) : null}
      </td>
      <td className="py-2 text-right">
        <Button
          variant="outline"
          size="sm"
          disabled={save.isPending}
          onClick={() => {
            const parsed = parseAmountInput(draft);
            if (parsed === null) {
              setError("底价必须为非负整数分（如 6000）");
              return;
            }
            save.mutate(parsed);
          }}
        >
          保存
        </Button>
      </td>
    </tr>
  );
}
