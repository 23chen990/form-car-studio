# FORM 新版用户旅程与信息架构

> 本文档回答一个核心产品决策：**用户应该先选择汽车风格，还是先上传自己的汽车？**
> 并在此基础上给出新的信息架构、两条核心流程和与现有规范的映射。

---

## 一、两种入口方案比较

### 方案 1：先看案例 → 选风格 → 上传 → 生成

即 A4 当前的主要路径。

| 维度 | 表现 | 风险 |
|---|---|---|
| 首次吸引力 | 高：用户一打开就看到一辆车能变成什么样。 | 需要真实授权同车案例；概念图会破坏信任。 |
| 认知门槛 | 中低：用户先被结果吸引，再理解“要我上传”。 | 如果案例与自己的能力不匹配，会产生落差。 |
| 到第一次生成的负担 | 4–5 步：Discover → Photo → Ready → Confirm → Task。 | 每换风格都要重新经过 Photo，重复上传。 |
| 修改已有作品 | 弱：没有“使用已有车”的快捷入口。 | 导致用户把车当作一次性消耗品。 |
| 付费信任 | 中：Confirm 阶段说明成本，但上传前没有价格暗示。 | 用户可能在最后一步才发现要付费。 |
| 当前能力支持 | 支持：S01 的 explore 操作就是 `styleId + original`。 | 不能让用户在 explore 上再叠加颜色覆盖。 |

### 方案 2：先上传 → 车库/工作台 → 选方向 → 生成

即把“上传”作为第一步，车成为长期对象。

| 维度 | 表现 | 风险 |
|---|---|---|
| 首次吸引力 | 低：用户还没看到任何“我的车能变成什么样”就被要求上传。 | PR #6 明确指出：跳过可信案例直接催上传，用户会问“凭什么把照片给你”。 |
| 认知门槛 | 中：用户理解“这是我的车，我来改它”。 | 需要先建立对产品的基本信任。 |
| 到第一次生成的负担 | 4–5 步，但前段体验冰冷。 | 上传后如果看不到吸引人的方向，流失率高。 |
| 修改已有作品 | 强：车一旦存在，所有创作都围绕它。 | — |
| 付费信任 | 高：用户在“这是我的车”的语境下看价格。 | 但前提是已经留下来。 |
| 当前能力支持 | 支持：S01 支持 original/version 作为 source。 | — |

### 推荐：方案 1 为“首次入口”，方案 2 为“长期骨架”

**不是折中，而是把两个方案放在不同生命周期：**

1. **第一次打开**：用“可信同车案例 + 风格方向”建立动机（方案 1）。
2. **一旦上传过一次**：车进入 Garage，后续所有创作从 Garage 开始，不再重新上传（方案 2）。
3. **Discover 对返回用户**：顶部直接显示“继续修改 [车名]”和进行中的任务，把“再看案例”降级为次要动作。

**核心结论：**

> 上传不是流程步骤，而是“车辆入库”的一次性事件。首屏负责让用户愿意入库；车库负责让用户持续创作。

---

## 二、新的信息架构

### 2.1 顶层导航（长期存在）

只保留两个 Tab，符合 HIG “fewer tabs easier to navigate”：

| Tab | 内容 | 备注 |
|---|---|---|
| **Explore** | 真实/授权案例、风格方向、返回用户的“继续”卡片、进行中的任务。 | 不是营销落地页，是创作入口。 |
| **Garage** | 我的车（每辆 = Original + Versions）+ 收藏。 | 版本不可覆盖，每行可进入新的创作草稿。 |

**Your Car / Studio / Workspace** 不是 Tab，而是**临时创作会话**（temporary session）。

### 2.2 临时创作会话的四个状态

| 状态 | 定义 | 例子 |
|---|---|---|
| **Base（来源）** | 当前修改所基于的照片或版本。 | Original photo / Version 1 |
| **Draft（草稿）** | 尚未提交的变更清单，可免费撤销。 | Look: Street Sport；Body: Steel blue |
| **Task（任务）** | 已确认、已扣费、正在执行的生成任务。 | submissionId: sub_xxx，status: queued |
| **Version（版本）** | 成功生成后不可变的成果。 | Version 2 from Version 1 |

一个会话 = `{ base } + { draft } → { task } → { version }`。

### 2.3 草稿模型：Change List

意图不再是一个隐藏模式，而是清单内容本身：

```
Your changes
├─ Full style: Street Sport          [×]
```

或

```
Your changes
├─ Body color: Steel blue            [×]
├─ Wheel color: Bronze               [×]
```

规则：

- **Look 与 Detail 互斥**：已有 Look 时，Body/Wheel 选项禁用并说明原因；已有 Detail 时，Full style 禁用。
- **互斥由前端强制执行**，因为 S01 已禁止 explore preset + 用户覆盖的组合。
- 每项右侧 `×` 移除该变更；Reset 清空全部；Undo 在 Reset 后通过 toast 恢复。

---

## 三、两条核心流程

### 流程一：Explore a Look（第一次被吸引）

目标：简单、直接、让用户期待结果。

```
Discover
  └ Try this look on my car
      └ [if 无车] Add your car → Photo → Use this photo / sample car
      └ [if 有车] Choose a car
          └ New look workspace（draft.look = Street Sport）
              └ Review your request（Confirm sheet）
                  └ Task（queued → processing → succeeded）
                      └ Result
```

**操作数**：首次用户 5 步（含上传）；返回用户 4 步（含选车）。

### 流程二：Refine a Version（可控修改）

目标：清楚知道在改什么、不改什么。

入口可以是：

- Discover → “Or change just one colour”
- Garage → Original row / Version row
- Result → “Refine this version” / “New look from original”

```
Garage
  └ Version 1
      └ New look workspace（base = Version 1, draft 为空）
          └ Add a change → Body color: Steel blue
          └ Review your request（Confirm sheet）
              └ Task → Result（Version 2）
```

**操作数**：4 步。

---

## 四、流程图

见同目录 `07_FLOW_DIAGRAM.html`，包含两条主路径的可视化流程图。

以下是最小 ASCII 摘要：

```
Explore a Look                 Refine a Version
───────────────                ────────────────
Discover                       Garage
   │                               │
   ▼                               ▼
Add/Choose car ──► Workspace   Version/Original ──► Workspace
   │                               │
   ▼                               ▼
Confirm sheet                  Add change
   │                               │
   ▼                               ▼
Task                           Confirm sheet
   │                               │
   ▼                               ▼
Result                         Task
                                   │
                                   ▼
                                Result
```

---

## 五、为什么新方案更符合 iOS 习惯

1. **Tab bar 只用于导航**：Explore / Garage 两个 Tab，符合 HIG “Use a tab bar to support navigation, not to provide actions”。
2. **返回语义一致**： pushed 会话使用 back chevron 返回上一页；Task 结束后的“Back to Garage”用文字按钮，不再用 back 图标做 Tab 切换。
3. **Sheet 用于临时选择**：颜色、来源、确认都用底部 sheet，带 grabber 和 Done，符合 `sheets.md` 中“medium detent 用于渐进披露”的指引。
4. **单次任务用 Sheet 确认**：`modality.md` 建议“modal tasks simple, short, streamlined”，Confirm sheet 只显示摘要和单一确认动作。
5. **草稿自动保存**：离开 Workspace 不弹窗确认，因为草稿已持久化；只有真正会丢失数据时才提示（如 draft save failure）。
6. **44 pt 触控区域**：低保真原型使用 Intent wireframe kit，按钮最小高度 40/48 px， icon 按钮 44 px，符合 `accessibility.md`。

---

## 六、取舍与风险

| 取舍 | 说明 |
|---|---|
| **去掉了 Look 的 Apply** | 好处：少一步；风险：用户可能担心误触。缓解：清单中可立即移除，且草稿不扣费。 |
| **去掉了全局 Undo 按钮** | 好处：避免“撤销的是哪一步”的认知负担；风险：习惯全局 Undo 的用户需要适应。缓解：Reset 后提供 toast Undo。 |
| **占位图替代真实车图** | 好处：零版权风险、强调结构；风险：无法评估视觉吸引力。缓解：明确标注“此处应替换为授权同车案例”。 |
| **Discover 对返回用户变短** | 好处：减少营销噪音；风险：如果返回用户想探索新风格，需要滚动或切 Tab。 |

| 风险 | 严重程度 | 缓解 |
|---|---|---|
| 真实授权同车案例不足 | 高 | 这是 PR #6 已指出的能力闸门；UI 不能替代素材。 |
| 用户不理解 Change List 互斥 | 中 | 禁用项带明确原因文案；清单实时反馈。 |
| 颜色选择无实时视觉反馈 | 中 | 这是产品约束（选择颜色只改草稿）；需文案强调“Generate to update the image”。 |
| 单 Workspace 承载两种意图 | 中 | 用清单内容表达意图，避免模式切换。 |

---

## 七、尚未验证的内容

- 8–12 名真实欧美男性车主的可用性测试。
- 真实 iPhone 设备上的单手操作、安全区域、Dynamic Type、VoiceOver。
- 真实网络延迟下 Task 等待与恢复体验。
- 真实授权同车案例对首屏吸引力的影响。
- App Store 购买流程与信用卡/余额不足的完整链路。
- Wheel color 之外的部件（如 body finish）在真实模型上的表现。
