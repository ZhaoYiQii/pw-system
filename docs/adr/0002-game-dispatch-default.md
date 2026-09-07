# ADR-0002：陪玩运营模块（game-dispatch）作为默认主线，旧 CLASSIC 流程冻结新功能

- 状态：已批准（用户 2026-09-07）
- 背景：仓库同时存在旧订单/派单流程（orders + dispatch + service_sessions + ledger `earning`）与陪玩运营新流程（game-dispatch + order_slots + slot_sessions + slot_earnings）。近期新增需求（老板钱包、档位收入、结算、收入/争议页）几乎都落在新流程，导致结算、收入、争议需同时兼容两套表与两套状态机。
- 候选方案：
  1. 立即合并两套数据模型 —— 风险高、需要历史数据迁移，暂缓。
  2. 冻结旧 CLASSIC 新功能，新流程成为默认主线，领域接口先收敛，再择机归档历史数据 —— 本 ADR 选择。
  3. 放任两套流程并行增长 —— 拒绝，继续扩大重复成本。
- 决策：
  1. `orders.process_type` 为业务路由第一级；`GAME_DISPATCH` 是默认新功能承载流程。
  2. CLASSIC（旧 `dispatch/service-sessions/ledger Earning`）只维护存量与兼容旧页面，不再接收新业务功能；新增收入、结算、证据、争议、报表等一律以 game-dispatch + slot_earnings 为主。
  3. 领域层统一引入“陪玩应收（player earning）”抽象，旧的 `earning` 与新的 `slot_earning` 分别实现，settlement/income/dispute 等上层只依赖该抽象。
  4. 不删除旧表、旧接口与旧页面；迁移与冻结均通过规则和 UI 引导完成。
- 理由：
  - 冻结旧流程可防止新功能写两遍；
  - 历史数据继续可用，风险可控；
  - 为后续正式合并保留回滚与并行期。
- 影响：后续 PR/切片开发必须遵守本 ADR；若某功能必须同时改动 CLASSIC 与 game-dispatch，应在计划中先说明兼容策略。
- 迁移方式：新功能默认 game-dispatch；CLASSIC 仅在用户明确要求时扩展。
- 回滚方式：本 ADR 只约束开发方向，不改数据，可随时撤销；已冻结的旧流程功能可恢复开发。
- 验证：后续“收入/争议/结算”功能在 game-dispatch 主链路上具备 integration 覆盖；旧流程集成测试保持绿以证明未破坏存量。
