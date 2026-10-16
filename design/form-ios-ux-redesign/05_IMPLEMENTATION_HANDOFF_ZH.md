# FORM 新方案实施交接说明

> 本文件说明 UX 方案未来如何对应到 PR #3 中已有的 F12–F17 任务与组件，并指出哪些改动是纯前端调整、哪些会改变已冻结的产品或服务契约、必须额外审批。

---

## 一、现有任务与组件概览

| 任务 | 现有文件/模块 | 当前职责 |
|---|---|---|
| F12 | `src/features/photo/PhotoIntake.tsx`、原生 Photo 工作 | 本地照片选择、HEIC/iCloud、相机权限、上传前处理、授权同意 |
| F13 | `src/features/discover/DiscoverEntry.tsx`、`src/features/navigation/entry.ts` | Discover 入口、能力闸门、publishedExample、recent entries |
| F14 | `src/features/editor/DraftEditor.tsx`、`src/features/confirm/ConfirmLook.tsx` | 草稿编辑、确认、quote、提交 |
| F15 | `src/features/task/task-wait.tsx` | 任务状态、恢复、取消 |
| F16 | `src/features/result/ResultView.tsx` | 结果展示、对比、收藏、保存 |
| F17 | `src/features/garage/GarageView.tsx` | 车库、版本历史、封面、收藏 |

S01（`docs/form-handoff/specs/01-editing.md`）是后端契约的冻结规范；S05（`docs/form-handoff/specs/05-ui-ios-copy.md`）是 UI 文案与行为的冻结规范。

---

## 二、新 UI 屏幕 → 现有任务映射

| 新屏幕 | 主要对应任务 | 说明 |
|---|---|---|
| Discover 首页 | F13 | 保留 F13 的 `EntryCapabilities`、`publishedExample`、`canExplore`；新增 returning user 区域展示 `RecentEntry`。 |
| Choose a car | F13 / F17 | 复用车库数据，前端新增一个选择态页面；不引入新后端契约。 |
| Add your car | F12 | 与 F12 完全一致，原型仅做本地模拟。 |
| New look workspace | F14 | 合并 A4 的 Ready + Editor；核心改动是“Change list”模型。 |
| Confirm sheet | F14 / F08 | 使用现有 quote API，新增 no-credits/offline 状态。 |
| Task | F15 | 状态文案与取消逻辑不变；新增成功后清理任务 banner 的 UX 规则。 |
| Result | F16 | 新增 refine/new-original 的显式来源选择提示。 |
| Compare | F16 | 复用现有对比能力，无后端改动。 |
| Garage | F17 | 从卡片式改为按车分组的 Original + Versions 列表；需要版本元数据。 |

---

## 三、纯前端调整（不改变产品/服务契约）

以下改动可以在现有 S01/S05 框架内直接实现：

1. **Discover 增加 returning user 区**
   - 使用 `entry.ts` 中已有的 `RecentEntry` 类型和 `EntryCapabilities`。
   - 仅影响 `DiscoverEntry.tsx` 的渲染逻辑。

2. **新增 Choose a car 页**
   - 读取 `S.cars`（或后端项目列表），列出 Original 缩略图。
   - 选择后调用 `originalIntent('explore'|'detail', cap)` 得到 `EditRequest`。
   - 纯路由/展示层变化。

3. **合并 Ready + Editor 为 Workspace**
   - 用单一屏幕承载两种意图，通过清单内容区分。
   - 仍向服务端提交 `EditRequest`（`operation: 'explore'` 或 `'detail'`）。
   - 需要新增 UI 组件，但不改变 `edit-plan.ts` 的 schema。

4. **颜色/风格选择无 Apply**
   - 前端状态管理变化：选择立即写入 draft。
   - 不影响 quote 和 task 提交流程。

5. **来源条（Source bar）**
   - 在 Workspace 顶部显示当前 base（Original / Version N）。
   - 数据来源为现有 project/version API。

6. **Confirm sheet 禁用状态文案**
   - 根据 quote 失败原因显示不同文案。
   - 禁用逻辑不变：quote 不可用或余额不足时阻止提交。

7. **Task 页返回按钮改为文字 “Back to Garage”**
   - 仅导航组件变化。

---

## 四、会改变交互契约、需要审批的改动

| 改动 | 为什么需要审批 | 影响范围 |
|---|---|---|
| **Change list 互斥模型** | 它把 S01 的“explore 不能叠加 detail 覆盖”从后端校验提升为前端主交互规则。需要产品确认这是否是期望的用户模型。 | F14 UI + 用户教育文案 |
| **Garage 按车分组 + 版本列表** | 需要 F17 暴露 version 的 parent 和 changes 元数据。如果当前 API 只返回 thumbnail 和 id，则需扩展数据契约。 | F17 API / S02 |
| **Discover 对返回用户优先展示“继续”** | S05 已要求，但具体实现（卡片位置、信息密度）需要产品负责人确认，避免营销内容被过度压缩。 | F13 |
| **Result 页 “Refine this version” / “New look from original” 的显式来源确认** | 可能改变 F16 与 F14 的交接方式：需要确认是否在跳转时强制显示来源条，还是静默设置。 | F16 → F14 |
| **去掉颜色/风格的 Apply 步骤** | 这是交互简化，但产品需确认是否接受“选择即生效、无二次确认”的模型。 | F14 |
| **占位图方案** | 在没有真实授权同车案例前，首屏吸引力无法验证。产品需决定：是否接受占位图做结构验证，还是等 F31 素材。 | F13 / F31 |

---

## 五、不会引入的能力

以下能力**不在**本方案中，也不应被本次实现附带引入：

- Body finish、wheel design、宽体、尾翼、降低车身、灯光、自由提示词、品牌件。
- 订阅、免费试用、自动续费。
- 社交分享上传、自动生成短视频、3D 预览。
- 非授权的竞品图片或真实用户照片入库。
- 真实 AI 生成、真实支付、真实 App Store 购买。

---

## 六、建议的实施顺序

1. **先审批准入**：Change list 模型、Garage 版本列表数据、Discover returning user 区。
2. **F17 数据就绪**：确保版本列表能返回 parent + changes（或至少 label + thumbnail）。
3. **F13 改造**：Discover 新增 returning user 区 + Choose a car 页。
4. **F14 改造**：Workspace 替换 Ready/Editor，Confirm sheet 状态扩展。
5. **F15 改造**：Task 成功后清理任务状态，恢复入口规则不变。
6. **F16 改造**：Result 来源提示 + Compare/Favourite/Save 分离。
7. **F12 不变**：Photo intake 逻辑保持不变，仅入口可能来自 Discover 或 Choose a car。
8. **QA 复测**：320/375/390/430、VoiceOver、异常路径、真实 API 对接。

---

## 七、给工程团队的检查清单

- [ ] Workspace 是否始终显示当前 base？
- [ ] Look 与 Body/Wheel 是否不能同时存在于 draft？
- [ ] Confirm 提交前是否取得真实 quote？余额不足是否禁用？
- [ ] 任务成功后是否创建新版本且不覆盖旧版本？
- [ ] 任务失败后是否释放预留 credit？
- [ ] Garage 是否按车分组，Original 和每个 Version 都能进入新的 Workspace？
- [ ] 所有 icon-only 按钮是否有 `aria-label`？
- [ ] 是否没有调用真实生成/支付 API？
