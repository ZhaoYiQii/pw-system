import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "openapi.yaml",
  output: {
    path: "packages/api-client/src",
    tsConfigPath: "packages/api-client/tsconfig.json"
  }
});
