export class GameTemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`game template not found: ${id}`);
    this.name = "GameTemplateNotFoundError";
  }
}

export class DuplicateGameTemplateError extends Error {
  constructor(name: string) {
    super(`游戏模板已存在：${name}`);
    this.name = "DuplicateGameTemplateError";
  }
}

export class InvalidGameTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGameTemplateError";
  }
}
