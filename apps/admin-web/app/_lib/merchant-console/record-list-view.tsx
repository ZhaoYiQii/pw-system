"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { useDemoStore } from "./demo-store";
import {
  RECORD_MODULES,
  type RecordListRow,
  type RecordModuleId,
} from "./record-data";
import { DemoEmptyState } from "./demo-ui";
import { useMerchantRole } from "./role-context";

export function RecordListView({ moduleId }: { moduleId: RecordModuleId }) {
  const config = RECORD_MODULES[moduleId];
  const { role } = useMerchantRole();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return config.rows;
    return config.rows.filter((row) =>
      [row.no, row.title, row.info, row.amount].some((text) =>
        text.toLowerCase().includes(keyword),
      ),
    );
  }, [config.rows, query]);

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">{config.kicker}</div>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
        </div>
        <span className="mc-chip">
          演示数据 <b>未接后端</b>
        </span>
      </div>

      {moduleId === "audit" && role === "FINANCE" ? (
        <div className="mc-notice mc-record-readonly">
          财务仅可查看审计日志中涉自身记录（只读 ·
          涉自身）；行级过滤由后端授权接口执行。
        </div>
      ) : null}

      <section className="mc-panel">
        <div className="mc-filterbar">
          <div className="mc-filter-row">
            <label className="mc-searchbox">
              <Search size={15} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`搜索${config.title}…`}
                aria-label={`搜索${config.title}`}
              />
            </label>
            <span className="mc-muted-text">
              共 {config.rows.length} 条演示 · 后端就绪后替换
            </span>
          </div>
        </div>

        {rows.length ? (
          <div className="mc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>编号</th>
                  <th>对象 / 标题</th>
                  <th>关键信息</th>
                  <th>金额 / 时间</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <RecordRow key={row.id} moduleId={moduleId} row={row} />
                ))}
              </tbody>
            </table>
            <div className="mc-table-foot">
              <span>
                显示 {rows.length} / {config.rows.length} 条
              </span>
              <span>统一列表模板 · 演示数据</span>
            </div>
          </div>
        ) : (
          <DemoEmptyState
            title="没有符合条件的记录"
            description="调整搜索文字后重试。"
          >
            <button
              type="button"
              className="mc-btn"
              onClick={() => setQuery("")}
            >
              清空搜索
            </button>
          </DemoEmptyState>
        )}
      </section>
    </div>
  );
}

function RecordRow({
  moduleId,
  row,
}: {
  moduleId: RecordModuleId;
  row: RecordListRow;
}) {
  const { recordOverrides } = useDemoStore();
  const override = recordOverrides[`${moduleId}:${row.id}`];
  const statusLabel = override?.statusLabel ?? row.statusLabel;
  const statusTone = override?.tone ?? row.tone;

  return (
    <tr>
      <td>
        <Link
          href={`/merchant-console/${moduleId}/${row.id}`}
          className="mc-order-link"
        >
          {row.no}
        </Link>
      </td>
      <td>
        <b className="mc-cell-title">{row.title}</b>
      </td>
      <td>
        <span>{row.info}</span>
      </td>
      <td>
        <span className="mc-mono">{row.amount}</span>
      </td>
      <td>
        <span className={`mc-status st-${statusTone}`}>{statusLabel}</span>
      </td>
      <td>
        <Link
          href={`/merchant-console/${moduleId}/${row.id}`}
          className="mc-btn mc-btn-ghost mc-btn-small"
        >
          查看详情
          <ArrowRight size={13} />
        </Link>
      </td>
    </tr>
  );
}
