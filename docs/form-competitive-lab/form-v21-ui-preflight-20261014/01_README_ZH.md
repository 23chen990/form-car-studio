# FORM｜F13–F17 提前准备包（2026-10-14）

**状态：独立离线预检 / UI RFC 与 API 归属候选 / NOT_IMPLEMENTATION_APPROVED**

## 已经实际完成

1. 对照 FORM V2.2 S01/S02/S05、`shared/v2/edit-plan.ts`、`server/v2/routes-*.ts`、`src/lib/api-v2.ts`，在固定 PR #3 HEAD `2cef4a24960361706db7efa472dc5402da00e90c` 上列出 **26 条 S02 规定的 API** 与其实现/任务状态；见 `data/api_surface_audit.json`。
2. 查到现有 `src/lib/api-v2.ts` 仅封装了同意、创建项目、报价、提交/恢复任务、查询/取消任务，尚没有历史、草稿 CAS、收藏等客户端封装。当前 `server/app.ts` 仍以 legacy 入口为主；**独立 V2 handler 存在不等于 F32 已接入**。
3. 发现离线 V2.1 概念设计与已冻结 S01 的冲突：整体 Style Explore 首发请求 **不可附加前置颜色专家修改**；`server/v2/plans.ts` 215–216 行当前会拒绝并报 `EXPLORE_OVERRIDES_UNSUPPORTED`。设计需拆为“整体风格探索”与“直接修改已支持细节”两条请求意图。
4. 完成**无网络、无依赖**的 UI 意图参考工具及单元测试。它不读取用户照片、不管理计费、不代替 `parseEditRequest`/真实后端，只服务于 QA 断言与设计评审。
5. 提出最小 S05 UI 变更评审点和 S02 endpoint owner 的最小分组；这些是待 Owner 审阅方案，**不改变**冻结 43 文件、行数上限或任务图。

## 阅读顺序

- `02_ENGINEERING_GAPS_ZH.md`：能马上避免 F13–F17 重复返工的具体阻断、已有 API 与精确源码定位。
- `03_UI_RFC_FIXES_ZH.md`：修正 V2.1 已认可视觉方案中与现有模型请求合同冲突的地方。
- `04_ACCEPTANCE_AND_CODEX_HANDOFF_ZH.md`：F12/F23 完成后 Codex 的一次性交接（**现在不要重启它们**）。
- `data/api_surface_audit.json`：逐 endpoint 的真实状态与建议任务归属。
- `reference/ui_intent_oracle.mjs`、`tests/*.test.mjs`：离线、合成语义测试，供正式 Playwright/Node 测试适配，不是生产代码。

运行：`node --test tests/*.test.mjs`（Node 22.16）。此处 27 项是**参考工具与登记数据测试**，不是 FORM 源码/browser/iPhone/AI/支付集成测试。

## 防火墙

本包不修改 PR #3 正在做的 F12/F23，不合并任何 PR，不触发真实上传、模型生成、StoreKit、部署或数据库迁移。不复制竞品源码/素材，亦不把 FORM V2.1 概念车图当作实测结果。S05 审批前不得把新深色工作室改写为生产视觉规范。
