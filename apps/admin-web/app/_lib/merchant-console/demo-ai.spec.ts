import { describe, expect, it } from "vitest";
import { parseRequirementPreview } from "./demo-ai";

describe("demo AI requirement parser", () => {
  it("extracts game, mode and duration from plain text", () => {
    const preview = parseRequirementPreview(
      "林同学今晚8点 王者荣耀双排，2小时，找一个打野",
    );
    expect(preview.customer).toBe("林同学");
    expect(preview.game).toBe("王者荣耀");
    expect(preview.mode).toBe("娱乐双排");
    expect(preview.durationMinutes).toBe(120);
    expect(preview.roles).toEqual([{ name: "全能", need: 1 }]);
  });

  it("keeps customer and game explicit when text lacks them", () => {
    const preview = parseRequirementPreview("约四排 90 分钟");
    expect(preview.customer).toBe("待确认");
    expect(preview.game).toBe("待确认");
    expect(preview.mode).toBe("娱乐四排");
    expect(preview.roles).toEqual([{ name: "全能", need: 3 }]);
  });
});
