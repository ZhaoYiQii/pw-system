# ADR-0001：Admin 前端渐进式迁移到新技术栈

- 状态：已批准（用户 2026-09-07 选择方案 B：渐进式迁移）
- 背景：管理后台目前是 Next.js + 自建 CSS/`useEffect+fetch`。用户计划后续持续用 AI 增加/修改 UI 与功能，认为越早统一技术栈，后续迁移成本越低；同时不希望一次性全量迁移中断开发。
- 决策：
  1. admin 前端新栈基线 = Tailwind v4 token + shadcn/ui 风格组件 + TanStack Query；Zustand 仅在出现共享全局状态时引入。
  2. 所有新增/重写页面使用新栈；旧页面在被修改时随改动迁移到新栈，避免新旧类混用。
  3. 未被触碰的旧页面不主动迁移；旧 `globals.css` 遗留样式只能在确认无使用方后单独清理。
  4. 移动端 Taro 不引入 Tailwind/shadcn；若引入 TanStack Query/Zustand 需单独 ADR。
  5. 迁移不得改变后端契约、金额、权限、租户隔离或门禁；每次迁移均需 admin typecheck/lint/build 通过。
- 已落地样板：`apps/admin-web/components/ui/*`、`apps/admin-web/lib/utils.ts`、Tailwind token 注入 `apps/admin-web/app/globals.css`、客户页 `apps/admin-web/app/(tenant)/customers/page.tsx` 使用新栈。
- 影响：规则写入仓库 `AGENTS.md`；后续新增任务默认遵守，不再需要每次询问选型。
- 回滚：新栈为增量文件；若终止迁移，保留旧页面即可，旧样式不删除。
