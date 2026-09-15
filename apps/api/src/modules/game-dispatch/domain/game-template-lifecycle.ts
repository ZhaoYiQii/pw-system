import {
  GameTemplateRevisionConflictError,
  InvalidGameTemplateError,
} from "./errors.js";
import type {
  GameTemplateSemanticRole,
  GameTemplateStatus,
} from "./game-template.js";

export interface SemanticRoleField {
  fieldKey: string;
  semanticRole: GameTemplateSemanticRole;
}

export function assertUniqueSemanticRoles(
  fields: readonly SemanticRoleField[],
): void {
  const claimed = new Set<GameTemplateSemanticRole>();
  for (const field of fields) {
    if (field.semanticRole === "CUSTOM") continue;
    if (claimed.has(field.semanticRole)) {
      throw new InvalidGameTemplateError(
        "语义角色 " + field.semanticRole + " 只能配置一次",
      );
    }
    claimed.add(field.semanticRole);
  }
}

export function assertExpectedRevision(
  expectedRevision: number,
  currentRevision: number,
): void {
  if (expectedRevision !== currentRevision) {
    throw new GameTemplateRevisionConflictError(
      expectedRevision,
      currentRevision,
    );
  }
}

export function nextStatusAfterUnarchive(
  activeVersionId: string | null,
): GameTemplateStatus {
  return activeVersionId ? "PUBLISHED" : "DRAFT";
}
