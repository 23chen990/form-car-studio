# FORM 立即支持 Style＋Extra＋Color：Prompt 与生成流程产品决策

**产品方向：Owner 明确希望首发一体化组合。** 日期：2026-10-14。**工程审批：本文件属于待审设计/参考实现，未改冻结 S01/S02、Fxx 任务、PR #3、生产 Prompt 或授权模型支出。**

## 一、用一套实际可出售的玩法代替三个收费阶段

首发主路径：用户原图（或精确选择历史版本）→ Style（一个）＋Extra（至多一个）＋Color（一个）→ 同页预览已选意图（不假装图已改）→ 版本化 Prompt 组合器 → 唯一 quote / 一次用户确认 → 一次实际图片编辑任务 → 一张结果 → Refine / Try another。

示例：Street Tuning + Subtle Widebody + Matte Black。**一个请求完成三项改变，不先生成宽体再换色再调风格，也不为了拼 Prompt 先调用一次 LLM。** 第一版 Extra 限定一个是控制失败成本的 MVP 抉择，不代表 Mody 可以单选；Modyfy 已证普通 CarStyle 使用一个 Extra 标量槽。

**不做假承诺：** 独立研究代码能组合合法文字，不等于任何模型已能稳定生成宽体。首发真正开放的 Style/Extra/Color 必须从通过当前 Provider 质量验证的子集发布；不合格选项不给用户收费入口。用户决定即刻支持的是目标交互和研发优先级，不是跳过图像质量/安全验证。

## 二、各竞品的证据级结论

| 竞品 | 真正逆向到的部分 | Prompt 是模板还是 LLM？ |
|---|---|---|
| Mody 3.1.440 b2 | 常规 `createFinalPrompt` 从 remote type/prompt 与选项取片段；标准 Style→Extra→Color；高级 Angle→列表→Color；Detail 有模板及分路。Custom 路径有 `gptCustomPromptIsActive→getCustomPromptFromGpt` 条件开关和文本重写调用线索。 | **常规路径确有模板与确定性字符串拼装；Custom 可选 GPT；不能说所有请求先经过 LLM。** 当前远程 flag/模板全文/生产生图模型 UNKNOWN。 |
| Modyfy 1.2.0 b71 | `itemIds=[styleId,extraId,colorId]`，普通整车 Extra 是一个标量，服务器收到 `imageData/collection/itemIds`。 | **只知客户端传 ID，不知服务器使用固定模板、LLM 改写，还是其组合。** |
| Wrapr 1.0.1 b6 | 前端按 modificationType 与参数键值构造共同请求。 | **客户端有结构化参数，服务端 Prompt/是否使用 LLM UNKNOWN。** |

证据见：`../MODY_COMPOSITION_DETAIL_ZH.md`，`../CLIENT_TRACE_OWNER_SUMMARY_ZH.md`，以及既有 PR #7 的 `04_BUSINESS_FLOW_EVIDENCE_ZH.md`。不能把静态可读函数名、生成等待页或 UI 卡片数量当作真实服务端生图模型/质量证明。

## 三、两种真实 Prompt 架构比较

**A：固定模块模板＋确定性组合（FORM 首发默认）**

- 服务端从受控目录得到 STYLE 模块、EXTRA 模块、COLOR 模块，不使用用户提供的任意 Prompt 字符串。
- 建立 allowlist 和兼容性表；Style 定视觉方向，Extra 明确局部结构的合法变化，Color 指定车漆颜色/质感。
- 若 Style 默认颜色与用户选择冲突，**显式 Color 胜出**，且不得把两个冲突颜色句子同时送模型。若 Extra 与 Style 不兼容，生成前拒绝或要求重选，不做静默降级。
- 根据 Extra 选择**动态生成 PRESERVE 约束**：宽体允许局部翼子板变化，但保留车门/轴距/玻璃；尾翼允许新增尾翼，但保留翼子板；不会同时说“加尾翼”和“禁止新增任何尾翼”。
- 同一个被冻结的 snapshot 同时驱动确认摘要和 Provider Prompt，记录模板版本/能力/底图/参数/费用/任务关联，确保可复现和有据可审。
- 不产生额外 LLM 费用或时延。若采用支持直接图像编辑的接口，图片编辑模型本身就能解释描述；无需独立文字大模型预处理。

**B：LLM 先生成或改写 Prompt，再用图片模型（后续对照试验）**

- 优势：未来处理自由文字、丰富车型上下文、复杂多目标描述时可能更灵活。
- 代价：额外请求、费用和时延；有改错部件/引入不受支持项、输出漂移的问题；模型可能编造照片里没有的事实。
- 真要加：先让受信任的确定性组合器输出规范的结构化 JSON，LLM 仅能输出受约束的 `allowed_changes/preserve/realism`，需经 schema、allowlist、语义互斥核验，不允许更改底图、附加改件、调用次数、报价、能力范围。
- 首发**不默认串行 LLM**。只有在同照片、同模型、同组合的实际 A/B 试验证明它能提升被用户保留的结果，且经济性成立，才考虑开启。

## 四、FORM 当前代码为何不支持直接接

| 现有文件 | 已有合同 | 需要审阅的修改 |
|---|---|---|
| `shared/v2/edit-plan.ts` | schemaVersion=2, operation=`explore/detail`；只处理 bodyColor、wheelColor、bodyFinish、wheelDesign | 新 `compose` 意图或经过审核的 schemaVersion=3；增加 style/extra/color ID、约束、可见范围等字段；兼容已保存 V2 |
| `server/v2/plans.ts` | `explore` 有额外 edits 则报 `EXPLORE_OVERRIDES_UNSUPPORTED` | 新预设解析/组合互斥校验/能力发布/费用冻结；不能简单放开所有 edits |
| `server/v2/presets.ts` | 8 个历史 styleId 主要映射颜色 | 真正 Style 类型与 Extra 分类、版本化产品目录；历史 style 不被静默改义 |
| `shared/v2/provider-prompt.ts` | 明确禁止 Body Kit、Spoiler | 根据受允许 geometry 生成条件式约束；固定模板版本，保留旧方案审计能力 |
| `server/v2/provider-profile.ts` | 已审核能力只涵盖现有字段 | 独立、经质量验证后的 CreativeBuild 能力旗标/Provider Profile；不可让客户端控制 |
| F13/F14/F16/F17 | 组件可离线操作但未 F32 接入 | 三选项面板、一次确认、真实来源/版本保存、结果继续创作；不能改动已有账户/幂等/钱包规则 |

不能把用户这次对产品方向的认可，偷换成审批不受限制的模型能力、任务 allowlist、付费测试或生产接线。Codex 应先提最小任务和规格修订，审核后再在已有 V2 模块增量实现，而不是重新造 V3 平台。

## 五、第一批真实质量试验的最短路径

**零付费阶段已能做：** 参考 `compose.mjs` 编排并离线测试模式、互斥、身份保护和生成计划快照；对当前真实 Prompt 代码进行反例审计；梳理最小样本、预算上限、受支持的提供商 profile。

**需要另外审批的小额实验：** 3 张授权照片 × 3 套典型组合 = **9 次计划真实调用**，各组合共享模型、分辨率、配置与输出次数1。记录每次完整成本（失败计入），车型保真、结构改件是否出现、漆面准确度、视觉惊喜感和真实意愿。除摄影角度不匹配的改件需事前排除，不允许生完只保留好的结果。小样本仅为能力/创意快速筛选，不代表通过完整 S06 质量门槛。

如果模型不能稳定做宽体、尾翼，优先测试别的模型/更适配的图像编辑工作流，而不是自欺欺人地一层层追加 LLM。确定模型效果后再决定付费目录和 StoreKit 价格。先做赚钱所需核心玩法，不增加虚拟社区或无限多选。

## 六、一次收费与用户体验不变量

- 用户选 Style/Extra/Color 均在本地/草稿中进行，展示的是原图，**不触发三次生图**。
- 点击 Generate 后，服务端对合法组合出一份不可变报价，确认前告知实际扣费 1 次/单位数，服务端唯一 submissionId，失败/退款沿用现有既定机制。
- 不在每次生成前添加未经记录的 LLM 调用。若图像服务自身处理或改写提示词，应按供应商实际返回的可审计信息记录，不假装已知其内部改写内容。
- Refine 当前版本选精确 versionId；从原图再试显式 original；任何预览、历史选择、分享静态图片不触发模型。
- 把每个上架卡片映射到真实、可授权的同车 before/after 质量样本，不靠概念图误导用户。
