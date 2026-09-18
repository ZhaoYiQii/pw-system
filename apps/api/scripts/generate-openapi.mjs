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
process.env.PAYMENT_PROVIDER ??= "mock";

const { buildApiDocument } = await import("../dist/openapi/contract.js");

/**
 * 把内联的判别联合提升为 $ref 组件，并补 discriminator.mapping。
 *
 * 为什么需要：Nest Swagger 把我方内联 schema 原样嵌进各 operation，联合成员不是 $ref，
 * 生成器（@hey-api/openapi-ts）在这种情况下只会把判别字段渲染成 `kind: string`。
 * 归一化后产出真正可判别的类型联合（`kind: "FIELD" | "REPEATABLE_TABLE" | "NOTE"`）。
 */
const UNION_COMPONENT_NAMES = {
  "FIELD|NOTE|REPEATABLE_TABLE": {
    FIELD: "TemplateFieldComponentV2",
    REPEATABLE_TABLE: "TemplateTableComponentV2",
    NOTE: "TemplateNoteComponentV2",
  },
  "FIXED|NUMBER_FIELD|REPEATABLE_TABLE_SUM": {
    FIXED: "TemplateStaffingFixedV2",
    NUMBER_FIELD: "TemplateStaffingNumberFieldV2",
    REPEATABLE_TABLE_SUM: "TemplateStaffingTableSumV2",
  },
};

function normalizeDiscriminatedUnions(document) {
  document.components ??= {};
  document.components.schemas ??= {};
  const schemas = document.components.schemas;
  let hoisted = 0;
  let unions = 0;

  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node === null || typeof node !== "object") return;

    if (Array.isArray(node.oneOf)) {
      const kinds = node.oneOf.map((member) => member?.properties?.kind?.const);
      if (kinds.every((kind) => typeof kind === "string")) {
        const key = [...kinds].sort().join("|");
        const names = UNION_COMPONENT_NAMES[key];
        if (names) {
          const mapping = {};
          node.oneOf = node.oneOf.map((member, index) => {
            const name = names[kinds[index]];
            const ref = `#/components/schemas/${name}`;
            if (!schemas[name]) {
              // 生成器不认 OpenAPI 3.1 的 const：判别字段转成单值 enum，
              // 否则仍会渲染成 `kind: string`，判别联合不成立。
              const discriminatorSchema = member?.properties?.kind;
              if (
                discriminatorSchema &&
                typeof discriminatorSchema.const === "string"
              ) {
                discriminatorSchema.enum = [discriminatorSchema.const];
                delete discriminatorSchema.const;
              }
              schemas[name] = member;
              hoisted += 1;
            }
            mapping[kinds[index]] = ref;
            return { $ref: ref };
          });
          node.discriminator = {
            ...(node.discriminator ?? {}),
            propertyName: "kind",
            mapping,
          };
          unions += 1;
        }
      }
    }

    for (const value of Object.values(node)) walk(value);
  };

  walk(document);
  return { hoisted, unions };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const yamlOutFile = path.resolve(here, "../../../openapi.yaml");
const jsonOutFile = path.resolve(here, "../../../openapi.json");
const document = await buildApiDocument();
const normalized = normalizeDiscriminatedUnions(document);
console.log(
  `discriminated unions normalized: ${normalized.unions} (hoisted components: ${normalized.hoisted})`,
);
await writeFile(yamlOutFile, stringify(document), "utf8");
await writeFile(jsonOutFile, JSON.stringify(document, null, 2), "utf8");
console.log(`openapi.yaml written: ${yamlOutFile}`);
console.log(`openapi.json written: ${jsonOutFile}`);
