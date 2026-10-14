# F13–F17 服务层前置：已验证的接口与任务归属空白

## 固定代码基线

- PR #3 HEAD `2cef4a24960361706db7efa472dc5402da00e90c`，公开仓库 `23chen990/form-car-studio`；不是实时开发机的工作树快照，**Codex 完成 F12/F23 后需刷新 HEAD 重新确认**。
- 参照 `docs/form-handoff/specs/02-data-api.md` 的 V2 endpoint 清单、`docs/form-handoff/TASK_ROADMAP.md`、F13/F14/F16/F17 冻结任务卡。
- 现有注册点：`server/v2/routes-projects.ts:38,52,71,78`；`routes-plans.ts:35`；`routes-tasks.ts:53,57,60,63`；`routes-auth.ts:117,122,134,155`；`routes-trial.ts:49,53`。都是各自模块中的 handler，不代表 `server/app.ts` 已公开挂载它们。

## 最会妨碍完整前端体验的缺口

| 页面/行为 | S02 所需接口 | 2026-10-14 固定 HEAD 的发现 | 为什么不能由纯 UI 代替 |
|---|---|---|---|
| 返回用户首页/草稿/作品 | `GET /api/v2/bootstrap` | 检查现有五个 routes 模块未发现 | 不应从旧 `/api/*` 全量状态推断 V2 的能力版本、任务归属或用户作品 |
| 用户车库/作品详情 | `GET /api/v2/projects/:id`、`GET /api/v2/projects/:id/versions?cursor=…` | 相关独立 V2 handler 未出现 | 版本要带 owner、真实资产 ID 与有界分页；不能在前端从 localStorage 伪造用户项目 |
| 草稿自动保存、跨页恢复 | `PUT /api/v2/projects/:id/draft` | 只有 V2 DB drafts 表，当前 route 缺失 | optimistic `draftRevision` 冲突必须由持久化服务端判断 |
| 作品收藏、命名 | `PATCH /api/v2/versions/:id` | 当前独立 V2 route 缺失 | 收藏是 owner-scoped 元数据而不是替换 master、source 或 prompt |
| 项目更名、封面 | `PATCH /api/v2/projects/:id` | 当前独立 V2 route 缺失 | coverVersionId 需要同项目/owner 边界与删除后的生存规则 |
| 结果问题反馈 | `POST /api/v2/tasks/:id/feedback` | 当前独立 V2 route 缺失 | 仅登记受控类别，不自动加积分或确认退款 |
| 余额展示 | `GET /api/v2/wallet` | 当前独立 V2 route 缺失 | 余额/冻结值要从服务端账本读，不能前端推算或使用概念 demo 值 |

所有 `missing` 都是**“未在检查的当前 V2 路由模块找到”**，不是全库任何地方不可能有实现，也不能据此说工程测试已经失败。真实接口路由仍受 F32 接线与独立审核限制。

## 已有、必须复用的层

- F07/F12 相关：同意、项目创建、资产读取；`routes-projects.ts` 已有 POST `/consents`、POST `/projects`、GET `/assets/:assetId`。F12 完整 UI **在 Codex 执行中**，这里没有重放候选。
- F08/F11/F15：报价、task submit、submission lookup、task GET/cancel；`routes-plans.ts` / `routes-tasks.ts` / `src/lib/api-v2.ts` 已有对应隔离实现。
- V2 schema（`server/v2/schema.ts`）已有 projects/versions/drafts 等数据结构；**有表不等于相应 API 已完成**。
- F23 购买候选仍在 Codex 执行中，本预检不调整、重试或干扰；Apple/钱包的独立集成仍须审查。

## Owner 要审阅的最小“接口归属”修订（尚未批准）

**推荐方案：为 S02 已冻结要求补受审路由任务归属，不新增产品功能。** 当前 F13/F14/F16/F17 allowlist 全是 `src/features/*`、测试和 harness，均不允许修改 `server/v2/routes-*`；不应让 Codex 越权偷写。二选一：

1. **较清晰的做法：** 增设独立、有限预算的 Server Workspace/History 与 Server Draft/Favorites/Feedback 受审任务；明确允许新增相应 `server/v2` 路由、服务及测试，确定前端可依赖的稳定 DTO。把 F13/F14/F16/F17 所需依赖按顺序登记到任务图。余额和删除分别保留钱包与 F26 归属。
2. **不增加任务编号的做法：** 正式修订已有合适 Fxx 任务的 scope/allowlist/预算与依赖，**明确批准复工并独立回归**。不能将这种更改伪装成 F13 页面任务“顺带补后端”。

仍需要定的最小字段：bootstrap 中能力版本与 owner 对齐、项目 list 和版本 cursor、draft CAS 请求/冲突返回 DTO、favorite/name 修改的回显、失败/失联的幂等性、路由对 owner 的校验。**不要猜造全套 DTO 作为既有规范事实。**

## 立即可用的离线开发路径

即使 S02 接口归属尚未批准，F13–F17 的**组件级合成 props/适配器**仍可按冻结任务允许的 harness 方案准备和验证：所有未就绪网络服务都要显式 stub/disabled，不能暗中调用 legacy 后端或假定上线成功。正式端到端需等路由归属、F32 与审核。
