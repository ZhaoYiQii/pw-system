// 契约生成脚本：构建后的 dist 必须存在（先跑 tsc -p tsconfig.build.json）。
// 生成 openapi.yaml + openapi.json，不连接数据库、不启动端口；缺失的运行时配置使用显式占位。
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stringify } from "yaml";

process.env.DATABASE_URL ??=
  "postgresql://pw_runtime:openapi_generate_unused@127.0.0.1:5432/pw_openapi_generate";
process.env.PLATFORM_DATABASE_URL ??=
  "postgresql://pw:openapi_generate_unused@127.0.0.1:5432/pw_openapi_generate";
process.env.DATABASE_MIGRATION_URL ??=
  "postgresql://pw:openapi_generate_unused@127.0.0.1:5432/pw_openapi_generate";
process.env.SESSION_SECRET ??= "openapi-generate-only-secret-not-for-auth";

const { buildApiDocument } = await import("../dist/openapi/contract.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const yamlOutFile = path.resolve(here, "../../../openapi.yaml");
const jsonOutFile = path.resolve(here, "../../../openapi.json");
const document = await buildApiDocument();
await writeFile(yamlOutFile, stringify(document), "utf8");
await writeFile(jsonOutFile, JSON.stringify(document, null, 2), "utf8");
console.log(`openapi.yaml written: ${yamlOutFile}`);
console.log(`openapi.json written: ${jsonOutFile}`);
