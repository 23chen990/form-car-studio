# FORM iOS 交互规范（低保真原型版）

> 本规范对应 `03_INTERACTIVE_WIREFRAME.html` 中的实现，并说明未来落地到 FORM 生产代码时需要遵守的边界。
> 所有文案为英文；正式产品文案需由 `/articulate` 再做一轮打磨。

---

## 一、页面与导航

### 1.1 顶层导航

- **Tab 仅两个**：Explore、Garage。
- Tab bar 只在 Tab 根页面（Discover、Garage）显示；进入临时创作会话后隐藏，用 pushed navigation 的 back 按钮返回。
- 参考 HIG `tab-bars.md › Best practices`：Tabs navigate, they don't act.

### 1.2 会话结构

```
Tab root (Discover / Garage)
    └── pushed session
            ├── Add your car / Choose a car
            ├── New look workspace
            ├── Task
            ├── Result
            └── Compare
```

- 从 Result 返回 Garage 时，清理已成功的任务状态，避免 Garage 顶部长期显示旧任务 banner。
- Back 按钮永远返回真实上一级；不允许用 back chevron 做 Tab 切换。

### 1.3 安全区域与单手操作

- 状态栏 44 pt、底部 home indicator 区域 34 pt 由设备框架保留。
- 底部固定 CTA 位于拇指可达区域（屏幕下半部）。
- Sheet 使用 medium detent，保证车图始终可见，避免“选择颜色时看不到车”。

---

## 二、底部 Sheet 规则

### 2.1 通用

- 每个 sheet 必须包含：
  - 顶部 grabber（视觉上可拖动）。
  - 清晰标题（例如 “Body colour” / “Review your request”）。
  - 至少一种关闭方式：Done、Cancel/Keep editing、点击 scrim、向下滑动。
- 参考 HIG `sheets.md`：“Display only one sheet at a time from the main interface.”
- Sheet 内只做单一短任务；复杂任务拆成多个 sheet 或走完整页面。

### 2.2 Sheet 类型

| Sheet | 内容 | Detent | 关闭行为 |
|---|---|---|---|
| **Add a change** | Full style / Body colour / Wheel colour 三选一，互斥项带禁用原因 | medium | 选择即生效，或点 Done 关闭 |
| **Body/Wheel colour** | 颜色网格 + Keep current | medium | 点选即写入草稿并关闭 |
| **Choose a direction** | Look 列表 | medium | 点选即写入草稿并关闭 |
| **Choose source** | Original photo / Version N | medium | 点选切换 base |
| **Review request** | 摘要、Quote、1 image、Cost、Balance | large | 确认后创建任务，或 Keep editing |
| **Request states**（原型工具） | 模拟 queued/processing/uncertain/failed/cancelled | medium | 点选切换状态 |
| **Credits** | 说明购买未接入 | medium | 关闭 |
| **Cancel task** | 确认取消 | medium | Cancel 或 Keep waiting |
| **Leave draft** | 草稿未保存时确认 | medium | Discard / Stay |

---

## 三、来源（Base）规则

### 3.1 来源类型

- **Original photo**：用户上传/示例车的原始照片。
- **Version N**：某次成功生成的结果，不可变。

### 3.2 来源显示

- Workspace 顶部固定来源条：`FROM · Original photo ▾` 或 `FROM · Version 1 ▾`。
- 来源条可点击展开 sheet，列出 Original + 所有 Version。
- 切换来源时，当前 draft 保留；系统显示 toast “Base set to Version 1.”

### 3.3 来源语义

- “Refine this version” → base = 当前 Version。
- “New look from original” → base = Original photo。
- 不允许静默切换来源；任何来源变化必须在来源条中可见。

---

## 四、草稿（Draft）规则

### 4.1 草稿内容

草稿 = 变更清单（Change list），每一项是以下之一：

- `Full style: <Look>`
- `Body color: <Color>`
- `Wheel color: <Color>`

### 4.2 互斥规则

- **Look 与 Detail 不能共存**。清单中已有 Look 时，Body/Wheel 选项禁用，原因文案：
  - “The selected style already sets the paint. Remove it to choose one.”
- 清单中已有 Body/Wheel 时，Full style 禁用，原因文案：
  - “Remove your colour changes first. A full style sets the whole look.”
- 该互斥由前端强制执行，对应 S01 对 explore preset 的约束。

### 4.3 选择即生效，无需 Apply

- 点选颜色/风格立即写入草稿，sheet 关闭。
- 不需要 “Apply” 按钮，因为：
  - 草稿可免费撤销；
  - 唯一不可逆/扣费动作是生成确认；
  - 清单实时显示当前选择，用户可见。

### 4.4 撤销与重置

| 操作 | 行为 | 是否需要确认 |
|---|---|---|
| **Remove（×）** | 移除该项，恢复为 Keep current | 否 |
| **Reset** | 清空整个清单 | 否；但提供 toast Undo |
| **Undo** | 仅在 Reset 后的 toast 中出现；恢复 Reset 前的清单 | 否 |
| **切换 base** | 保留当前 draft | 否 |

### 4.5 自动保存

- 草稿自动持久化；离开 Workspace 不弹窗。
- 仅当 draft save 失败时，显示错误 banner + Retry；此时如果用户坚持离开，才弹出 “Leave this draft?” 动作表。

---

## 五、生成确认规则

### 5.1 确认前必须满足

- 至少有一项有效变更（`hasChanges() === true`）。
- 服务端 quote 成功返回。
- 余额 ≥ 报价。
- 非离线状态。

### 5.2 Confirm sheet 内容

- Base 缩略图 + 名称。
- 变更摘要。
- “Everything else: kept as it is”。
- “You receive: 1 new image”。
- “Cost: N credits / Balance after: M credits”。
- 明确提示：Quote comes from the server.（原型模拟）。

### 5.3 禁用状态文案

| 条件 | CTA 状态 | 说明文案 |
|---|---|---|
| 无变更 | disabled | “Choose at least one change before generating.” |
| 离线 | disabled | “You are offline. Reconnect to create a new look.” |
| 余额不足 | disabled + Buy credits | “Not enough credits. This look costs N credits, you have M.” |
| quote 不可用 | disabled | “Purchases are not available right now. Retry or contact support.” |

### 5.4 购买与生成分离

- 点击 Buy credits 打开 App Store 商品，**购买成功不自动触发任务**。
- 用户必须回到 Confirm sheet 再次点击 “Create 1 look”。
- 对应 S05 固定文案与 S03 额度规则。

---

## 六、任务（Task）规则

### 6.1 任务状态

只显示真实状态：

| 状态 | 标题 | 说明 |
|---|---|---|
| queued | “Waiting to start.” | “You can leave this screen. Your task will continue.” |
| processing | “Creating your look.” | “Processing is reported by the server. You can leave this screen.” |
| uncertain | “Checking an interrupted request.” | “We will not submit it again automatically.” |
| succeeded | “Your look is ready.” | “One image was created from your request.” |
| failed | “This look was not completed.” | “Your credit was returned. Your draft is still available.” |
| cancelled | “Request cancelled.” | “Nothing was charged.” |

- **不允许**：百分比进度条、假 AI 分析步骤、倒计时、“30 秒必成”。

### 6.2 任务恢复

- 任务 ID（submissionId）稳定；刷新或重新打开应用后，通过同一 ID 恢复同一任务。
- 进入 Garage 时，如果任务仍在 queued/processing/uncertain，顶部显示恢复入口。
- 任务成功后，不在 Garage 顶部继续显示任务 banner；结果进入版本历史。

### 6.3 取消规则

- 仅在 **queued** 状态可取消；processing 状态只能等待或稍后查看。
- 取消后释放已预留 credit。

---

## 七、结果页规则

### 7.1 结果展示

- 默认大图，完整显示车辆，不裁剪。
- 明确区分：
  - 这是生成结果；
  - 这是占位图/模拟结果（原型中）。

### 7.2 结果动作

| 动作 | 行为 | 是否扣费 |
|---|---|---|
| Compare | 打开对比页，左右滑动查看 base vs result | 否 |
| Favourite | 标记当前版本为收藏 | 否 |
| Save photo | 打开 iOS Save/Share sheet | 否 |
| Refine this version | 以当前版本为 base 打开 Workspace | 否（生成时才扣费） |
| New look from original | 以 Original photo 为 base 打开 Workspace | 否（生成时才扣费） |

- “Saved to garage” ≠ “Favourite” ≠ “Saved to Photos”，三者明确分开。

---

## 八、异常处理

| 异常 | 触发 | UI 反馈 | 恢复 |
|---|---|---|---|
| 上传失败（格式/大小） | 选择照片后校验 | callout error： “We could not open that photo. Try another.” | 重新选择 |
| 草稿保存失败 | 持久化失败 | callout error + Retry 按钮 | 点击 Retry |
| 无额度 | Confirm 时 quote 失败 | CTA disabled + 原因 + Buy credits | 购买后再次确认 |
| 离线 | Confirm 时无网络 | CTA disabled + 离线文案 | 联网后再次确认 |
| 生成失败 | Task processing 后失败 | failed 状态 + “credit returned” | 从 draft 重试 |
| 任务中断 | 处理中异常 | uncertain 状态，随后自动恢复或失败 | 无需用户操作 |
| 重新进入应用 | 本地存储恢复 | 恢复 active task 和 draft | 继续 |

---

## 九、可访问性

- 所有 icon-only 按钮带 `aria-label`。
- 颜色不单独承载信息：禁用原因用文字说明，选中状态用边框 + 图标 + 文字。
- 最小触控目标 44 × 44 pt（kit 按钮高度 40/48 px，icon 按钮 44 px）。
- 支持 `prefers-reduced-motion`：禁用过渡。
- 后续真机需验证 Dynamic Type、VoiceOver 阅读顺序、Switch Control。
