"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Image, Lock } from "lucide-react";
import { useDemoStore } from "./demo-store";
import { DemoDialog, DemoEmptyState, useDemoToast } from "./demo-ui";
import { getRecordModule, type RecordModuleId } from "./record-data";
import { useMerchantRole } from "./role-context";

export function RecordDetailView({
  moduleId,
  recordId,
}: {
  moduleId: RecordModuleId;
  recordId: string;
}) {
  const config = getRecordModule(moduleId);
  const row = config?.rows.find((item) => item.id === recordId);
  const { toast, showToast } = useDemoToast();
  const { recordOverrides, setRecordStatus } = useDemoStore();
  const [actionOpen, setActionOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState<number | null>(null);
  const { role } = useMerchantRole();

  if (!config || !row) {
    return (
      <section className="mc-panel">
        <DemoEmptyState
          title="没有找到这条记录"
          description="返回列表查看其它演示记录。"
        >
          <Link href={`/merchant-console/${moduleId}`} className="mc-btn">
            返回{config?.title ?? "列表"}
          </Link>
        </DemoEmptyState>
      </section>
    );
  }

  const facts = [
    { label: "编号", value: row.no },
    { label: "对象 / 标题", value: row.title },
    { label: "关键信息", value: row.info },
    { label: "金额 / 时间", value: row.amount },
  ];

  const override = recordOverrides[`${moduleId}:${row.id}`];
  const statusLabel = override?.statusLabel ?? row.statusLabel;
  const statusTone = override?.tone ?? row.tone;
  const actionAvailable = canRunAction(moduleId, role);
  const activeEvidence =
    evidenceOpen === null ? null : row.evidence?.[evidenceOpen];

  const runAction = () => {
    const action = config.primaryAction;
    if (!action) return;
    if (action.nextLabel && action.nextTone) {
      setRecordStatus(moduleId, row.id, action.nextLabel, action.nextTone);
    }
    setActionOpen(false);
    showToast(
      action.nextLabel
        ? `已${action.nextLabel} · 原型状态更新`
        : "演示动作完成 · 未调用后端",
    );
  };

  return (
    <div>
      <Link href={`/merchant-console/${moduleId}`} className="mc-back">
        <ArrowLeft size={15} />
        返回{config.title}
      </Link>

      <div className="mc-pagehead mc-detail-head">
        <div>
          <div className="mc-kicker">{config.kicker}</div>
          <div className="mc-detail-title">
            <h1 className="mc-mono">{row.no}</h1>
            <span className={`mc-status st-${statusTone}`}>{statusLabel}</span>
          </div>
          <p>{row.title}</p>
        </div>
      </div>

      <div className="mc-record-grid">
        <div>
          <section className="mc-panel mc-facts">
            {facts.map((fact) => (
              <dl className="mc-fact" key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </dl>
            ))}
          </section>

          <section className="mc-panel">
            <div className="mc-section-head">
              <div>
                <h2>{moduleId === "sessions" ? "场次时间线" : "业务时间线"}</h2>
                <p>事件与服务器时间 · 不可篡改</p>
              </div>
            </div>
            <div className="mc-record-timeline">
              {row.timeline?.length ? (
                <ol className="mc-timeline">
                  {row.timeline.map((event) => (
                    <li
                      key={`${event.time}-${event.title}`}
                      className={
                        event.state === "done"
                          ? "done"
                          : event.state === "now"
                            ? "now"
                            : undefined
                      }
                    >
                      <time>{event.time}</time>
                      <b>{event.title}</b>
                      <p>{event.desc}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <ol className="mc-timeline mc-timeline-placeholder">
                  {config.timelinePlaceholder.map((step) => (
                    <li key={step}>
                      <time>接入后</time>
                      <b>{step}</b>
                      <p>由对应后端接口的时间线事件填充（演示模板）。</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          {moduleId === "sessions" && row.evidence?.length ? (
            <section className="mc-panel mc-evidence-panel">
              <div className="mc-section-head">
                <div>
                  <h2>证据</h2>
                  <p>上传后服务端校验图片与租户归属</p>
                </div>
              </div>
              <div className="mc-ev-grid">
                {row.evidence.map((evidence, index) => (
                  <button
                    type="button"
                    className="mc-ev-card"
                    key={evidence.name}
                    onClick={() => setEvidenceOpen(index)}
                  >
                    <span className="mc-ev-thumb">
                      <Image size={18} aria-hidden="true" />
                      截图占位
                    </span>
                    <span className="mc-ev-meta">
                      <b>{evidence.name}</b>
                      <span>
                        {evidence.time} · {evidence.uploader}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="mc-panel mc-review mc-record-rail">
          <div className="mc-review-top">
            <h2>详情动作</h2>
            <span>{actionAvailable ? "按角色开放" : "只读"}</span>
          </div>
          <div className="mc-review-group">
            <div className="mc-summary-line">
              <span>当前状态</span>
              <b>{statusLabel}</b>
            </div>
            <div className="mc-summary-line">
              <span>数据来源</span>
              <b>演示</b>
            </div>
          </div>

          {config.primaryAction && actionAvailable ? (
            <button
              type="button"
              className="mc-btn mc-btn-primary mc-review-confirm"
              onClick={() => setActionOpen(true)}
            >
              {config.primaryAction.label}
            </button>
          ) : (
            <div className="mc-review-note mc-record-readonly">
              <Lock size={13} aria-hidden="true" />
              当前角色只读此模块动作；写权限由后端权限接口开放后显示。
            </div>
          )}

          <div className="mc-notice">
            本页是统一详情模板。具体业务表单、批量操作与真实时间线在后续切片按接口补齐。
          </div>
        </aside>
      </div>

      {config.primaryAction ? (
        <DemoDialog
          open={actionOpen}
          title={config.primaryAction.dialogTitle}
          confirmLabel={config.primaryAction.confirmLabel}
          onCancel={() => setActionOpen(false)}
          onConfirm={runAction}
        >
          <p>{config.primaryAction.dialogBody}</p>
          <div className="mc-summary-line">
            <span>{row.no}</span>
            <b>{row.title}</b>
          </div>
        </DemoDialog>
      ) : null}

      {activeEvidence ? (
        <DemoDialog
          open
          title={activeEvidence.name}
          confirmLabel="下载"
          onCancel={() => setEvidenceOpen(null)}
          onConfirm={() => {
            setEvidenceOpen(null);
            showToast("演示：下载将校验租户与角色后返回预签名链接");
          }}
        >
          <div className="mc-ev-detail">
            <span className="mc-ev-placeholder">
              <Image size={22} aria-hidden="true" />
              待接入真实附件
            </span>
            <span>
              <div className="mc-summary-line">
                <span>上传时间</span>
                <b>{activeEvidence.time}</b>
              </div>
              <div className="mc-summary-line">
                <span>操作者</span>
                <b>{activeEvidence.uploader}</b>
              </div>
              <div className="mc-summary-line">
                <span>文件</span>
                <b className="mc-mono">evidence-{row.id}.jpg</b>
              </div>
              <div className="mc-notice">
                下载链接有效期 5 分钟；下载时校验租户与角色。
              </div>
            </span>
          </div>
        </DemoDialog>
      ) : null}

      {toast}
    </div>
  );
}

function canRunAction(moduleId: RecordModuleId, role: string): boolean {
  if (role === "OWNER") return true;
  if (moduleId === "sessions") return role === "ADMIN" || role === "CS";
  if (moduleId === "settlements") return role === "FINANCE";
  if (moduleId === "audit" || moduleId === "finance") return false;
  return role === "ADMIN" || role === "CS";
}
