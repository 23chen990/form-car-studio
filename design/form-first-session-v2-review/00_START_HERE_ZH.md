# FORM｜Mody + Modyfy 完整竞品观察与首三分钟设计交接

**更新：2026-10-12。当前状态：RESEARCH_ARCHIVED / DESIGN_HYPOTHESIS_ONLY / VISUAL_APPEAL_NOT_APPROVED。**

> **一句话**：开屏先让普通车主看到真实可验证的同车外观变化，激起“给我自己的车试试”的欲望；选图后持续展示他的原车/选中历史版本，用少量可理解、真正被支持的部位修改继续创作；价格和任务状态透明，不做假免费和假预览。

研究覆盖用户交付的 **Mody 104.6 秒录屏**、**Modyfy 126.17 秒录屏**、一张独立 GARAGE 补图、Mody 静态安装包盘点/失败 REA 日志，以及两款美国 Apple App Store 页面与可见评价。视频由用户实际录制；并非本研究者自己安装、操作、付款、生成或获悉提示词。

## 对你最有用的阅读顺序（全为中文）

1. **[负责人一页结论](16_OWNER_ONE_PAGE_ZH.md)** —— 不用读完整技术资料，先知道我们究竟要学什么、不做什么。
2. **[Mody × Modyfy × FORM 逐阶段对照](09_MODY_MODYFY_FORM_MATRIX_ZH.md)** —— 首屏、上传、编辑、收费、等待、结果、商业化的差异。
3. **[FORM 前三分钟设计蓝图](10_FORM_FIRST_THREE_MINUTES_BLUEPRINT_ZH.md)** —— 0–5 秒、5–15 秒、30–90 秒、90–180 秒，各步怎样把车主带到上传。
4. **[优先级与决定](13_GAP_PRIORITIES_AND_DECISIONS_ZH.md)** —— 哪些 P0/P1 真的要解决，哪些花钱功能明确不做。
5. **[真人测试与验收](12_QA_AND_HUMAN_APPEAL_ZH.md)** —— 代码跑通≠有人真想上传；要怎样验证这个目标。

## 两款竞品的原始证据与边界

| 资料 | 文件 | 能证明 | 不能证明 |
|---|---|---|---|
| Mody 实际录像 | [02_RECORDING_TIMELINE_ZH.md](02_RECORDING_TIMELINE_ZH.md) | 录屏中见到引导、风格/Extra/颜色抽屉、分析和订阅营销页 | 生成质量、实际付款成功、私有提示词 |
| Mody GARAGE 补图 | [03_GARAGE_SCREENSHOT_ZH.md](03_GARAGE_SCREENSHOT_ZH.md) | 大车图与底部部件入口视觉布局 | 该图与录屏同版本、精准选区/即时渲染 |
| Mody 安装包与 REA | [01_DISCUSSION_AND_STATIC_ZH.md](01_DISCUSSION_AND_STATIC_ZH.md) | Flutter/Firebase/RevenueCat 等静态依赖线索；Hopper 启动失败 | 营收、实验启用、后端/提示词 |
| Modyfy 实际录像 | [06_MODYFY_VIDEO_TIMELINE_ZH.md](06_MODYFY_VIDEO_TIMELINE_ZH.md) | onboarding、示例照片、四步配置、娱乐特效、系统订阅面板 | 用户结果、成功支付、竞品故障率 |
| Modyfy 收费与用户信任 | [07_MODYFY_PAYWALL_AND_TRUST_ZH.md](07_MODYFY_PAYWALL_AND_TRUST_ZH.md) | 录像出现首周付费“7-DAY TRIAL”，公开评价有类似误解 | 所有人付费价格、真实退款率、违法结论 |
| 两款官方商店 | [08_STORE_VERIFICATION_ZH.md](08_STORE_VERIFICATION_ZH.md) | 正确开发者与美区 App ID、官方功能陈述及可见评论 | 独立模型质量与商业指标 |
| 来源到结论的追踪 | [15_EVIDENCE_TO_DECISION_TRACE_ZH.md](15_EVIDENCE_TO_DECISION_TRACE_ZH.md) | 每个建议来自哪段资料、不能越界的解释 | 产品假设已被真人验证 |

## 后续设计与开发的具体输入

- [页面状态、F12–F37 对接与中英文文案](11_FORM_IMPLEMENTATION_AND_COPY_ZH.md) —— 只能在负责人批准后作为交接输入，不能直接改 PR #3。
- [素材版权和图片加载失败处理](14_ASSET_AND_IMAGE_FALLBACK_ZH.md) —— 无真实获授权同车案例时，**只能内部演示**。
- [廉价可执行的体验实验与诊断](17_RESEARCH_VALIDATION_AND_ANALYTICS_ZH.md) —— 研究和指标尚未实测。
- [原有 Mody 研究形成的设计建议](04_FORM_DECISIONS_AND_NEXT_STEPS_ZH.md) —— 历史建议，具体取舍以本次对照与冻结 V2.2 为准。
- [上轮 A/B 中文原型的实际交付状态](05_PREVIOUS_DELIVERY_STATUS_ZH.md) —— 还未获吸引力验收；本 PR **不包含完整原型**。
- [完整证据清单](evidence/SOURCE_MANIFEST.json) / [Modyfy 视频校验](evidence/MODYFY_SOURCE_MANIFEST.json) / [审查方法](evidence/REVIEW_METHOD_ZH.md)。

## 本次研究的明确结论

**学 Mody 的“车图中心 + 少量抽屉配置”，学 Modyfy 的“普通车先展示具体改装视觉 + 上传可选示例”。**

**不学**长串无图风格卡、伪装免费实为首周付费的 Trial 表达、开场星级宣传作为品质证据、Crash/AI 视频/3D 功能堆砌、虚构“智能分析”指标。竞品 App Store 各种承诺只算宣传，录屏没有显示成功的 FORM 可复制成品。

素材与技术上的**最大阻碍是没有可发布、经真实模型验证的同一辆车改装前后证据**。不能把概念图或未经许可的竞品图放上正式首屏。

## 保护既有项目

- **PR #3** `codex/form-v2-implementation` 不受本研究影响；不得因本次文档擅自实现功能、改 F02/F03、支付或数据库。
- **PR #5** 的旧版视觉明确未通过用户验收，不恢复批准。
- 既有设计 A/B **仍然是候选**，不宣称这次 Modyfy 研究让它们变成完成版。
- 冻结 V2.2：一次明确确认→一逻辑任务→一张结果；保留原始图与版本；次数包而非订阅；真实免费试用关闭；默认外部花费零；真实账户/报价/Apple 权益只能来自可信服务端流程。
- REA/模型提示词另案；不要绕过许可获取竞品代码、图片或私有数据；不新造一个后端。
- 本 PR 只归档 `design/form-first-session-v2-review/` 内脱敏文字和时间定位，**不公开用户视频、Apple 账户、相册截图、个人图像或竞品素材**。

## GitHub 工作方式

研究分支：`research/form-mody-ux-review-20261012`，在已有 Draft PR #6 中继续提交；目标基线 `handoff/form-v2-briefing-20261011`。继续保持 Draft、不要合并/部署。需投入开发时重新检查当前 PR #3 HEAD、任务卡与冻结决策，先通过设计/授权闸门再实施。

现阶段的验收字段：`RESEARCH_DOCUMENTED`，而不是 `DESIGN_APPROVED` / `LIVE_VERIFIED` / `RELEASE_APPROVED`。
