# 未验证 / 待完成台账

用途：记录当前“未验证或未完成”的项与解除条件。条件满足后在对应切片完成，并在此更新（日期+证据）。

## A. 需第三方/账号/授权
| 项 | 状态日期 | 解除条件 |
|---|---|---|
| 微信小程序 weapp 真机/上线 | 2026-09-06 | 提供微信 AppID + 开发者工具 + 审核/发布授权（小程序开发暂缓） |
| mobile React 19 回归（现 React 18.3.1） | 2026-09-06 | Taro 上游支持 react@19 后独立升级任务 |
| 短信/企业微信通知、真实支付、AI Provider、生产对象存储 | 2026-09-06 | 到达对应切片并提供密钥/账号 |

## B. 需运行环境/后续切片
| 项 | 状态日期 | 解除条件 |
|---|---|---|
| H5 浏览器登录 E2E | 2026-09-06 | mobile H5 登录 UI 出现后执行（业务切片） |
| admin/mobile 运行态 E2E | 2026-09-06 | 运行中的 API + 真实域名；按验收以构建级为准 |
| 多实例登录限流（内存版单机） | 2026-09-06 | Slice 9 引入 Redis/BullMQ 后替换 |
| CSRF token 完整方案（当前 Origin/SameSite 校验） | 2026-09-06 | 认证完善切片 |
| CI 运行 integration/tenant-isolation（当前本地跑） | 2026-09-06 | CI 配置 PostgreSQL service（GitHub Actions）或外部库 |
| 平台角色独立凭据 + 审计（现 owner 连接串） | 2026-09-06 | Slice 11/平台切片 |
| Linux 容器化 + 应用 Dockerfile 验证 | 2026-09-06 | Slice 12 |

## C. 低优先级工程
| 项 | 状态日期 | 说明 |
|---|---|---|
| GitHub Actions actions（checkout/setup-node）Node20 注解 | 2026-09-06 | 升 v5 消除注解，非阻断 |
| npm CLI 本机缓存权限问题 | 2026-09-06 | 已用 pnpm（基线）替代，不阻塞 |

> 更新规则：每项完成时追加“完成日期 + 证据命令/退出码 + 责任切片”，不删除历史。
## D. Slice 3 剩余（2026-09-06 更新：Phase A+B 完成，剩余 UI/mobile）
- 完成：@pw/config-schema；tenant_config_versions/tenant_entitlements 迁移+RLS；tenant-config（版本化/回滚/CONFIG_ERROR 关闭）与 entitlements（core 常开、addon 默认关、门禁）API；契约测试（test:contract 3/3）。
- 剩余：admin 门店设置页（品牌 token/版本/回滚）、平台功能开关页；mobile runtime-config 品牌应用（运行态需 API+域名）