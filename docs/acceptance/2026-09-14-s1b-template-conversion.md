# S1b 通用派单模板转换验收记录

- 规格：`docs/superpowers/specs/2026-09-13-multi-game-dispatch-template-center-design.md`
- 实施计划：`docs/superpowers/plans/2026-09-14-generic-dispatch-template-s1b.md`
- 验收日期：2026-09-15
- 状态：locally-verified
- 环境：Windows 本机、Node.js 24.19.0、Corepack pnpm 10.34.5、Prisma 7.10.0、PostgreSQL 18
- 数据库：专用一次性本地数据库 `pw_saas_s1b_rehearsal_20260915_0428`
- 保留状态：数据库保留，未删除；`pw_saas`、`pw_saas_test` 和远程数据库未执行迁移或测试写入

## 迁移范围

- 演练前最后迁移：`20260913100000_multi_game_template_versions`
- S1b 主迁移：`20260914100000_generic_dispatch_template_config`
- 空值语义向前修复：`20260915090000_s1b_config_pair_check_null_semantics`
- 迁移方式：先应用 S1 及以前迁移，插入固定 UUID 的虚构旧模板夹具，再应用 S1b 主迁移；集成测试发现 PostgreSQL `CHECK` 的 NULL 结果会被接受后，增加向前修复迁移并重新验证
- 兼容性：只增加列、枚举值和 CHECK；不删除旧表、旧列、v1 发布版本或旧订单快照
- 回滚：共享库不执行破坏性 down migration；代码回退时保留可空新增列，后续问题使用新的向前迁移修复

## 转换审计

审计查询只输出计数、模板 ID、转换状态和问题码，不输出完整草稿 JSON、文案、订单值或联系人信息。

- 模板总数：4
- v2 草稿数：4
- `READY`：3
- `NEEDS_REVIEW`：1
- 问题码：`TARGET_RANK_OPTION_UNMATCHED` × 1
- 模板状态：
  - `00000000-0000-4000-8000-000000000101` — `READY`
  - `00000000-0000-4000-8000-000000000102` — `READY`
  - `00000000-0000-4000-8000-000000000103` — `NEEDS_REVIEW`
  - `00000000-0000-4000-8000-000000000104` — `READY`
- 保持 schemaVersion 1 的发布版本：1
- 保持 v2 新列为空的旧快照：1
- 已验证 S1b CHECK：4
- 新增 JSON GIN 索引：0
- 仍启用且强制 RLS 的目标表：2
- 失败测试残留租户：0

## 验证命令与结果

连接数据库的命令均通过进程环境变量指向上述一次性数据库；本记录不保存连接串或凭据。

| 验证 | 命令摘要 | 退出码 | 关键结果 |
| --- | --- | ---: | --- |
| 领域联合测试 | 本地 Vitest 启动器运行 lifecycle、values、config-v2、calculations、document | 0 | 5 文件、25 用例通过 |
| S1→S1b 演练 | `node scripts/rehearse-game-dispatch-template-s1b.mjs` | 0 | 29 个迁移应用成功；templates=4、validatedChecks=4、protectedTables=2 |
| 向前修复迁移 | Prisma `migrate deploy`，目标为专用一次性数据库 | 0 | `20260915090000_s1b_config_pair_check_null_semantics` 应用成功 |
| 迁移与 RLS 集成测试 | 本地 Vitest 启动器 + `tests/vitest.integration.config.ts` | 0 | 1 文件、9 用例通过 |
| database typecheck | `corepack pnpm --filter @pw/database typecheck` | 0 | TypeScript 无错误 |
| API typecheck | `corepack pnpm --filter @pw/api typecheck` | 0 | TypeScript 无错误 |
| Prisma generate | `corepack pnpm --filter @pw/database generate` | 0 | Prisma Client 7.10.0 生成成功 |
| 定向 ESLint | 本地 ESLint 启动器检查 S1b 领域、集成测试和演练脚本 | 0 | 无问题 |
| TS/JS Prettier | 本地 Prettier 启动器定向检查 | 0 | 所有匹配文件符合格式 |
| exact-scope whitespace | `git diff --check -- <S1b paths>` | 0 | 无空白错误；schema 文件提示 Git 将在下次写入时规范为 LF |
| 根级单测 | `corepack pnpm test` | 0 | 25 文件通过、93 用例通过；1 个既有 Redis 用例跳过 |

## 发现与修复

1. 演练脚本最初假定 Prisma CLI 位于根 `node_modules`。仓库实际把 Prisma 安装在 `packages/database/node_modules`，已修正路径；失败发生在连接数据库前，目标库当时仍为空。脚本现按顺序复制 S1b 主迁移和空值语义向前修复迁移，避免未来新演练库漏掉修复。
2. 初版 JSON/version 配对 CHECK 在版本为 NULL 时整体求值为 NULL，而 PostgreSQL CHECK 接受 NULL。已通过新的向前迁移增加显式 `IS NOT NULL`，非法配对集成测试现已通过。
3. 失败用例创建的无模板快照会阻止测试清理订单。测试现先删除自己租户范围内的模板快照，再删除订单；上次失败留下的虚构夹具已按两个明确租户 ID 在事务中清理。
4. 当前 Windows/Corepack 环境的 `pnpm exec` 未把根 `node_modules/.bin` 注入子进程 PATH。测试、ESLint 和 Prettier 使用同一仓库内的精确本地启动器执行；根级 `corepack pnpm test` 可正常运行。
5. 当前 Prettier 未配置 Prisma/SQL parser，因此 `.prisma` 和 `.sql` 不能由 Prettier 判型。TypeScript、JavaScript、Markdown 由 Prettier 检查；Prisma schema 由 Prisma generate 验证；SQL 与完整范围由 `git diff --check` 检查。未安装新依赖。

## 安全与边界结论

- v2 草稿新增列沿用模板行的租户边界；A 租户无法读取或更新 B 租户模板。
- v1 发布版本和历史快照未被原地升级。
- 可无歧义绑定的旧价格规则进入普通选择项加价；不能绑定的规则保留并进入人工复核，未猜测价格映射。
- 自动文案领域测试证明只输出受限纯文本，并保持同一快照和值的确定性。
- 本次未修改 API、OpenAPI、admin UI、mobile UI，未执行 Git commit/push 或部署。
