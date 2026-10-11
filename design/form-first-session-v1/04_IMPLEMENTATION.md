# 实施计划：保留现有工程，减少弱模型自行发挥

**当前交付只新增 `design/form-first-session-v1/`。不修改活跃 Codex 分支、原有 F02/F03、生产入口、锁文件或 GitHub Actions。**
负责人接受本设计后，吸收进既有任务。批次是验收组织方式，不取代 F00—F38 的依赖图。

## 批次和路径映射

| 批次 | 对应已有任务 | 允许落点（以当前任务卡白名单为准） | 本次设计输入 | 本批验收 |
|---|---|---|---|---|
| U1 页面骨架与入口 | F12/F13/F37 | `src/features/photo/*`、`src/features/discover/*`、`src/features/navigation/*`、测试harness | S01/S02、tokens、案例来源标签 | 主按钮可达，无登录先浏览，示例/原图区分，零隐形生成 |
| U2 草稿与准备 | F07/F08/F11/F12/F14/F20/F21 | 既有photo/editor/confirm与各自adapter | 状态表、类型契约、生产copy | 明示上传前同意，正确base，账号取消保留选择，过期quote重新确认 |
| U3 次数与购买接续 | F23/F24/F36 | `src/features/purchase/*`、原生purchase接口和对应测试 | 两种商业路径、purchaseReturn | 默认试用关闭，未知价格禁买，pending不重复买，到账不自动生图 |
| U4 等待与结果 | F10/F15/F16/F35 | task/result、poller、Comparison及允许的测试 | TaskPresentation、S04/S05 | 恢复同一job、无假进度、迟到结果正确、余额返还文案真实、错误独立反馈 |
| U5 车库与导出 | F17/F19/F26/F37 | garage/export/native/cache | S07/S08 | 旧版收藏可为封面，正常保存不收费，切账号无旧图，私有资源不公开 |
| U6 集成与用户检查 | F28/F29/F32/F33 | 原任务允许的entry、e2e、review目录 | QA矩阵、研究脚本 | 全流程无mock泄漏，真机/真实模型单独判定，记录未测项 |

F12的harness先能演示图片准备；后续功能逐步扩展同一harness。模型/支付/服务器没接好时维持dev/test-only，不跳过依赖直接改生产 `src/App.tsx`。

## 代码复用规则

可以复用：页面布局、间距、响应式策略、纯UI按钮判定、英文文案、数据字段、测试意图。
不可直接复用为生产：模拟器wallet/identity/consent、生成计时器、模拟transaction、手写Apple按钮、SVG替代用户输出。

`flow-policy.mjs` 可移植到当前任务允许的 `src/features/confirm/` 等位置并增加TypeScript类型；不要为了复用它新造后端接口。
`contracts.d.ts` 描述界面适配器输入/输出；实际V2接口优先，按边界映射。若已有实现等价，不要重写。

原型 CSS 是独立页面；生产必须命名空间，不能把全局button/h1/dialog样式整体覆盖现有应用。F12—F17采用允许的feature CSS、harness wrapper。正式全局主题接线留到F32；需要新增白名单的先提出清晰小修订，不绕过guard。

样式文件不使用远程字体、付费图片、追踪脚本。顶部“研究控制台”、模拟时钟、模拟账户、示例积分、所有测试入口**不进入生产bundle**。
不要把研究报告或交易载荷发送到analytics；必要事件见05。

## 任务顺序和测试要求

1. 先读取当前 main/实现PR HEAD；不得重置已有工作。
2. 对照本设计和已批准V2.2，列差异：保持原样/细化/需批准的新变化。这里主要是既有S05细化，免费试用仍未批准。
3. 每批先补会失败的界面用例，再实现。本次参考测试不能通过删断言“借来绿色”。
4. 使用既有React和Playwright，不添加第二套UI框架/巨型状态库。无须引入REA。
5. 逐任务scope检查、精确提交；UI支持组件、资金、原生能力分别验证。
6. 批次完成给一个摘要和PR证据，不让负责人逐按钮回复验收。
7. 所有条件满足后才将harness组件接入生产；同一功能不要在harness与App重新实现两遍。

## 完成定义

U1—U5可标 `UI_IMPLEMENTED` / `ADAPTER_TESTED`，不代表 `LIVE_VERIFIED`。
U6要附code SHA、真实命令及exit、浏览器/设备、截图哈希、实际接口路径、缺失配置列表。
发布仍需已冻结的14个gate。不因这份设计好看而提前通过真实模型质量、privacy、IAP或数据迁移。

## Codex 开工指令（设计被接受后使用）

你现在吸收 FORM 首次体验设计，不重新策划产品。
读取当前AGENTS、FORM_CODEX_START、设计00/02/03/04/05，然后检查活跃实现分支。
先从符合依赖的U1开始，把界面做在现有F12测试harness。严格沿用V2.2单图、显式确认、不可变历史、无假退款、无默认免费、实际商品价格规则。
禁止复制prototype/model.mjs到服务端；它只演示状态。尽量复用flow-policy的纯判定和copy表；真实身份、任务、支付、资产必须用现有adapter。
按U1—U6集中自测和汇报，不能为改首屏而重开F02或扰乱F03。生产能力缺失只阻塞对应联调，不编造成功、不自动升级依赖、不自行合并发布。
完成后给真实截图、可复现步骤、已测和未测、PR及HEAD；不得把本次原创示意车当正式营销出图。
