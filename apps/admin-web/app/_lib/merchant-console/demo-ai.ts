import type { AiDraftSpec, DemoSeatRole } from "./demo-data";

const GAME_NAMES = ["王者荣耀", "和平精英", "永劫无间", "英雄联盟"] as const;

function findGame(text: string): string | null {
  return GAME_NAMES.find((game) => text.includes(game)) ?? null;
}

function parseMode(text: string): { mode: string; roles: DemoSeatRole[] } {
  if (text.includes("四排")) {
    return { mode: "娱乐四排", roles: [{ name: "全能", need: 3 }] };
  }
  if (text.includes("三排")) {
    return { mode: "娱乐三排", roles: [{ name: "全能", need: 2 }] };
  }
  if (text.includes("开黑")) {
    return { mode: "娱乐开黑", roles: [{ name: "全能", need: 1 }] };
  }
  return { mode: "娱乐双排", roles: [{ name: "全能", need: 1 }] };
}

function parseDuration(text: string): number {
  const hours = /(\d+)\s*(?:小时|h)/i.exec(text);
  if (hours) {
    return Number(hours[1]) * 60;
  }
  const minutes = /(\d+)\s*(?:分钟|min)/i.exec(text);
  if (minutes) {
    return Number(minutes[1]);
  }
  return 120;
}

function parseCustomer(text: string): string {
  const match = /([\u4e00-\u9fa5A-Za-z0-9]{1,8})同学/.exec(text);
  return match ? `${match[1]}同学` : "待确认";
}

/**
 * 纯前端演示解析：仅用关键词生成结构化建议。
 * 接入后端 AI 接口后由服务端结果替换，不构成业务承诺。
 */
export function parseRequirementPreview(text: string): AiDraftSpec {
  const modeSpec = parseMode(text);
  return {
    customer: parseCustomer(text),
    game: findGame(text) ?? "待确认",
    mode: modeSpec.mode,
    durationMinutes: parseDuration(text),
    roles: modeSpec.roles,
  };
}
