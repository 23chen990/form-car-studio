# FORM｜Owner 产品方向：Style＋Extra＋Color 首发一次生成（待审实施 RFC）

日期：2026-10-14。**用户明确要求：首发就支持 Style＋Extra＋Color 自由选择并一次生成，而不是仅保留原有换色 preset。** 本文记录产品方向；不是已批准的 S01/S02/API/Provider/付费调用变更。原 PR #3 和冻结任务守卫保持不变。

## 一、最短商业流程

上传自己车照 → 选择 1 Style＋0/1 Extra＋1 Color → 同一个编辑草稿中的选项确认 → 后端能力/互斥校验 → 唯一冻结报价 → 1 次确认/1 次图像生成 → 1 张输出 → 保存或从精确 versionId 再编辑。允许 Extra=none 或 Color=keep，但如果实际修改项为空必须禁用生图。未生成之前展示原图和已选菜单，不伪造实时 AI 结果。

首发先将 Extra 控制为至多一个，以快速实现并减少失败；**只有实际授权图像质量测试证实能够稳定生成的 Extra/Style/Color 才出现在收费目录**。例如 Street＋Subtle Widebody＋Matte Black 是组合测试目标，不是已实现的生成能力。

## 二、Prompt：默认确定性模板，不每次先问 LLM

**推荐最短架构**：服务器保存版本化 Style/Extra/Color 三类受控模块和兼容规则；用户只传 ID，服务器解引用并组合 SOURCE、GOAL、ALLOWED CHANGE、PRESERVE、REALISM、EXCLUDE。Style 提供风格方向，Extra 界定实际可变化的部件区域，Color 优先覆盖任何风格默认配色；不允许同时出现“加尾翼”和“禁止添加尾翼”等互相矛盾的句子。

一份冻结意图对应一个 Prompt、一个明确报价和一个图像生成任务，不额外花钱让独立 LLM 重写。图片模型自身理解文本和图像，不代表必须再调用独立聊天模型。未来自由文本/复杂兼容才值得对照测试 LLM 结构化重写；即便使用 LLM，必须受 JSON schema 与权限/能力白名单约束，不能擅自扩展改件。

参考官方直接图片编辑的 prompt 接口：https://developers.openai.com/api/reference/resources/images/methods/edit

## 三、竞品逆向结论（区分代码事实与服务器未知）

- **Mody**：普通 Builder 有 Style→Extra→Color 的类型模板、变量填充与字符串拼装代码证据；高级模式 Angle→改件列表→Color；Custom 有 gptCustomPromptIsActive / getCustomPromptFromGpt 的条件重写分支。**不能说普通生成每次必先调用 LLM。** 完整远程模板、生产图像模型与质量未知。
- **Modyfy**：普通 CarStyle 发送 itemIds=[StyleId,ExtraId,ColorId]，其中 Extra 占一个可替换的标量槽位。客户端没有确认最终服务器使用何种 Prompt/LLM。不能因客户端只发 ID 就说服务器一定只用模板。
- **Wrapr**：客户端发送 modificationType 与 parameters，服务端如何转 Prompt、是否使用 LLM 未确认。

来源：同目录 MODY_COMPOSITION_DETAIL_ZH.md、CLIENT_TRACE_OWNER_SUMMARY_ZH.md；PR #7 04_BUSINESS_FLOW_EVIDENCE_ZH.md。静态数据流不等于实际质量。

## 四、为什么不能把当前 V2 简单放开一个字段

目前 shared/v2/edit-plan.ts 仅支持 explore/detail；server/v2/plans.ts 对 explore 额外 edits 报 EXPLORE_OVERRIDES_UNSUPPORTED；server/v2/presets.ts 的历史 style 主要是颜色映射；shared/v2/provider-prompt.ts 当前明确禁止添加 body kit/spoiler。直接把三个标签拼进旧 Prompt 将出现矛盾，也破坏现有快照/账单语义。

Codex 需先提出**最小 S01/S02 受审增量合同**：受控 Style/Extra/Color ID、版本化模板、单个 Extra/互斥表、老版本迁移与兼容、服务端合法能力开关、source asset 与 versionId、单次 quote/幂等/账本及结果 recipe provenance，再在现有模块增量实现。不得利用现有任务 allowlist 越界实现生产发布。

## 五、下一步最省钱的验证

纯离线先验证编排、互斥、no-op 禁用、颜色优先、宽体/尾翼不同 preserve、源版本和唯一 quote。随后需另行授权少量合法车照与封顶费用，建议 3 张照片 × 3 个有限组合 = 9 次计划真实生成进行快速能力筛选；这不是正式 252 次研究的授权或通过标准。把失败、换错车、结构偏移、实际供应商费用都计入，不只挑好图。

如果模板组合生成宽体不稳定，优先考察图像模型/编辑工作流的适配性，而非盲目追加文字 LLM。用户真正购买的是效果，不是 Prompt 的复杂程度。

## 边界
仅记录产品方向；本次不合并 PR、不改 main/PR #3、不执行付费模型、不修改存量 Apple 钱包流程，不把本研究方案当作可出售能力证明。
