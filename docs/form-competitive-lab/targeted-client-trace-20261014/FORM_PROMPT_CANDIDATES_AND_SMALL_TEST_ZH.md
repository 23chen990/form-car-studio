# FORM｜Prompt 候选与最小质量试验（无真实调用）
状态：DESIGN_ONLY / NOT_EXECUTED。2026-10-14。依托同目录 FORM_PROMPT_WORKFLOW_MVP_PROPOSAL_ZH.md。
目标：最少成本搞清**优化 Prompt 是否让用户更想付钱**，以及现有颜色类能力是否足以承载商业卖点。
这些例子均为 FORM 独立撰写，不是竞品的服务器实际 Prompt，也不是已经通过真实生图测试的配置。

## 试验必须先锁定

- 固定：**同一图片、同一合法编辑意图、同一模型/版本、同一输出质量与尺寸、相同参考图角色**。
- 变化：仅修改 Prompt 编排 A/B/C；不得在 B 和 C 同时偷偷修改模型、费用等级或功能范围。
- 记录：原始图独立私密 ID、照片授权、source kind/versionId、Prompt 和 Profile 版本、任务、结果、首次费用、失败、可保留效果。
- 不从竞品复制远程 Prompt；保护业务私有配置。
- 以下原本不公开的完整照片或生成结果不进入 GitHub；公开只保留授权素材索引和脱敏统计。
- S06 的 30 张授权照片位置、252 次完整研究仍是**未执行计划，不代表本小试验获批或自动扩展**。

## 测试任务：原图车身深蓝改色（同一任务，三个 Prompt 版本）

**候选 A｜当前已经存在的正式基线**

不要重新写一份“很像”的 Prompt。实际基线是 PR #3 源码的 shared/v2/provider-prompt.ts buildEditPrompt 在指定 profile/plan 下生成的真实文本；冻结源码 SHA、配置和输出。对照中必须提取同一个车身深蓝修改请求的实际 server-generated Prompt 作为 A。

**候选 B｜结构化约束，改变编排不增加改装能力**

SOURCE: The primary image shows the customer's real car. Use it as the only editing base.

GOAL: Make one realistic automotive color edit: repaint the visible exterior body paint to deep blue.

EDIT ONLY: Painted exterior body panels. Render coherent automotive paint, including reflections and highlights consistent with the original camera and scene lighting.

PRESERVE: The same recognizable vehicle, door count, roofline, windows, lights, wheels, tire geometry, badges, plates, stance, angle, framing and background. Do not add or remove physical parts.

OUTPUT: The entire original car remains in the frame. Clean boundaries, believable paint coverage and natural contact shadows. No new text, people, stickers, body kits, spoilers or unrelated changes. This is an appearance concept, not a real-world fitment claim.

**候选 C｜材质/摄影一致性强化；与 B 申请同一个改色目标**

SOURCE: Edit the customer's real vehicle from the primary image; preserve the exact view and scene.

GOAL: Repaint only the visible exterior painted body surfaces to deep blue. Do not alter body geometry.

MATERIAL: Use plausible automotive paint response: reflections follow the source lighting, surface curvature and environment; panel boundaries remain crisp and paint coverage consistent across doors, hood, roof and bumpers. Keep glass, chrome, wheels and matte plastic trims correctly separated. Avoid a flat painted-on overlay or artificial studio relighting.

PRESERVE: Same car identity, body proportions, windows, lights, visible badges, wheel design, stance, background, camera and composition.

OUTPUT: One photorealistic edited car photo; no added body kit, spoiler, lettering, people, props or new camera angle.

**注意：B 与 C 内容没有扩大现有 bodyColor 的含义，但它们是否优于 A 只有真实对照才知道。不得在未验证前将其替换到生产服务。**

## 不同任务必须换哪些约束？

### Paint + surface finish（仅当 profile 已获准 bodyFinish）
ALLOWED: Set the body paint finish to satin.
PRESERVE: Car body shape, color if not explicitly changed, parts, background, scene light direction.
REALISM: Highlights may change **as required by the selected satin finish**, but do not change the location or color of the scene light sources.
反例：同时写“Change paint to matte”和“Keep every reflection identical”会产生内部矛盾。

### Wheels detail（仅当 profile 已获准 wheelDesign）
ALLOWED: Change the visible wheel spoke pattern to a generic classic mesh design.
PRESERVE: Same car and camera, wheel centers, wheel/tire outside diameter, tire shape, wheel count, axle position, stance, background.
REALISM: Mesh spokes must follow the original perspective and lighting. No invented brand logo or fitment dimensions.
反例：请求换辐条又写“Preserve the current wheel spoke pattern”会冲突。

### Refine an exact saved version
SOURCE: Primary edit base is the exact selected owned version ID, not the newest project output and not the camera original.
GOAL: Apply the new allowed edit only to this source version.
PRESERVE: Keep all unrequested parts of the selected version. Past request metadata is **not** proof that the old generated image truly contains those requested modifications.
说明：源 asset/版本/owner 应由可信服务器绑定；不能把 versionId 插入文字后就认为完成了权限检查。

### Creative Build（研究示意，当前禁用）
SOURCE: Use the owner's authorized car photo as the identity and perspective reference.
GOAL: Create a restrained street-performance **visual concept**.
ALLOWED PHYSICAL-LOOK CHANGES: Add precisely defined, visually coherent fender flares and a subtle front splitter. No other body parts are authorized. Maintain plausible clearances and shadows.
PRESERVE: The same recognizable make/model identity, cabin/roof/windows/door configuration, headlights, wheelbase impression, camera, scene and background.
EXCLUSIONS: No giant wing, new wheels, new text, changed badge, altered license plate, changed location or unrelated edits.

**只供未来实验设计。** 当前 V2 provider-prompt.ts 明确禁止增加 body kit，现行 EditRequest 也没有 Creative Build。不得将这段直接接入 V2、允许用户付费或在产品中宣称能力。

## 最小验证，不是 252 次大研究

**阶段 0（现在可做，零付费）：** 从当前合同导出 2–3 个受支持字段的受控计划，静态检查合法来源、字段、冲突、输出次数、Prompt 版本、计费关口；A/B/C 候选经人工审查。不要调用模型。

**阶段 1（需 Owner 新批准）：** 选择 3 张拥有明确处理权利的车照，统一做“车身深蓝改色”，A/B/C 各生成 1 张，总共**9 次计划调用**。调用前以真实供应商的确认价格设置严格上限，所有失败和重复调用计费。不得用只展示好结果的筛选冒充成功率。

**阶段 2（另需审批）：** 若已经看出颜色类能力可行，先用新授权照片复核最优候选，排除小样本巧合。如果商业需求仍是宽体/尾翼才对未来 Build 做独立能力测试；不把这些费用并入阶段 1 的授权。

## 人工评价表（每张首次结果单独记录）

| 字段 | 记录方式 |
|---|---|
| identity_critical_failure | 是/否；车身门窗、车型和关键细节是否发生严重错误 |
| target_applied | 是/否/部分；车身改色是否真实覆盖目标部位 |
| unwanted_changes | 数量＋图片标注；车灯、车窗、轮毂、背景等未要求变化 |
| realism | 1–5；光影、色彩、车漆、边缘自然程度 |
| wow_preference | 1–5；目标海外汽车用户是否觉得值得尝试 |
| willingness_to_keep | 是/否；用户自己会不会保留或分享 |
| payable_intent | 是/否＋报价；看到真实效果是否愿意付钱（意愿不等于真实付款） |
| supplier_cost | 原始真实计费/失败/重试，按所选配置记录 |

商业指标：总供应商费用（包含失败及重试）÷ 用户愿意保留的结果数；另记实际支付转化、退款、渠道成本。**不能把 demo 图、合成测试或 UI 美观当作 AI 质量/销售转化证据。**

## 下一步 Codex 的边界

- 不应先改 F05/F08/F10/production prompt 源码以便“看看效果”。
- 可复用此研究文件做静态 Prompt 冲突审查、构造测试 fixture、提出可审阅的版本化模板/受支持 providerProfile 对接草案；任何新增 schema 操作、开放 Creative Build、改 provider、付费调用，都必须经 Owner 独立批准。
- 所有实验先冻结 A/B/C、成本单价、计数和评估表；不能以模型新名称/声称的参数能力代替实车结果。
- 官方 OpenAI 图像编辑 API 支持编辑输入图和 prompt，但模型/mask/参考图/输出参数存在版本差异，具体要以当前公开文档和经过审批的 providerProfile 为准： https://developers.openai.com/api/reference/resources/images/methods/edit
