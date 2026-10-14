# 给 Codex：只做本机私有材料才能完成的四项定点追踪

> 这是研究专用任务，不是 F12/F13/F23 的产品开发指令。优先复用已有 `<LOCAL_PRIVATE_RESEARCH_DIR>`（由 Codex 根据已授权的既有研究记录定位） 与之前 Wrapr 归档；路径需要在本机核实，不要因为文档写过就假设原文件存在。**不要与正在运行的 PR #3 开发 Agent 争用工作区。**

## Owner 目标

我要知道竞品的炫酷改装选项怎样从用户点选一路变成请求，以及怎样保存用于下一次编辑。已经有 PR #7 的 228 条证据、Mody Flutter AOT、Modyfy Hermes、Wrapr 部分文字线索。本轮不要从零开始，也不按函数数量评价成果。

## 开始前的只读核查

1. 先检查研究分支与原始材料版本/哈希；确保 PR #3 的 `codex/form-v2-implementation`（当前已核实 `2cef4a2`）仍完全不受影响，原始脏目录与 main 不作任何变更。不要修改 app 签名、受保护 main/Runner 或平台校验。
2. 读取新研究 PR 的 `trace_matrix.json`、`01_OWNER_DECISION_ZH.md`、原 PR #7 的 `02_MODY_AOT_TECHNICAL_ZH.md`、`04_BUSINESS_FLOW_EVIDENCE_ZH.md` 与 228 条账本，禁止重复汇报已有的模型别名/通用 SDK 数量。
3. 使用已存在的 Hermes / AOT 导出数据和私有笔记。若导出缺失，可停在现有证据级并报告准确缺失路径；不要未经允许访问内部 Firestore、私有 Callable、账号凭据、苹果订单、私人照片或付费生图。

## P0-A：Modyfy 的 UI label → ID → 请求

- 安装版基准：`com.ai.car.app` 1.2.0 build71、Hermes96；`#20352/#20355` 整车生成、`#20361/#20364` CarMod。先从静态资源/配置引用查 UI 列表和 `selectedStyle/selectedExtras/selectedColor` 等候选状态（候选字段不一定原样存在），再逆向到 `itemIds` 结构。
- 对 `Japanese`、`Stance`、`Futuristic`、`Body Kit`、`Spoiler`、`Golden Accents` 等优先做 3–6 个**同版本**例子；既有录屏 24 Style＋10 Extra 的名字，仅是跨版本未认证的 UI 证据。`Golden Accents 1` 来自独立第三方截图，尤其不能默认与 `Golden Accents` 同 ID。
- 输出列：`app_build / ui_label / label_source / actual_static_id_or_UNKNOWN / id_source_pc_or_file / state_field / itemIds_position / multi_select_or_UNKNOWN / default_or_UNKNOWN / callback_or_handler / evidence_class / cannot_infer`。
- 多选、互斥、默认值须有分支/数组操作的源静态证据；不能因为客户端有 `itemIds` 数组，就推断 Extra 允许任意多选，也不能猜服务器兼容规则。

## P0-B：Modyfy 再次编辑的真正底图

从 `#22481` 的 `result.inputs.collection/urls/itemIds` 恢复路径开始，严格追到**下一次实际构造 `imageData` 的值来源**：原照片、历史输出 URL、原本缓存、还是按分支切换。画出每一条有证据的边，区分 `outputs.url` 用于展示与作为生成输入的情况。特别验证界面上的 Regenerate 与不同 CarMod 功能是否共用底图规则。看不到数据流就写 `UNKNOWN`，不能只凭按钮文案判断。

## P1-C：Mody 3.1.440 的拼装与 Detail

从现有 `createFinalPrompt` 0x295558、`getGeneratePrompts` 0x354c44、Detail 0x2f4510、`getMultiSectionPrompt` 相关路径复核：
- Style、Extra、Color 的加入顺序、默认值和冲突/覆盖规则。对**在客户端明确可读的分支**逐条标出 AOT PC、receiver/field、调用边；不可读的远程 Firestore 模板保持未知。
- Detail 操作里 Angle／Spoiler／Exhaust（第三方实际 UI 观察，版本未统一）及轮胎/颜色的事件值，能否同版本走到具体 typed section、promptCarItem 或 tool/Workflow route。最好只选 2 个能实锤的控件，拒绝基于 UI 文案编造最终请求。
- 在公开归档只报告结构、字段名、常量分类、PC/调用关系和置信度；不要复制原始 832 字符私有提示词、长模板或内部 host。

## P1-D：Wrapr 局部修改路径

首先核查已有本机 Wrapr 1.0.1 build6 Hermes 导出和用户此前只读报告是否存在并匹配哈希。候选 `#9782 @ 0x001b98a3`；已知请求结构可能有 `image/modificationType/parameters/quality/requestId`。优先选 **Paint / Wheels / Body Kit** 中一个确实存在同版本静态控件的路径，追控件事件→参数值→请求对象。输出该类是否只是更改 request enum，还是使用不同客户端请求函数；**不得仅根据名称声称模型不同**。

## 输出与止损

- 一次性提交研究增量，不接触 PR #3：`CLIENT_TRACE_OWNER_SUMMARY_ZH.md`、`ACTUAL_LOCAL_TRACE_MATRIX.csv`、`UNRESOLVED_GATES.md`、脱敏输入哈希/命令/测试记录。
- 每条确定事实保留同一版本的 `UI_OBSERVED`、`CLIENT_CODE_LINKED` 或 `RUNTIME_OBSERVED` 证据；跨版本推论必须显式写 `HYPOTHESIS`，服务端不可见就写 `UNKNOWN`。即使某分支失败，也要交付明确的代码定位和失败原因，不要重新扫描全安装包。
- 本轮只读，不执行真实付费生图、不购买、不绕登录/DRM、不探测第三方内部服务、不泄露私有代码/凭据/图片。
- Codex 若想改 FORM 业务能力或 V2.2 冻结规格，必须另走 Owner 批准。当前 252 次拟议模型研究不授予任何支出。
- 若资料完整，一次性完成所有能完成的静态工作；资料不存在或进入服务端黑箱时，给出阻断证据，停止那一条，不要拿更多样板技术报告充数。
