"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Sparkles, WandSparkles } from "lucide-react";
import type { AiDraftSpec } from "./demo-data";
import { parseRequirementPreview } from "./demo-ai";
import { useDemoToast } from "./demo-ui";
import { useDemoStore } from "./demo-store";

const SAMPLE_TEXT = "今晚8点 王者荣耀双排，2小时，找一个打野";

export function AiAssistantView() {
  const router = useRouter();
  const { setAiDraft } = useDemoStore();
  const { toast, showToast } = useDemoToast();
  const [text, setText] = useState(SAMPLE_TEXT);
  const [preview, setPreview] = useState<AiDraftSpec | null>(null);

  const parse = () => {
    if (!text.trim()) {
      showToast("请先粘贴一段客户需求");
      return;
    }
    setPreview(parseRequirementPreview(text));
  };

  const bringToNewOrder = () => {
    if (!preview) return;
    setAiDraft(preview);
    router.push("/merchant-console/dispatch/new");
  };

  return (
    <div>
      <div className="mc-pagehead">
        <div>
          <div className="mc-kicker">ASSISTANT / AI</div>
          <h1>AI 需求助手</h1>
          <p>
            粘贴一段客户需求，先得到结构化建议，再由客服人工确认后进入订单。
          </p>
        </div>
        <span className="mc-chip">
          演示解析 <b>未接后端</b>
        </span>
      </div>

      <div className="mc-ai-grid">
        <section className="mc-panel mc-ai-panel">
          <div className="mc-section-head">
            <div>
              <h2>客户需求原文</h2>
              <p>支持粘贴聊天记录或语音转文字片段</p>
            </div>
          </div>
          <div className="mc-ai-body">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="例如：今晚8点 王者荣耀双排 2小时 需要一个打野"
              aria-label="客户需求原文"
            />
            <div className="mc-button-row">
              <button
                type="button"
                className="mc-btn mc-btn-primary"
                onClick={parse}
              >
                <WandSparkles size={15} />
                解析为结构化建议
              </button>
            </div>
          </div>
        </section>

        <section className="mc-panel mc-ai-panel">
          <div className="mc-section-head">
            <div>
              <h2>解析预览</h2>
              <p>客服核对后才会创建订单</p>
            </div>
            {preview ? (
              <span className="mc-status st-running">已生成</span>
            ) : null}
          </div>
          <div className="mc-ai-body">
            {preview ? (
              <div>
                <div className="mc-summary-line">
                  <span>客户</span>
                  <b>{preview.customer}</b>
                </div>
                <div className="mc-summary-line">
                  <span>游戏 / 模式</span>
                  <b>
                    {preview.game} · {preview.mode}
                  </b>
                </div>
                <div className="mc-summary-line">
                  <span>计划时长</span>
                  <b>{preview.durationMinutes} 分钟</b>
                </div>
                <div className="mc-summary-line">
                  <span>岗位需求</span>
                  <b>
                    {preview.roles
                      .map((role) => `${role.name} ${role.need} 人`)
                      .join("、")}
                  </b>
                </div>
                <div className="mc-button-row mc-ai-actions">
                  <button
                    type="button"
                    className="mc-btn mc-btn-primary"
                    onClick={bringToNewOrder}
                  >
                    带入新建订单
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="mc-empty mc-empty-compact">
                <Sparkles size={22} aria-hidden="true" />
                <p>解析结果会显示在这里，可继续编辑后带入订单。</p>
              </div>
            )}
          </div>
        </section>
      </div>
      {toast}
    </div>
  );
}
