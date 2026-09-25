/**
 * 商家端 P0：三台导航注册表 + UI 权限 mock。
 * 数据源：design-demos/ui-templates/merchant/merchant-console-full.html
 * 契约：后续后端 /me/permissions（或等价接口）就绪后，仅替换权限来源，不重做 UI。
 *
 * 这个文件名是注册表的稳定入口（`docs/adr/0008-tabulator-data-grid.md` 与
 * `docs/specs/merchant-navigation-information-architecture-v1.md` 按文件名引用它），
 * 实现按「数据 / 逻辑」拆到四个同级文件，导出在此汇总。
 *
 * 必须用 `export *`：`packages/tsconfig/base.json` 开了 `isolatedModules`，
 * 具名重导出类型（`export { type X } from`）会直接编译报错，`export *` 不受此限。
 */
export * from "./nav-registry";
export * from "./nav-domains";
export * from "./nav-access";
export * from "./nav-breadcrumb";
