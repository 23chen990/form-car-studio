# FORM iOS UX 审查与交互重构 — 研究分支入口

> **⚠️ 2026-10-16 最新 Owner 结论：当前两轮 UX 原型均未获认可，仍被明确评价为“交互很差、越改越差”。旧版 Change List、第二版三工具栏，以及之后助手提出的汽车画布都不是已批准方案。后续新 Agent 不得将此前推荐视为最终规范。**
>
> **新 Agent 从这里开始：** [14 Owner 反对与重启](14_OWNER_REJECTION_AND_UX_RESET_ZH.md) → [15 完整交接提示词](15_NEXT_AGENT_FULL_HANDOFF_PROMPT_ZH.md) → [16 助手未批准猜想](16_PREVIOUS_AGENT_CANVAS_HYPOTHESIS_UNAPPROVED_ZH.md) → [11 被否定的最新版原型](11_INTERACTIVE_PROTOTYPE.html) → [13 全部 42 张实测截图](13_SCREENSHOT_GALLERY.html)。
>
> 此页此前的“核心结论”是 2026-10-15 的历史判断，已被 Owner 否定，只能作为研究归档阅读。

---

> 仓库：`23chen990/form-car-studio`  
> 分支：`research/form-ios-ux-redesign`  
> 目录：`design/form-ios-ux-redesign/`  
> 状态：设计研究交付，**不是已批准的产品规范，不合并到 main**。

---

## 本分支包含什么

| 文件 | 用途 |
|---|---|
| `00_START_HERE_ZH.md` | 本文件，快速导航。 |
| `01_UX_AUDIT_ZH.md` | A4 交互架构问题审查，含证据、优先级、根因。 |
| `02_NEW_USER_JOURNEY_ZH.md` | 两种入口方案比较、推荐、信息架构、新流程。 |
| `03_INTERACTIVE_WIREFRAME.html` | **最重要交付物**：可独立打开的 390×844 交互原型。 |
| `04_INTERACTION_SPEC_ZH.md` | 导航、Sheet、来源、草稿、确认、任务、结果、异常规则。 |
| `05_IMPLEMENTATION_HANDOFF_ZH.md` | 新方案如何对应 F12–F17，哪些需审批。 |
| `06_QA_REPORT_ZH.md` | 测试环境、结果、截图、未测试项。 |
| `07_FLOW_DIAGRAM.html` | 两条核心流程的可视化流程图。 |
| `screenshots/` | 18 张关键页面截图。 |
| `qa/qa_puppeteer.mjs` | QA 自动化脚本（需 Puppeteer 环境）。 |
| `qa/qa_result.json` | QA 运行结果。 |

---

## 如何查看原型

1. 打开 `03_INTERACTIVE_WIREFRAME.html`（可直接用浏览器打开，无需服务器）。
2. 建议先看主路径：
   - Discover → **Try this look on my car** → Continue with sample car → Create 1 look → 查看 Task → View result → Compare。
   - 返回 Garage → 选择 Version 1 → Refine → Add a change → Body colour → Steel blue → Create 1 look → View result。
3. 用右下角 **Prototype controls** 模拟异常：无额度、生成失败、草稿保存失败、离线等。
4. 用顶部 **Width** 切换 320/375/390/430 查看响应式。

---

## 核心结论（一句话）

A4 的交互奇怪，根因不是按钮排得不好，而是**“整体风格 / 改细节”两种意图被做成了不可见的隐藏模式**，加上**上传被做成了每条路径的重复步骤**。新方案把意图变成可见的 **Change List（变更清单）**，并把上传降级为“车辆入库”的一次性事件。

---

## 安全与权限声明

- 没有修改 `src/`、`server/`、`shared/`、`package.json` 等生产代码。
- 没有调用真实 AI 图片生成、支付、后端 API。
- 没有引入未验证的汽车改装功能。
- 所有概念素材/结果图都标注为 “CONCEPT PLACEHOLDER / SIMULATED RESULT / NOT A MODEL OUTPUT”。

---

## PR 说明

完成后将创建 Draft Pull Request，标题为 `design: FORM iOS UX audit and interaction redesign`，描述中包含主要 UX 问题、方案变化、测试结果和未验证内容。
