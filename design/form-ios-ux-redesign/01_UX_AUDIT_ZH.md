# FORM iOS UX 深度审查报告

> 范围：A4 离线交互原型（`/tmp/form_a4/FORM_INTERACTION_RETHINK_A4.html` 及其源码）+ PR #3 冻结规范（S01、S05、S05 RFC v2.1）+ PR #6 竞品研究。
> 状态：设计研究交付，不是已批准的产品规范。
> 方法：按 Evaluate / Journey / Apple Design / Wireframe 四个 Skill 的方法论执行。

---

## 一、审查方法

1. **Evaluate（UX 诊断）**：用 Nielsen 十项启发式 + 反模式扫描，对任务 A–D 做认知走查（cognitive walkthrough）。
2. **Journey（用户旅程）**：重走 0–180 秒首次体验、已有版本再修改、异常恢复三条路径。
3. **Apple Design（HIG）**：检查 tab bar、toolbar、sheet、返回手势、安全区域、44 pt 点击区域、可访问性。
4. **Wireframe（原型）**：把新方案落地为可点击低保真原型，用交互反推架构漏洞。

评估对象不是 A4 的配色或视觉风格，而是其**交互架构**——信息层级、状态边界、导航语义、操作契约。

---

## 二、反模式判定

**判定：Clean（无明显操纵性设计）**

A4 没有预勾选、倒计时、虚假稀缺、隐藏费用或_confirmshaming_。它明确标注了“NOT FORM OUTPUT / MANUAL COLOR STUDY / NO LIVE REQUEST”。

唯一需要持续警惕的是：**模拟结果图如果未来被误当作真实生成案例使用**，会变成“概念图冒充真实 AI 输出”的反模式。本方案通过显式占位图 + “SIMULATED RESULT” 标签继续避免这一点。

---

## 三、启发式总体判定

| 启发式 | 判定 | 决定性发现 |
|---|---|---|
| H1 系统状态可见 | **Strained** | Task 状态诚实，但用户不知道自己处于 explore/detail 哪一种意图。 |
| H2 系统与现实世界匹配 | **Holds** | 术语自然，“Create 1 look”、“Body color” 等符合车主理解。 |
| H3 用户控制与自由 | **Strained** | 有 Reset/Undo/Back，但返回语义在 Task 页被 tab 切换替代。 |
| H4 一致性与标准 | **Broken** | 同一“选择风格”动作在不同位置有立即提交 / Apply 两种契约。 |
| H5 错误预防 | **Strained** | Confirm 无额度/报价失败状态；Reset 无二次确认。 |
| H6 识别而非回忆 | **Broken** | 意图是隐藏变量；Refine/New from original 来源仅靠小字 eyebrow。 |
| H7 灵活高效 | **Strained** | 没有“使用已有车”的快捷入口，每次新风格都回 Photo。 |
| H8 简洁设计 | **Strained** | Discover 有两个相同主 CTA；Task 页多个次要操作同级。 |
| H9 错误识别与恢复 | **Strained** | 异常路径靠原型状态模拟器，真实失败恢复未完整走通。 |
| H10 帮助文档 | **Holds** | 不需要说明书，但部分状态需要更多解释（如“为什么不能加颜色”）。 |

---

## 四、任务走查结果

### 任务 A：第一次探索新造型

| 步骤 | Q1 想做？ | Q2 看到？ | Q3 理解？ | Q4 反馈？ | 判定 |
|---|---|---|---|---|---|
| Discover 理解产品 | 是 | 是 | 是 | 是 | Pass |
| 选择 Look | 是 | 是 | **否** | 是 | Hesitation（rail 立即提交 vs sheet 需 Apply） |
| Try this look → Photo | 是 | 是 | 是 | 是 | Pass |
| 选照片 / 用示例车 | 是 | 是 | 是 | 是 | Pass |
| Ready 页确认 | **否** | 是 | **否** | 是 | Failure（看不到当前是 explore 模式，不能改色且无解释） |
| Confirm → Task | 是 | 是 | 是 | 是 | Pass |
| Result（示例车） | 是 | 是 | 是 | 是 | Pass（但用户自己的车走不到这里） |

### 任务 B：针对自己的车修改颜色

| 步骤 | 判定 | 关键问题 |
|---|---|---|
| Discover → Or change one color | Pass | — |
| Photo | Pass | — |
| Editor | Failure（二） | 用户看到 Body/Wheel 选项，但不确定是否已生效；来源仅靠 eyebrow |
| 选色 → Use this color | Hesitation | 需要 Apply，但原因是为了“技术安全”，对普通用户是额外一步 |
| Confirm → Task | Pass | — |
| Result（自己的车） | **Failure** | 用户自己的车没有 result 页入口 |

### 任务 C：继续修改已有作品

| 步骤 | 判定 | 关键问题 |
|---|---|---|
| 打开 Garage | Pass | — |
| 找到历史版本 | Failure | Garage 只有示例 Concept V1，没有真实 Original + Versions 列表 |
| Refine this version | Hesitation | 点击后来源切换为 Example V1，仅靠小字提示 |

### 任务 D：处理异常

| 异常 | A4 现状 | 是否满足自然恢复 |
|---|---|---|
| 取消选择照片 | 可返回，草稿重置 | 满足 |
| 返回上一页 | 部分路径正确，Task 页返回实际为切 Tab | 不满足 |
| 上传失败 | 无真实失败路径 | 未验证 |
| 草稿保存失败 | 有 leave sheet，但无重试 | 部分 |
| 没有额度 | 无 quote 失败 / 余额不足 UI | 不满足 |
| 生成失败 | 仅状态模拟器，非提交触发 | 未验证 |
| 生成中离开 | Task 返回 Garage，有恢复入口 | 满足（示例车） |
| 重新进入应用 | 未做持久化恢复 | 未验证 |

---

## 五、优先级问题清单

### P0 — 必须解决，否则核心任务无法完成或来源混乱

#### P0-1 用户意图是不可见的隐藏状态
- **位置**：Photo 页之后（Ready / Editor 分流）。
- **表现**：同一个“我想生成一张图”的目标被拆成两个外观相似、底部 CTA 文案也相似的页面；用户看不到当前是在“整体风格”模式还是“改细节”模式。
- **为什么困惑**：H6 识别而非回忆——系统把模式藏在 `state.intent` 里，没有可见对象。
- **影响**：用户可能误以为自己能加颜色到整体风格里，或在 detail 模式下找不到“换一个风格”。
- **建议**：把**意图变成可见的“变更清单”**（Change list）。清单里有什么，就生成什么；look 和 detail 是清单中的两类条目，互斥规则即时可见。
- **证据**：`source/app.js` L20-22 `state.intent`, L36 `ready()`, L38 `editor()`。

#### P0-2 同一语义有两个交互契约
- **位置**：Discover Look rail vs Ready 页 Change look sheet。
- **表现**：Discover 点风格卡片立即切换全局风格；Ready 页 Change → sheet → 必须点 “Use this look” 才生效。
- **为什么困惑**：H4 一致性——用户无法预测“选风格”这一次动作到底要不要确认。
- **影响**：可能误切风格、重复确认、对系统不信任。
- **建议**：统一为“tap 选中即进入草稿”，因为草稿本身可免费撤销；只有**生成**需要确认。
- **证据**：`source/app.js` L68 `set-look` 立即 commit；L76-77 `lookStage` + L81 `sheet-apply` 需要 Apply。

#### P0-3 用户用自己的车无法到达 Result 页
- **位置**：Task 页 → Result 页。
- **表现**：`show-result` 在 `!isSample()` 时 toast “No generated version of your photo exists”，然后只能回 Garage。
- **为什么困惑**：主付费路径（自己的车 → 生成 → 看结果）在原型中断了。
- **影响**：无法评估最重要的一条用户旅程；用户会怀疑“是不是我的车不被支持”。
- **建议**：Result 页必须对所有 base 可到达；结果图用显式占位图并标注“SIMULATED”，而不是把示例车结果当作唯一路径。
- **证据**：`source/app.js` L92 `show-result`, L40 `result()` 固定使用 `ASSETS.graphite`。

#### P0-4 上传被当作每条路径的必经重复步骤
- **位置**：Discover → 每次 begin-explore / begin-detail 都回到 Photo。
- **表现**：没有“使用车库里的车”的入口；已有照片时仍要求重新选择。
- **为什么困惑**：H7 效率——用户在重复完成已做过的事。
- **影响**：降低回访率，增加放弃。
- **建议**：首传是一次性事件；后续从 Discover 进入应走“Choose a car”步骤，列出车库中已有的车 + “Add another car”。
- **证据**：`source/app.js` L69-70 `begin-explore`/`begin-detail` 总是 `goto('photo')`；S05 明确要求 “Returning user sees recent own projects and active work before long marketing copy”。

### P1 — 重大摩擦，可能误导或降低信任

#### P1-1 Ready 页不解释为什么不能改颜色
- **位置**：Ready 页（整体风格路径）。
- **表现**：只有一个“Change look”，没有 Body/Wheel 选项，也没有说明。
- **为什么困惑**：用户会问“我都上传了，为什么不能直接改个色”。
- **建议**：在 change list 语境下，当清单中只有 Look 时，明确提示“整体风格已包含车身和轮毂方向。想要单独改色，请先移除当前风格。”
- **证据**：`source/app.js` L37 `ready()`。

#### P1-2 Task 页返回按钮语义错误
- **位置**：Task 页顶部导航。
- **表现**：返回箭头图标实际执行 `tab-garage`（切 Tab），不是返回上一页。
- **为什么困惑**：违反 HIG `tab-bars.md › Best practices` “Use a tab bar to support navigation, not to provide actions.”
- **建议**：Task 页使用明确的“Back to Garage”或“Close”文字，不要用 back chevron 做 tab 切换。
- **证据**：`source/app.js` L39 `task()` header 使用 `'tab-garage'`，L64 处理 `tab-garage`。

#### P1-3 Garage 没有真实版本历史
- **位置**：Garage 页。
- **表现**：只有“Sample hatchback · Concept V1 / Original”两个示例卡片，没有按车组织的 Original + Versions 列表。
- **为什么困惑**：Task C 要求“打开车库 → 选择历史版本 → 再修改”，但原型用 fake 版本模拟。
- **建议**：Garage 按车分组，每辆车显示 Original 行 + 每个 Version 行，来源和父版本清晰可辨。
- **证据**：`source/app.js` L42 `garage()`。

#### P1-4 Refine / New from original 静默切换来源
- **位置**：Result 页。
- **表现**：点击按钮后直接修改 `sourceVersion` 并跳 Editor，没有显式来源选择。
- **为什么困惑**：H6 识别而非回忆——唯一信号是 eyebrow 小字“EDITING FROM EXAMPLE VERSION V1”。
- **建议**：工作台顶部固定“From · Original photo / Version N”来源条，可点击展开选择；任何来源切换都可见。
- **证据**：`source/app.js` L96-97 `refine-result` / `new-original`。

#### P1-5 Discover 首页有两个相同主 CTA
- **位置**：Discover hero。
- **表现**：hero 图上的右箭头按钮和底部 “Try this look on my car” 都执行 `begin-explore`。
- **为什么困惑**：H8 简洁——两个相同权重的动作让用户犹豫该点哪个。
- **建议**：hero 区域只做展示和滑动对比，唯一主 CTA 放在底部。
- **证据**：`source/app.js` L35 `discover()` bigarrow；L36 CTA。

#### P1-6 没有额度/报价失败的完整处理
- **位置**：Confirm sheet。
- **表现**：没有 no-credits、offline、quote 不可用状态；只有 “Cost in this study 1 credit · illustration”。
- **为什么困惑**：用户不知道余额不足时会发生什么，也不知道购买后是否会自动生图。
- **建议**：Confirm 根据 `quote()` 结果禁用提交并显示明确原因；购买成功不自动触发任务，需再次确认。
- **证据**：S05 固定文案表；S03 额度规则。

#### P1-7 Cancel / Apply / Undo / Reset 规则不一致
- **位置**：Look rail、Look sheet、Color sheet、Status sheet。
- **表现**： rail 立即提交；sheet 需要 Apply；status 立即切换。
- **为什么困惑**：用户无法建立稳定的心智模型。
- **建议**：统一规则——**所有草稿级选择立即生效并可在清单中撤销；只有生成（扣费）需要确认**。
- **证据**：`source/app.js` L68、L76-81、L44-46 status sheet。

#### P1-8 返回用户看不到最近项目
- **位置**：Discover 页。
- **表现**：只有 header 的 “My garage” 链接，没有 recent project cards 或 active task banner。
- **为什么困惑**：S05 明确要求 returning user 先看到自己的项目和任务，再营销。
- **建议**：Discover 顶部放置“Continue with [车名]”和 live task 卡片。
- **证据**：`source/app.js` L35 `discover()`；S05 v2.1。

### P2 — 需要关注，但可后续处理

- P2-1 Reset 按钮位置显眼，虽然可撤销，但在 header 中容易误触。
- P2-2 “Your car” 作为页面标题与 Garage 概念冲突；建议改为 “New look” 或 “Workspace”。
- P2-3 Result 页 Save/Favorite/Save to Photos 同权重，缺少视觉主次。

### P3 — 抛光

- P3-1 Discover eyebrow “A BETTER LOOK STARTS HERE” 对首次用户帮助有限，可弱化。
- P3-2 示例车占位图在 320 px 下仍可辨认，但文字排版可进一步优化。

---

## 六、正面发现（应保留）

1. **诚实标注**：A4 明确区分 Example / Demo / Not FORM output，没有让概念图冒充生成结果。
2. **Base image 不实时变化**：编辑期间汽车原图保持不变，符合 S01 草案要求。
3. **Explore/Detail 入口分离**：虽然执行方式有问题，但“两个意图从两个入口开始”的方向是对的。
4. **一次生成 = 一张图**：Confirm 明确 “1 image”，符合 S03/S05。
5. **车辆完整显示**：使用 `object-fit: contain` 思路，不裁剪车头/车尾。

---

## 七、建议的修复优先级（按 Skill 分组）

| Skill | 负责问题 | 优先级 |
|---|---|---|
| `/journey` | P0-1 意图可见化、P0-4 上传一次性、P1-3 Garage 版本历史、P1-4 来源显式选择 | P0 |
| `/organize` | P0-2 统一交互契约、P1-5 唯一主 CTA、P1-8 returning user 区 | P0/P1 |
| `/fortify` | P1-6 额度/报价/异常状态、P1-7 统一撤销规则、P2-1 Reset 防误触 | P1 |
| `/articulate` | P1-1 “为什么不能改色”解释、P1-2 Task 返回文案、P2-2 页面标题 | P1/P2 |
| `/include` | 后续真机 Dynamic Type、VoiceOver、44 pt 全路径验证 | P2 |
| `/specify` | P0-3 Result 页对所有 base 可到达、来源/清单/提交的工程规格 | P0 |

---

## 八、与冻结规范的冲突点

| 冲突 | 处理 |
|---|---|
| S01 禁止 explore preset 叠加用户覆盖（如颜色） | 新方案用清单互斥规则强制执行，未改变后端契约。 |
| S05 固定文案 “Create 1 look - {units} credit” | 保留在 Confirm CTA；工作区级 CTA 简化为 “Create 1 look”。 |
| S05 要求 returning user 先看到最近项目 | 新增 Discover 顶部最近/任务区，属于前端展示，未改数据契约。 |
| PR #6 竞品洞察：上传应是一次性事件 | 新增 “Choose a car” 步骤，符合洞察。 |
