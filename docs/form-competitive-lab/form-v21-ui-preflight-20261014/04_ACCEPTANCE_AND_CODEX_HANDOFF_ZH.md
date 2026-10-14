# 给 Codex 的 F13–F17 一次性交接（待 F12 完成后使用）

**当前请继续正在进行的 F12/F23；本包不会重新下发这两个任务，也不允许中断/覆盖 Codex 的工作树。**

## 优先级与执行边界

0. 收到本包先读 PR #3 当前最新 HEAD、已批准的 F12/F23 修订与任务卡。不要假设此处的 `2cef4a2` 仍是最新，也不要重放旧补丁。必须确认 F12 `codeReady=true`、测试与 guard 属于**当前代码**；否则后续 F13–F17 不能启动。
1. F13（Discover/导航）复用你已有的本地照片组件。将发布允许的案例引向 `original + explore`；原图单项编辑直接引向 `original + detail`。禁止强制详情页，浏览/预览 0 模型调用，必须保留 legacy 路由。
2. F14（工作室/草稿/确认）落实 `Cancel` vs `Apply`；草稿与实际用户车图分离，保存 revision，冲突不覆盖。最终报价来自 `POST /api/v2/projects/:id/plans`，不能将自己拼的 UI 摘要当报价；`submit` 复用现有 `src/lib/api-v2.ts` 的持久化 submissionIdentity。
3. F16（结果页）选定真实 version 作为 refine source，与项目原图作为新探索的 original 不得合并；收藏/比较/反馈不生成，不伪造自动补偿。
4. F17（车库）稳定 owner/project/version/asset 身份、封面与最爱/历史分开；静态导出有真实尺寸；无权展示的车图必须隐藏。

## 已替你做好的前置资料

- `data/api_surface_audit.json`：当前 V2 路由 26 个合同 endpoint 状态逐条标记；建议先走 **S02 route owner 审批**，不允许在前端 F13–F17 allowlist 外偷偷增加 server routes。
- `reference/ui_intent_oracle.mjs`：22 条合成语义的行为参考，供正式代码和 Playwright 改写；不需要复制这套 reference state 为第二个生产状态机。
- `tests/ui_intent_oracle.test.mjs`、`tests/api_surface_audit.test.mjs`：Node 原生离线测试。请将其中跨组件验收**迁移到 F13–F17 原有 Node/Playwright harness**；合成测试不能标记产品已集成。
- `03_UI_RFC_FIXES_ZH.md`：尤其注意 `explore + paint` 在当前后端返回 422；这是导致返工的高优先级规范不匹配。

## 尚待 Owner 批准，勿代替授权

- **独立 S05 UI RFC**：认可深色 V2.1 汽车工作室作为视觉基线，批准布局/文案/组件层级是否与冻结 S05 不同，以及跨任务公共样式/设计 token 的范围。
- **S02 route ownership RFC**：将 workspace/history、draft CAS、favorite/feedback 及 wallet GET 分配给明确的后端 task 和 allowlist，不能因为网页按钮要用就直接扩展 F13/F14/F16/F17 允许文件。
- 正式媒体/模型能力/ Apple/真机/真实收费：按现行独立审批与审核，不在这次批准。

## 最终验收种子

- Case Try → 选本地照片（未确认前 0 上传）→ `original+explore`→ quote → task；无已发布 case 时不能请求模型。
- Original direct detail → `original+detail`，无 styleId。
- 打开 modal / 选择红色 / Escape → committed 不变，0 模型调用；Apply 更改合法 draft，但原车像素不变。
- 工作区从 V1 进入 detail，且 V3 是最新 → quote 源仍是 V1，不能使用 latest。
- 结果里的 `Refine this look` 和 `Try another from original` 进入不同 source 并形成可辨别分支。
- 收藏/比较/静态导出、任务等待页刷新、返回页面都不会产生第二次提交或付费模型请求。
- 迟到响应、账户切换、权限过期、无可用图片、无信用、离线、大字/窄屏均明确表现为合法状态。

**新的 API 归属需要受审修订后再落地；F32 前不能认定主应用已经完成 V2 接线。**
