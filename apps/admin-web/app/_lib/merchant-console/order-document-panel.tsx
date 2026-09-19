"use client";

/**
 * S4 订单文案面板（新栈）。
 *
 * 只展示与复制服务端返回的内容：
 * - 有 v2 document 时渲染结构化表格并复制其 plainText；
 * - 旧订单没有 v2 文案时回退到历史 copyText，并显式说明来源；
 * - 复制结果通过 aria-live 播报，复制失败给出可读提示。
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  hasStructuredRows,
  orderDocumentCopyPayload,
  orderDocumentSourceLabel,
  type OrderDocumentView,
} from "./order-document";

export interface OrderDocumentPanelProps {
  document: OrderDocumentView | null;
  /** 旧订单的历史文案（legacy copyText）。 */
  fallbackText?: string;
  className?: string;
}

export function OrderDocumentPanel({
  document,
  fallbackText = "",
  className,
}: OrderDocumentPanelProps) {
  const [notice, setNotice] = useState("");
  const payload = orderDocumentCopyPayload(document, fallbackText);
  const rows = document?.rows ?? [];

  return (
    <Card className={className}>
      <CardContent className="space-y-3 p-4">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">派单文案</h2>
            <p className="text-xs text-muted-foreground">
              {orderDocumentSourceLabel(document)}
            </p>
          </div>
          {document !== null ? (
            <Badge variant="outline">文案 v{document.schemaVersion}</Badge>
          ) : null}
        </header>

        {hasStructuredRows(document) ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>区块</TableHead>
                <TableHead>字段</TableHead>
                <TableHead>值</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow
                  key={`${row.sectionLabel}-${row.fieldLabel}-${index}`}
                >
                  <TableCell>{row.sectionLabel}</TableCell>
                  <TableCell>{row.fieldLabel}</TableCell>
                  <TableCell>{row.value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-xs">
            {payload === "" ? "暂无文案" : payload}
          </pre>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={payload === ""}
            onClick={() => {
              void navigator.clipboard
                ?.writeText(payload)
                .then(() => setNotice("已复制派单文案"))
                .catch(() =>
                  setNotice("复制失败：浏览器未授权剪贴板，请手动选择文本"),
                );
            }}
          >
            复制派单文案
          </Button>
          {document !== null ? (
            <span className="font-mono text-xs text-muted-foreground">
              快照生成于 {document.generatedFromSnapshotAt}
            </span>
          ) : null}
        </div>

        <p
          role="status"
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          {notice}
        </p>
      </CardContent>
    </Card>
  );
}
