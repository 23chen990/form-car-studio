# FORM｜Style＋Extra＋Color，一次组合、一次生图（研究用参考实现）

2026-10-14。背景：Owner 要求当前 FORM 首发以 **Style＋Extra＋Color** 为主要生成体验，而不是仅依赖颜色类 Style Preset。

**文件：**
- `01_PRODUCT_AND_PROMPT_DECISION_ZH.md`：从 Mody/Modyfy/Wrapr 已核实数据到首发产品/Prompt 架构的决策。
- `compose.mjs`：确定性组合器的*独立研究参考代码*，无网络、无生成、无付费、没有外部 LLM。
- `compose.test.mjs`：完整参数校验、颜色优先级、互斥、保护约束、老版本图片来源、无额外 LLM 等离线测试。
- `SAMPLE_COMPOSED_PROMPTS.md`：同一底图的不同选项所编译的示例 Prompt（绝非模型输出）。
- `02_CODEX_IMPLEMENTATION_HANDOFF_ZH.md`：Codex 后续如何以最小范围在 FORM 正式代码实施。

`node --test compose.test.mjs`

**状态和边界：** 这不是正式 V2.2 `EditRequest`，不是现有后端的一部分。当前 V2 `explore` 不允许额外改装和颜色覆盖，`provider-prompt.ts` 还明确禁止加 Body Kit。不要以为本实验工具可以绕过冻结 S01/S02 审批、Provider Profile、真实质量证明及支付/授权。`compose()` 默认禁用 Creative Build，传入的实验开关只能来自受信任、审批后的服务端或纯离线测试，不得从 HTTP body 读取。

**商业目标：** 让用户“一次选完整造型、一笔明确费用、一张经过质量验证的生成结果”。真实效果及利润必须在授权照片/限额模型试验之后评价。
