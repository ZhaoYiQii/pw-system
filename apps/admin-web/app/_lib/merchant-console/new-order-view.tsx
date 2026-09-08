"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Save, ShieldAlert, X } from "lucide-react";
import type { DemoSeatRole } from "./demo-data";
import { useDemoStore } from "./demo-store";
import { useMerchantRole } from "./role-context";

const GAME_OPTIONS = ["王者荣耀", "和平精英", "永劫无间", "英雄联盟"] as const;

const MODE_OPTIONS = ["娱乐双排", "娱乐三排", "娱乐四排", "娱乐开黑"] as const;

export function NewOrderView() {
  const router = useRouter();
  const { role } = useMerchantRole();
  const { aiDraft, createDraft } = useDemoStore();

  const canOperate = role === "OWNER" || role === "ADMIN" || role === "CS";
  const [customer, setCustomer] = useState(aiDraft?.customer ?? "");
  const [game, setGame] = useState<string>(aiDraft?.game ?? GAME_OPTIONS[0]);
  const [mode, setMode] = useState<string>(aiDraft?.mode ?? MODE_OPTIONS[0]);
  const [durationMinutes, setDurationMinutes] = useState<number>(
    aiDraft?.durationMinutes ?? 120,
  );
  const [roles, setRoles] = useState<DemoSeatRole[]>(
    aiDraft?.roles.length
      ? aiDraft.roles.map((roleItem) => ({ ...roleItem }))
      : [{ name: "全能", need: 1 }],
  );
  const [error, setError] = useState<string | null>(null);

  if (!canOperate) {
    return (
      <section className="mc-panel mc-forbidden">
        <div className="mc-forbidden-mark" aria-hidden="true">
          <ShieldAlert size={26} />
        </div>
        <h1>只读角色 · 403</h1>
        <p>
          当前为财务视角，仅可查看订单与结算；新建派单由店老板、店长或客服操作。
        </p>
        <Link href="/merchant-console/dispatch" className="mc-btn">
          回到订单台账
        </Link>
      </section>
    );
  }

  const updateRole = (index: number, patch: Partial<DemoSeatRole>) => {
    setRoles((prev) =>
      prev.map((roleItem, roleIndex) =>
        roleIndex === index ? { ...roleItem, ...patch } : roleItem,
      ),
    );
  };

  const submit = () => {
    if (!customer.trim() || !game.trim() || !mode.trim()) {
      setError("客户、游戏与服务模式不能为空");
      return;
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1) {
      setError("计划时长需大于 0 分钟");
      return;
    }
    if (
      roles.length === 0 ||
      roles.some((roleItem) => !roleItem.name.trim() || roleItem.need < 1)
    ) {
      setError("至少保留一个有效岗位席位");
      return;
    }
    const draft = createDraft({
      customer: customer.trim(),
      game: game.trim(),
      mode: mode.trim(),
      durationMinutes,
      roles: roles.map((roleItem) => ({
        name: roleItem.name.trim(),
        need: roleItem.need,
      })),
    });
    router.push(`/merchant-console/dispatch/${draft.id}`);
  };

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">ORDER CREATE</div>
          <h1>新建派单</h1>
          <p>先保存为草稿，在订单详情确认岗位后发布开放报名。</p>
        </div>
        <Link href="/merchant-console/dispatch" className="mc-btn">
          返回订单台账
        </Link>
      </div>

      <section className="mc-panel mc-form-panel">
        <div className="mc-form-grid">
          <label className="mc-field">
            <span>客户</span>
            <input
              value={customer}
              onChange={(event) => setCustomer(event.target.value)}
              placeholder="例如：林同学"
              autoComplete="off"
            />
          </label>
          <label className="mc-field">
            <span>游戏</span>
            <select
              value={game}
              onChange={(event) => setGame(event.target.value)}
            >
              {GAME_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="mc-field">
            <span>服务模式</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="mc-field">
            <span>计划时长（分钟）</span>
            <input
              type="number"
              min={1}
              step={10}
              value={durationMinutes}
              onChange={(event) =>
                setDurationMinutes(Number(event.target.value))
              }
            />
          </label>
        </div>

        <div className="mc-seat-editor">
          <div className="mc-seat-editor-head">
            <div>
              <h2>岗位席位</h2>
              <p>每个岗位独立计算名额，发布后按岗位报名</p>
            </div>
            <button
              type="button"
              className="mc-btn mc-btn-small"
              onClick={() =>
                setRoles((prev) => [...prev, { name: "全能", need: 1 }])
              }
            >
              <Plus size={14} />
              添加岗位
            </button>
          </div>
          <div className="mc-role-editor-rows">
            {roles.map((roleItem, index) => (
              <div
                className="mc-role-editor-row"
                key={`${index}-${roleItem.name}`}
              >
                <label className="mc-field">
                  <span>岗位名称</span>
                  <input
                    value={roleItem.name}
                    onChange={(event) =>
                      updateRole(index, { name: event.target.value })
                    }
                    placeholder="例如：打野 / 辅助 / 全能"
                  />
                </label>
                <label className="mc-field mc-field-narrow">
                  <span>需要人数</span>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={roleItem.need}
                    onChange={(event) =>
                      updateRole(index, { need: Number(event.target.value) })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="mc-btn mc-btn-ghost mc-btn-icon-only"
                  aria-label={`移除岗位 ${roleItem.name}`}
                  onClick={() =>
                    setRoles((prev) =>
                      prev.filter((_, roleIndex) => roleIndex !== index),
                    )
                  }
                  disabled={roles.length <= 1}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {error ? <p className="mc-form-error">{error}</p> : null}

        <div className="mc-notice">
          创建结果只保存在当前前端原型的内存中，刷新后恢复演示数据；后端就绪后由真实订单接口替换。
        </div>

        <div className="mc-button-row mc-form-actions">
          <button
            type="button"
            className="mc-btn mc-btn-primary"
            onClick={submit}
          >
            <Save size={15} />
            保存为草稿
          </button>
        </div>
      </section>
    </div>
  );
}
