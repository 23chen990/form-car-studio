# FORM iOS 交互原型 QA 报告

> 对应原型：`03_INTERACTIVE_WIREFRAME.html`
> 测试脚本：`qa/qa_puppeteer.mjs`
> 结果文件：`qa/qa_result.json`

---

## 一、测试环境

| 项目 | 值 |
|---|---|
| 浏览器 | Chromium 1243（Playwright 缓存，headless） |
| 驱动 | Puppeteer 25.10.0 |
| 执行路径 | `/Users/kker/.workbuddy/binaries/node/workspace/run_form_qa.mjs`（脚本源码在 `qa/qa_puppeteer.mjs`） |
| 视口 | 外框 1400 × 1100，设备截图 320/375/390/430 × 844，@2x |
| 测试时间 | 2026-10-15 |

---

## 二、测试范围

- 390 × 844 主尺寸完整路径
- 320 / 375 / 430 宽度响应式检查（无横向溢出）
- 首次探索完整路径（Discover → Photo → Workspace → Confirm → Task → Result → Compare）
- 已有版本再修改路径（Garage → Refine → Add change → Color → Confirm → Result）
- 异常路径：无额度、生成失败、草稿保存失败、任务取消、刷新恢复
- 基础可访问性：icon-only 按钮 aria-label、颜色不单独承载信息

---

## 三、测试结果摘要

**全部通过**：34 条断言全部 PASS，无 console / pageerror。

关键通过项：

- 首次用户无车时进入 Add your car，有车时进入 Choose a car。
- 选定的 Look 能带入 Workspace，base image 保持未变化。
- Create 打开 Confirm sheet，显示真实 cost/balance。
- Task 状态从 queued → processing → succeeded 自动推进。
- Result 页明确标注 “SIMULATED RESULT”。
- Refine 以指定 Version 为 base；Add change → Body colour 立即写入 draft。
- Garage 能列出 Original、Version 1、Version 2，版本不被覆盖。
- 无额度时 Create 按钮 disabled 并显示原因。
- 生成失败时任务进入 failed，credit 返还。
- 草稿保存失败显示 error banner，Retry 后清除。
- 刷新页面后恢复同一 queued 任务；取消后释放 credit。
- 320/375/430 宽度无横向溢出。

---

## 四、失败记录

无。

---

## 五、修复记录

| 问题 | 原因 | 修复 |
|---|---|---|
| 颜色选择后底部 CTA 无法点击 | “Refining Version 1” toast 遮罩拦截了点击事件 | 给 `.toast-wrap` 添加 `pointer-events: none`，仅内部 Undo 按钮响应点击。 |
| Add change 中 Body/Wheel 选项无法打开颜色 sheet | `data-act` 写成 `open-color:body`，导致 handler 未匹配；应拆为 `data-act="open-color" data-v="body"` | 修改 `sheetAdd()` 的 `item()` 函数支持 `data-v`。 |
| Discover look 卡片名称截断 | 卡片宽度 132 px 无法容纳 “Color Forward” | 调整为 154 px。 |

---

## 六、截图清单

见 `screenshots/` 目录，共 18 张：

| 文件名 | 内容 |
|---|---|
| `01_discover.png` | Discover 首页（390） |
| `02_photo.png` | Add your car |
| `03_studio_with_look.png` | Workspace 已带 Look |
| `04_confirm_sheet.png` | 生成确认 sheet |
| `05_task_queued.png` | Task queued 状态 |
| `06_task_succeeded.png` | Task succeeded 状态 |
| `07_result.png` | 结果页（Version 1） |
| `08_compare.png` | 前后对比 |
| `09_add_change.png` | Add a change sheet |
| `10_color_sheet.png` | Body colour sheet |
| `11_studio_with_colour.png` | Workspace 已加 Body colour |
| `12_result_v2.png` | 结果页（Version 2） |
| `13_garage.png` | Garage 版本列表 |
| `14_no_credits.png` | 无额度禁用状态 |
| `15_failed.png` | 生成失败 + credit 返回 |
| `16_draft_error.png` | 草稿保存失败 |
| `17_width_320.png` | 320 px 宽度 |
| `17_width_375.png` | 375 px 宽度 |
| `17_width_430.png` | 430 px 宽度 |
| `18_reloaded_task.png` | 刷新后恢复任务 |

---

## 七、未测试项（NOT RUN）

以下项目因超出本次低保真原型范围，未实际运行：

- 真实 iPhone / iOS WebView 上的单手操作、安全区域、Dynamic Type。
- VoiceOver / Switch Control / 实体键盘导航。
- 真实相册/相机权限、HEIC 解码、iCloud 下载、原生分享 sheet。
- 真实网络延迟、服务端 quote、任务队列恢复、App Store 购买。
- 真实 AI 图片生成与质量评估。
- 8–12 名目标用户的可用性测试。
- 真实授权同车案例对首屏吸引力的影响。

---

## 八、已知限制

1. 所有结果图都是 SVG 占位图，明确标注 “SIMULATED RESULT / NOT A MODEL OUTPUT”，不能用于评估视觉吸引力。
2. 颜色选择用真实 hex 显示在颜色 chip 和结果占位图中，这是为了验证交互，不代表真实生成输出。
3. 购买流程仅做文案说明，没有调用 StoreKit。
4. 原型工具面板（宽度、主题、异常模拟、Seed）仅用于测试，不属于产品 UI。


---

## 九、2026-10-15 独立审查追加验证（新 HEAD，区别于原报告）

研究分支原型已增加任务结算幂等门控、版本选择 ID、报价条件约束，以及离线任务恢复的模拟逻辑。**上文“34/34 PASS”属于 Agent 的原始交付版本，不适用于该次补丁的全量浏览器回归。**

- 在隔离 JavaScript 执行环境中直接调用了原型的动作处理程序，对最新原型进行 **12/12 项状态级回归检查（PASS）**：预留扣减一次、成功单版本、拒绝终态重入、结果版本绑定、细化来源、余额不足拦截、再次生成保存父版本、取消返还一次、禁止重复返还、Garage 选择旧版本、拒绝 Style+旧版本、草稿失败阻断创建。
- 已将对应的**无第三方依赖**的可重复测试脚本提交到 `qa/qa_state_regression.mjs`。复核方式：在 Node 环境运行 `node design/form-ios-ux-redesign/qa/qa_state_regression.mjs`。
- 原型内联 JS 语法检查：PASS。
- 最新 HEAD 的完整浏览器端 Puppeteer 测试：**NOT RUN**（本会话无法将 GitHub 连接器中的文件同步到浏览器本地测试工作目录）。
- 真实 iPhone / Capacitor / StoreKit / paid model / user research：**NOT RUN**。
- 更多证据与剩余风险见 `08_INDEPENDENT_REVIEW_AND_FIXES_ZH.md`。

以上修复和状态检查只证明研究原型在所测模拟条件下的逻辑，不证明真实后端扣费、任务恢复、同车质量、商业转化或 iOS 上的手势/无障碍。
