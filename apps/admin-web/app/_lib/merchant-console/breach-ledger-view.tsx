"use client";

/**
 * P3 / D3：陪玩违约台账（只读，设计规格 §6）。
 *
 * 规则（仓库 AGENTS「新增页面用新栈」）：
 * - Tailwind token + components/ui + TanStack Query，不用旧 .mc-* 类；
 * - 只读：不提供撤销/申诉/封禁，也不做导出（已登记为后续项）；
 * - 筛选：时间范围（含当天，本地时区）与陪玩；分页用 offset/limit（默认 20）。
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "../api";
import {
  BREACH_PAGE_SIZE,
  buildBreachLedgerQuery,
} from "./breach-ledger-state";
import type { PlayerBreachRow, PlayerRow } from "./merchant-api";

export function BreachLedgerModuleView() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [offset, setOffset] = useState(0);

  const players = useQuery({
    queryKey: ["merchant", "players"],
    queryFn: () => apiFetch<PlayerRow[]>("/api/v1/tenant/players"),
  });

  const query = useMemo(
    () => buildBreachLedgerQuery({ from, to, playerId, offset }),
    [from, to, playerId, offset],
  );
  const rows = useQuery({
    queryKey: ["merchant", "breaches", query],
    queryFn: () =>
      apiFetch<PlayerBreachRow[]>(
        `/api/v1/tenant/game-dispatch/player-breaches?${query}`,
      ),
  });

  const data = rows.data ?? [];
  const hasPrev = offset > 0;
  const hasNext = data.length === BREACH_PAGE_SIZE;
  const playerNameById = new Map(
    (players.data ?? []).map((player) => [player.id, player.name] as const),
  );
  const dateTime = (value: string) => new Date(value).toLocaleString("zh-CN");

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          RECORDS / BREACHES
        </p>
        <h1 className="text-2xl font-semibold">陪玩违约</h1>
        <p className="text-sm text-muted-foreground">
          人工认定的放鸽子 / 未到场台账，只读；记录入口在订单详情的「记违约」。
        </p>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">起始日期</span>
            <Input
              type="date"
              aria-label="起始日期"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">结束日期</span>
            <Input
              type="date"
              aria-label="结束日期"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">陪玩</span>
            <select
              aria-label="陪玩"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              value={playerId}
              onChange={(event) => {
                setPlayerId(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">全部陪玩</option>
              {(players.data ?? []).map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            onClick={() => {
              setFrom("");
              setTo("");
              setPlayerId("");
              setOffset(0);
            }}
          >
            重置筛选
          </Button>
        </CardContent>
      </Card>

      {rows.isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            台账读取失败：请确认门店角色有「订单派单」权限后重试。
          </CardContent>
        </Card>
      ) : null}

      <Card data-testid="breach-ledger">
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>陪玩</TableHead>
                <TableHead>事由</TableHead>
                <TableHead>订单</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {dateTime(row.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.playerName ||
                      playerNameById.get(row.playerId) ||
                      row.playerId}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Badge variant="outline" className="mr-2">
                      违约
                    </Badge>
                    {row.reason}
                  </TableCell>
                  <TableCell className="text-sm">
                    <a
                      className="underline underline-offset-4"
                      href={`/merchant-console/dispatch/${row.orderId}`}
                    >
                      查看订单
                    </a>
                  </TableCell>
                </TableRow>
              ))}
              {!rows.isLoading && data.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    该筛选条件下没有违约记录。
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              第 {offset + 1} 条起，每页 {BREACH_PAGE_SIZE} 条
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!hasPrev}
                onClick={() =>
                  setOffset(Math.max(offset - BREACH_PAGE_SIZE, 0))
                }
              >
                上一页
              </Button>
              <Button
                variant="outline"
                disabled={!hasNext}
                onClick={() => setOffset(offset + BREACH_PAGE_SIZE)}
              >
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
