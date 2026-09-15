"use client";

/**
 * 「业务绑定与计算」标签（S3 Task 4）。
 *
 * - 人数来源：固定人数 / 数字字段 / 表格列汇总，全部按 stableKey 绑定；
 * - 选项加价：填写整数分，界面同时显示换算后的元（仅展示）；
 * - 即时校验：与发布校验一致的问题在这里先摆出来，并可定位到区块/组件；
 * - 服务端仍是唯一权威：这里只做即时反馈。
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  DraftConfigV2,
  DraftFieldComponentV2,
} from "./template-draft-state";
import {
  collectDraftIssues,
  formatFenToYuan,
  mapIssuesToLocation,
  setOptionPrice,
  setStaffingSource,
  staffingCandidates,
  type LocatedIssue,
} from "./template-binding";

export interface TemplateEditorBindingProps {
  draft: DraftConfigV2;
  onChange: (next: DraftConfigV2) => void;
  onNotice: (message: string) => void;
  onLocate: (issue: LocatedIssue) => void;
}

export function TemplateEditorBinding({
  draft,
  onChange,
  onNotice,
  onLocate,
}: TemplateEditorBindingProps) {
  const candidates = staffingCandidates(draft);
  const numberCandidates = candidates.filter(
    (candidate) => candidate.kind === "NUMBER_FIELD",
  );
  const tableCandidates = candidates.filter(
    (candidate) => candidate.kind === "REPEATABLE_TABLE_SUM",
  );
  const source = draft.staffingSource;

  const applySource = (next: Parameters<typeof setStaffingSource>[1]) => {
    const result = setStaffingSource(draft, next);
    if (!result.ok) {
      onNotice(result.reason);
      return;
    }
    onChange(result.config);
    onNotice("已更新人数来源。");
  };

  const choiceFields = draft.components.filter(
    (component): component is DraftFieldComponentV2 =>
      component.kind === "FIELD" &&
      (component.fieldType === "SINGLE_SELECT" ||
        component.fieldType === "MULTI_SELECT"),
  );

  const issues = mapIssuesToLocation(draft, collectDraftIssues(draft));

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">人数来源</h3>
        <p className="text-xs text-muted-foreground">
          人数由服务端按发布快照计算：绑定的是稳定键（stableKey），改名不会影响结果。
        </p>

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="staffing-source"
              checked={source.kind === "FIXED"}
              onChange={() => applySource({ kind: "FIXED", count: 1 })}
            />
            固定人数
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="staffing-source"
              checked={source.kind === "NUMBER_FIELD"}
              onChange={() => {
                const first = numberCandidates[0];
                if (!first) {
                  onNotice(
                    "还没有可用的数字字段：去「内容设计」加一个数字字段，再回来绑定。",
                  );
                  return;
                }
                applySource({
                  kind: "NUMBER_FIELD",
                  componentKey: first.componentKey,
                });
              }}
            />
            数字字段
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="staffing-source"
              checked={source.kind === "REPEATABLE_TABLE_SUM"}
              onChange={() => {
                const first = tableCandidates[0];
                if (!first?.columnKey) {
                  onNotice(
                    "还没有可汇总的表格列：插入「岗位与人数」预设，或把表格列语义设为“人数”。",
                  );
                  return;
                }
                applySource({
                  kind: "REPEATABLE_TABLE_SUM",
                  componentKey: first.componentKey,
                  columnKey: first.columnKey,
                });
              }}
            />
            表格列汇总
          </label>
        </div>

        {source.kind === "FIXED" ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            人数
            <Input
              className="h-8 w-24"
              type="number"
              min={1}
              value={source.count}
              onChange={(event) =>
                applySource({
                  kind: "FIXED",
                  count: Number(event.target.value),
                })
              }
            />
          </label>
        ) : null}

        {source.kind === "NUMBER_FIELD" ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            选择数字字段
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={source.componentKey}
              onChange={(event) =>
                applySource({
                  kind: "NUMBER_FIELD",
                  componentKey: event.target.value,
                })
              }
            >
              {numberCandidates.map((candidate) => (
                <option
                  key={candidate.componentKey}
                  value={candidate.componentKey}
                >
                  {candidate.label}（{candidate.stableKeyLabel}）
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {source.kind === "REPEATABLE_TABLE_SUM" ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            选择汇总列
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={`${source.componentKey}.${source.columnKey}`}
              onChange={(event) => {
                const [componentKey, columnKey] = event.target.value.split(".");
                applySource({
                  kind: "REPEATABLE_TABLE_SUM",
                  componentKey: componentKey as string,
                  columnKey: columnKey as string,
                });
              }}
            >
              {tableCandidates.map((candidate) => (
                <option
                  key={`${candidate.componentKey}.${candidate.columnKey}`}
                  value={`${candidate.componentKey}.${candidate.columnKey}`}
                >
                  {candidate.label}（{candidate.stableKeyLabel}）
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {numberCandidates.length === 0 && tableCandidates.length === 0 ? (
          <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
            当前没有可用的人数来源组件。可以：① 在「内容设计」加一个数字字段； ②
            插入「岗位与人数」预设（会自动绑定表格人数列）。
          </p>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">选项加价</h3>
        <p className="text-xs text-muted-foreground">
          填写整数分（例如 1500 =
          ¥15.00）。金额只接受十进制字符串，服务端按发布快照计算。
        </p>

        {choiceFields.length === 0 ? (
          <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
            还没有选择字段。可以在「内容设计」插入「选择项加价」预设，或把字段类型设为单选/多选。
          </p>
        ) : null}

        {choiceFields.map((field) => (
          <div
            key={field.stableKey}
            className="space-y-2 rounded-md bg-muted/30 p-3"
          >
            <p className="text-sm font-medium">
              {field.label}
              <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                {field.stableKey}
              </span>
            </p>
            {(field.options ?? []).map((option) => (
              <div
                key={`${field.stableKey}-${option.value}`}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="min-w-[120px] text-sm">{option.label}</span>
                <Input
                  aria-label={`${option.label} 加价（分）`}
                  className="h-8 w-28 font-mono"
                  inputMode="numeric"
                  value={option.priceDeltaFen ?? ""}
                  placeholder="0"
                  onChange={(event) => {
                    const raw = event.target.value.trim();
                    const result = setOptionPrice(
                      draft,
                      field.stableKey,
                      option.value,
                      raw === "" ? null : raw,
                    );
                    if (!result.ok) {
                      onNotice(result.reason);
                      return;
                    }
                    onChange(result.config);
                  }}
                />
                <span className="font-mono text-xs text-muted-foreground">
                  分 ≈ ¥{formatFenToYuan(option.priceDeltaFen ?? "0")}
                </span>
                {option.priceDeltaFen === undefined ? (
                  <Badge variant="outline">无加价</Badge>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">
          校验问题
          {issues.length > 0 ? (
            <Badge variant="secondary" className="ml-2">
              {issues.length}
            </Badge>
          ) : null}
        </h3>
        {issues.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            当前草稿通过即时校验（发布时服务端仍会再校验一次）。
          </p>
        ) : (
          <ul className="space-y-2">
            {issues.map((issue, index) => (
              <li
                key={`${issue.code}-${index}`}
                className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2 text-xs"
              >
                <Badge variant="outline">{issue.code}</Badge>
                <span className="flex-1">{issue.message}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onLocate(issue)}
                >
                  定位
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
