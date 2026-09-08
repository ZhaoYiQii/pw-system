"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Clipboard, Copy } from "lucide-react";
import {
  buildCopyText,
  COPY_LABEL,
  neededCount,
  orderNo,
  ORDER_STAGE,
  selectedPlayers,
  shortageFor,
  totalShortage,
  type DemoOrder,
  type DemoOrderStatus,
} from "./demo-data";
import {
  DemoDialog,
  DemoEmptyState,
  DemoStatusBadge,
  useDemoToast,
} from "./demo-ui";
import { useDemoStore } from "./demo-store";
import { useMerchantRole } from "./role-context";

type CopyType = "group" | "selected" | "apply" | "boss";
type PendingAction = "publish" | "confirm" | "settle" | null;

const STEP_LABELS = [
  "待发布",
  "报名选人",
  "已选定",
  "服务中",
  "待核算",
  "已完成",
];

export function OrderDetailView({ orderId }: { orderId: string }) {
  const {
    orders,
    publishOrder,
    completeOrder,
    confirmSelections,
    removeApplicant,
  } = useDemoStore();
  const { role } = useMerchantRole();
  const { toast, showToast } = useDemoToast();
  const [picks, setPicks] = useState<string[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const order = orders.find((item) => item.id === orderId);
  const canOperate = role === "OWNER" || role === "ADMIN" || role === "CS";

  useEffect(() => {
    setPicks([]);
  }, [orderId]);

  const picksSet = useMemo(() => new Set(picks), [picks]);

  if (!order) {
    return (
      <section className="mc-panel">
        <DemoEmptyState
          title="没有找到这张派单"
          description="它可能已随演示数据重置，返回订单台账查看。"
        >
          <Link href="/merchant-console/dispatch" className="mc-btn">
            返回订单台账
          </Link>
        </DemoEmptyState>
      </section>
    );
  }

  const togglePick = (applicantId: string) => {
    setPicks((prev) =>
      prev.includes(applicantId)
        ? prev.filter((id) => id !== applicantId)
        : [...prev, applicantId],
    );
  };

  const copy = async (type: CopyType) => {
    const text = buildCopyText(order, type);
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${COPY_LABEL[type]} 已复制 · 原型演示`);
    } catch {
      showToast("浏览器未允许剪贴板，请在接入后使用复制按钮");
    }
  };

  const stage = ORDER_STAGE[order.status];
  const selected = selectedPlayers(order);
  const chosen = order.players.filter((player) => picks.includes(player.id));
  const missAfterPicks = totalShortage(order, picks);

  return (
    <div>
      <Link href="/merchant-console/dispatch" className="mc-back">
        <ArrowLeft size={15} />
        返回订单与派单
      </Link>

      <div className="mc-pagehead mc-detail-head">
        <div>
          <div className="mc-kicker">ORDER DETAIL</div>
          <div className="mc-detail-title">
            <h1 className="mc-mono">{orderNo(order)}</h1>
            <DemoStatusBadge status={order.status} />
          </div>
          <p>
            {order.game} · {order.mode}
          </p>
        </div>
        <button
          type="button"
          className="mc-btn"
          onClick={() => void copy("group")}
        >
          <Clipboard size={15} />
          群派单文案
        </button>
      </div>

      <div className="mc-steps" aria-label="订单状态步骤">
        {STEP_LABELS.map((label, index) => (
          <div
            key={label}
            className={`mc-step${
              stage === index ? " current" : stage > index ? " done" : ""
            }`}
          >
            <strong>{String(index + 1).padStart(2, "0")}</strong>
            {label}
          </div>
        ))}
      </div>

      <div className="mc-detailgrid">
        <div>
          <section className="mc-panel mc-facts">
            <dl className="mc-fact">
              <dt>客户</dt>
              <dd>{order.customer}</dd>
            </dl>
            <dl className="mc-fact">
              <dt>计划时长</dt>
              <dd>{order.duration} 分钟</dd>
            </dl>
            <dl className="mc-fact">
              <dt>{order.time.includes(":") ? "预约时间" : "服务进度"}</dt>
              <dd className="mc-mono">{order.time}</dd>
            </dl>
            <dl className="mc-fact">
              <dt>岗位需求</dt>
              <dd>
                {order.roles
                  .map((roleItem) => `${roleItem.name} ${roleItem.need}`)
                  .join(" / ")}
              </dd>
            </dl>
          </section>

          {order.status === "DISPATCHING" ? (
            <>
              <SeatsPanel order={order} picks={picks} />
              <ApplicantsPanel
                order={order}
                picks={picks}
                picksSet={picksSet}
                canOperate={canOperate}
                onToggle={togglePick}
                onRemove={(applicantId) => {
                  removeApplicant(order.id, applicantId);
                  setPicks((prev) => prev.filter((id) => id !== applicantId));
                  showToast(`已移除报名 · 仅原型演示`);
                }}
              />
            </>
          ) : (
            <StateCard
              order={order}
              canOperate={canOperate}
              onPublish={() => setPendingAction("publish")}
              onSettle={() => setPendingAction("settle")}
              roleLabel={role}
            />
          )}

          {order.status !== "DISPATCHING" &&
          !["DRAFT", "CONFIRMED", "CANCELLED"].includes(order.status) ? (
            <SeatsPanel order={order} picks={[]} />
          ) : null}
        </div>

        <ReviewRail
          order={order}
          selected={selected}
          chosen={chosen}
          missAfterPicks={missAfterPicks}
          canOperate={canOperate}
          onCopy={(type) => void copy(type)}
          onConfirm={() => setPendingAction("confirm")}
        />
      </div>

      <DemoDialog
        open={pendingAction === "publish"}
        title="发布派单"
        confirmLabel="发布派单"
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          publishOrder(order.id);
          setPendingAction(null);
          showToast("派单已发布 · 原型状态已更新");
        }}
      >
        <p>
          {orderNo(order)} · {order.game} · {order.mode}
        </p>
        <div className="mc-summary-line">
          <span>岗位需求</span>
          <b>
            {order.roles
              .map((roleItem) => `${roleItem.name} ${roleItem.need} 人`)
              .join("、")}
          </b>
        </div>
        <div className="mc-notice">发布后将开放 10 分钟报名（演示规则）。</div>
      </DemoDialog>

      <DemoDialog
        open={pendingAction === "confirm"}
        title="复核本次人选"
        confirmLabel="确认选人"
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          confirmSelections(order.id, picks);
          setPicks([]);
          setPendingAction(null);
          showToast(
            missAfterPicks
              ? "人选已确认 · 剩余岗位继续报名"
              : "人选已确认 · 队伍已选定",
          );
        }}
      >
        <p>以下人选将确认为 {orderNo(order)} 的服务人选。</p>
        {chosen.map((player) => (
          <div className="mc-summary-line" key={player.id}>
            <b>{player.name}</b>
            <span>{player.role}</span>
          </div>
        ))}
        <div className="mc-notice">
          {missAfterPicks
            ? `确认后仍缺 ${missAfterPicks} 人，订单保持报名选人。`
            : "岗位全部补齐，订单将进入已选定。"}
        </div>
      </DemoDialog>

      <DemoDialog
        open={pendingAction === "settle"}
        title="核算预览"
        confirmLabel="模拟确认"
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          completeOrder(order.id);
          setPendingAction(null);
          showToast("已模拟确认核算 · 未实际扣费");
        }}
      >
        <span className="mc-status st-dispatch">演示金额 · 未实际扣费</span>
        <p style={{ marginTop: 10 }}>
          以下金额只用于展示核算界面，不是服务端结果。
        </p>
        <div className="mc-summary-line">
          <span>计划时长</span>
          <b>{order.duration} 分钟</b>
        </div>
        <div className="mc-summary-line">
          <span>订单扣费（示例）</span>
          <b>¥120.00</b>
        </div>
        <div className="mc-summary-line">
          <span>扣费后余额（示例）</span>
          <b>¥380.00</b>
        </div>
        <div className="mc-notice">订单扣费与收入确认不代表已向陪玩付款。</div>
      </DemoDialog>

      {toast}
    </div>
  );
}

function StateCard({
  order,
  canOperate,
  onPublish,
  onSettle,
  roleLabel,
}: {
  order: DemoOrder;
  canOperate: boolean;
  onPublish: () => void;
  onSettle: () => void;
  roleLabel: string;
}) {
  const state: Record<
    DemoOrderStatus,
    { title: string; description: string; action?: "publish" | "settle" }
  > = {
    DRAFT: {
      title: "等待发布",
      description: "确认需求与岗位人数后开放 10 分钟报名。",
      action: "publish",
    },
    CONFIRMED: {
      title: "等待发布",
      description: "确认需求与岗位人数后开放 10 分钟报名。",
      action: "publish",
    },
    ASSIGNED: {
      title: "队伍已选定",
      description: "人员已确认，等待服务开始；预约时间不代表已开始计时。",
    },
    IN_PROGRESS: {
      title: "服务进行中",
      description: "实际时长由服务端记录，完成后进入费用核对。",
    },
    PENDING_CONFIRMATION: {
      title: "等待核对费用",
      description: "服务已结束，请核对实际时长、订单扣费与收入确认。",
      action: "settle",
    },
    COMPLETED: {
      title: "订单已完成",
      description: "订单核算已确认；陪玩付款仍由财务结算批次处理。",
    },
    CANCELLED: {
      title: "订单已取消",
      description: "报名和后续操作已经关闭。",
    },
    DISPATCHING: {
      title: "报名选人中",
      description: "从报名人选中选择并确认队伍席位。",
    },
  };

  const meta = state[order.status];
  return (
    <section className="mc-panel mc-state-card">
      <h2>{meta.title}</h2>
      <p>{meta.description}</p>
      {meta.action && canOperate ? (
        <div className="mc-button-row">
          <button
            type="button"
            className="mc-btn mc-btn-primary"
            onClick={meta.action === "publish" ? onPublish : onSettle}
          >
            {meta.action === "publish" ? "发布派单" : "查看核算演示"}
          </button>
        </div>
      ) : null}
      {meta.action && !canOperate ? (
        <p className="mc-state-note">
          当前为 {roleLabel} 只读视角，写操作待后端权限接口就绪后开放。
        </p>
      ) : null}
      <div className="mc-state-note">
        <b>服务需求</b>
        <br />
        {order.game} · {order.mode} ·{" "}
        {order.roles
          .map((roleItem) => `${roleItem.name} ${roleItem.need} 人`)
          .join(" / ")}
      </div>
    </section>
  );
}

function SeatsPanel({ order, picks }: { order: DemoOrder; picks: string[] }) {
  const selectedCount = order.players.filter(
    (player) => player.status === "SELECTED",
  ).length;
  return (
    <>
      <div className="mc-seat-head">
        <div>
          <h2>队伍席位</h2>
          <p>每个岗位独立计算名额</p>
        </div>
        <span className="mc-mono">
          {selectedCount} / {neededCount(order)} 已确认
        </span>
      </div>
      <div className="mc-seats">
        {order.roles.map((roleItem) => {
          const members = order.players.filter(
            (player) =>
              player.role === roleItem.name &&
              (player.status === "SELECTED" || picks.includes(player.id)),
          );
          const miss = Math.max(
            0,
            roleItem.need -
              members.filter(
                (player) =>
                  player.status === "SELECTED" || picks.includes(player.id),
              ).length,
          );
          return (
            <section
              className={`mc-seat${miss > 0 ? " open" : ""}`}
              key={roleItem.name}
            >
              <div className="mc-seat-top">
                <b>{roleItem.name}</b>
                <span className="mc-mono">
                  {members.length} / {roleItem.need}
                </span>
              </div>
              {members.map((player) => (
                <div className="mc-person" key={player.id}>
                  <span className="mc-avatar mc-avatar-sm" aria-hidden="true">
                    {player.name.slice(0, 1)}
                  </span>
                  <span>
                    <b>{player.name}</b>
                    <small>
                      {player.status === "SELECTED" ? "已确认" : "本次暂选"}
                    </small>
                  </span>
                  {player.status === "SELECTED" ? (
                    <span className="mc-seat-ok">
                      <Check size={13} />
                      已就位
                    </span>
                  ) : null}
                </div>
              ))}
              {Array.from({ length: miss }, (_, index) => (
                <div className="mc-person mc-empty-seat" key={`empty-${index}`}>
                  <span className="mc-avatar mc-avatar-sm" aria-hidden="true">
                    +
                  </span>
                  <span>
                    <b>等待{roleItem.name}</b>
                    <small>从报名人选中选择</small>
                  </span>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

function ApplicantsPanel({
  order,
  picks,
  picksSet,
  canOperate,
  onToggle,
  onRemove,
}: {
  order: DemoOrder;
  picks: string[];
  picksSet: Set<string>;
  canOperate: boolean;
  onToggle: (applicantId: string) => void;
  onRemove: (applicantId: string) => void;
}) {
  return (
    <section className="mc-panel mc-applicants">
      <div className="mc-section-head">
        <div>
          <h2>报名人选</h2>
          <p>报名截止后仍可确认已有报名</p>
        </div>
        <span className="mc-sub">原型演示 · 实时报名待后端推送</span>
      </div>
      {order.roles.map((roleItem) => {
        const applicants = order.players.filter(
          (player) =>
            player.role === roleItem.name && player.status === "APPLIED",
        );
        if (!applicants.length) return null;
        const remaining = shortageFor(order, roleItem.name, picks);
        return (
          <div key={roleItem.name}>
            <div className="mc-role-label">
              <span>
                {roleItem.name} · 需要 {roleItem.need} 人
              </span>
              <span>
                {remaining ? `还可选 ${remaining} 人` : "本岗位暂选已满"}
              </span>
            </div>
            {applicants.map((player) => {
              const chosen = picksSet.has(player.id);
              const full = remaining <= 0 && !chosen;
              return (
                <div
                  className={`mc-candidate${chosen ? " chosen" : ""}`}
                  key={player.id}
                >
                  <input
                    type="checkbox"
                    id={`pick-${player.id}`}
                    checked={chosen}
                    disabled={!canOperate || full}
                    onChange={() => onToggle(player.id)}
                  />
                  <label htmlFor={`pick-${player.id}`}>
                    <span className="mc-avatar mc-avatar-sm" aria-hidden="true">
                      {player.name.slice(0, 1)}
                    </span>
                    <span>
                      <b>{player.name}</b>
                      <small>
                        {player.role} · {player.at} 报名
                      </small>
                    </span>
                  </label>
                  {chosen ? (
                    <span className="mc-status st-dispatch">本次暂选</span>
                  ) : null}
                  {canOperate ? (
                    <button
                      type="button"
                      className="mc-remove"
                      onClick={() => onRemove(player.id)}
                    >
                      移除
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}

function ReviewRail({
  order,
  selected,
  chosen,
  missAfterPicks,
  canOperate,
  onCopy,
  onConfirm,
}: {
  order: DemoOrder;
  selected: ReturnType<typeof selectedPlayers>;
  chosen: DemoOrder["players"];
  missAfterPicks: number;
  canOperate: boolean;
  onCopy: (type: CopyType) => void;
  onConfirm: () => void;
}) {
  const dispatching = order.status === "DISPATCHING";
  const copyItems: CopyType[] = ["group", "selected", "apply", "boss"];
  return (
    <aside className="mc-panel mc-review">
      <div className="mc-review-top">
        <h2>{dispatching ? "确认人选" : "订单摘要"}</h2>
        <span>{dispatching && canOperate ? "复核后提交" : ""}</span>
      </div>

      {dispatching ? (
        <>
          <div className="mc-review-group">
            <div className="mc-review-label">已确认 · {selected.length} 人</div>
            {selected.length ? (
              selected.map((player) => (
                <div className="mc-review-person" key={player.id}>
                  <b>{player.name}</b>
                  <span>{player.role}</span>
                </div>
              ))
            ) : (
              <div className="mc-review-empty">暂无已确认人选</div>
            )}
          </div>
          <div className="mc-review-group">
            <div className="mc-review-label">本次暂选 · {chosen.length} 人</div>
            {chosen.length ? (
              chosen.map((player) => (
                <div className="mc-review-person" key={player.id}>
                  <b>{player.name}</b>
                  <span>{player.role}</span>
                </div>
              ))
            ) : (
              <div className="mc-review-empty">从左侧报名中选择</div>
            )}
          </div>
          {canOperate ? (
            <>
              <div className="mc-shortage">
                {missAfterPicks
                  ? `确认后仍缺 ${missAfterPicks} 人，订单继续报名。`
                  : "所有岗位已补齐，确认后进入已选定。"}
              </div>
              <button
                type="button"
                className="mc-btn mc-btn-primary mc-review-confirm"
                disabled={chosen.length === 0}
                onClick={onConfirm}
              >
                确认选人{chosen.length ? ` · ${chosen.length} 人` : ""}
              </button>
              <p className="mc-review-note">
                支持部分确认；开始计时后才进入服务中。
              </p>
            </>
          ) : (
            <p className="mc-review-note">
              财务只读视角，选人操作由客服/店长完成。
            </p>
          )}
        </>
      ) : (
        <div className="mc-review-group">
          <div className="mc-summary-line">
            <span>客户</span>
            <b>{order.customer}</b>
          </div>
          <div className="mc-summary-line">
            <span>计划时长</span>
            <b>{order.duration} 分钟</b>
          </div>
          <div className="mc-summary-line">
            <span>岗位</span>
            <b>
              {order.roles
                .map((roleItem) => `${roleItem.name} ${roleItem.need}`)
                .join(" / ")}
            </b>
          </div>
        </div>
      )}

      <div className="mc-tools">
        {copyItems.map((type) => (
          <button type="button" key={type} onClick={() => onCopy(type)}>
            <span>{COPY_LABEL[type]}</span>
            <Copy size={13} />
          </button>
        ))}
      </div>
      {!dispatching && !canOperate ? (
        <p className="mc-review-note">
          当前为只读视角；发布与核算按钮由后端权限接口开放。
        </p>
      ) : null}
    </aside>
  );
}
