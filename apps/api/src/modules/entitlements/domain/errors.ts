export class UnknownFeatureError extends Error {
  constructor(key: string) {
    super(`unknown feature: ${key}`);
    this.name = "UnknownFeatureError";
  }
}

export class FeatureDisabledError extends Error {
  constructor(key: string) {
    super(`feature disabled: ${key}`);
    this.name = "FeatureDisabledError";
  }
}
