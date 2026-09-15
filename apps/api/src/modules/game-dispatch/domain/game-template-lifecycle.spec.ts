import { describe, expect, it } from "vitest";
import {
  assertExpectedRevision,
  assertUniqueSemanticRoles,
  nextStatusAfterUnarchive,
} from "./game-template-lifecycle.js";

describe("game template lifecycle", () => {
  it("rejects duplicate non-custom semantic roles", () => {
    expect(() =>
      assertUniqueSemanticRoles([
        { fieldKey: "mode_primary", semanticRole: "MODE" },
        { fieldKey: "mode_backup", semanticRole: "MODE" },
      ]),
    ).toThrow("语义角色 MODE 只能配置一次");
  });

  it("allows multiple custom fields and a matching revision", () => {
    expect(() =>
      assertUniqueSemanticRoles([
        { fieldKey: "nickname", semanticRole: "CUSTOM" },
        { fieldKey: "note", semanticRole: "CUSTOM" },
      ]),
    ).not.toThrow();
    expect(() => assertExpectedRevision(4, 4)).not.toThrow();
  });

  it("rejects saving a stale draft revision", () => {
    expect(() => assertExpectedRevision(3, 4)).toThrow(
      "模板修订冲突：提交版本 3，当前版本 4",
    );
  });

  it("restores archived templates according to whether a published version exists", () => {
    expect(nextStatusAfterUnarchive("version-1")).toBe("PUBLISHED");
    expect(nextStatusAfterUnarchive(null)).toBe("DRAFT");
  });
});
