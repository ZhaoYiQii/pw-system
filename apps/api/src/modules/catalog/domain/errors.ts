export class CatalogNotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = "CatalogNotFoundError";
  }
}

export class DuplicateCatalogEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateCatalogEntryError";
  }
}

export class InvalidCatalogInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCatalogInputError";
  }
}

export class CatalogInUseError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} is in use: ${id}`);
    this.name = "CatalogInUseError";
  }
}