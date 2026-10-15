# PR #10 独立复审与修正记录（2026-10-15）

## 范围与结论
在研究 Draft PR #10 上直接补丁修复了独立线框原型 `03_INTERACTIVE_WIREFRAME.html`。没有修改 `src/`、`server/`、`shared/`、依赖或正式产品入口。此处全部任务/余额/版本均为**离线模拟**；不代表真实 API、Apple 支付或 AI 质量已验证。

## 本次查出的严重问题
| 等级 | 旧原型行为 | 修正 |
| --- | --- | --- |
| P0 | terminal task 反复调用 `finishTask()` 可重复创建 Version 或重复返还 credit | 加 `settled` 一次性结算门控；用户操作只允许 queued 状态取消，终态禁止再次变更 |
| P0 | localStorage 恢复 task 数据，但计时器在重载后丢失，任务卡住 | 在 init 恢复**离线模拟**时间线；uncertain 保持待查，不能自动标记成功 |
| P0 | Result/Compare/Favourite/Refine 默认使用最新版本，Garage 点击旧版本不能只查看它 | 加 `viewVersionId`，Garage 点击版本打开指定 Result，相关操作都使用选中版本 |
| P0 | 在有 Style 的状态可切到旧版本，形成 S01 不批准的 explore + version 请求 | Source/Look/Colour 入口校验；报价前阻止不支持的组合；Style 仅从原图探索 |
| P1 | 草稿保存失败或已有任务进行中仍可走创建流程 | 提交前重新检查模拟草稿/活跃任务/余额/离线状态 |
| P1 | 写成“Server quote”易让用户把常量 1 credit 当成真正服务端报价 | 改为 `SIMULATED quote`，生产环境必须使用后端 immutable quote |
| P1 | 图标控件 32px，小字 11px | 补 44px 最小交互区域、caption 最低 12px 的研究补丁 |

## 设计问题仍需负责人决定
- **一屏 Change list 是否真能让首次车主理解？**它避免隐藏 intent，却可能把“改色”和“完整风格”的互斥规则变成一堆禁用选项；必须对比「先选改造方向」「上传或选车」「确认生成」的简化流程。
- **页面返回和草稿如何持久化？**原型 localStorage 只是演示；不能直接移植到生产身份/私有图片会话。
- **同一任务与多个结果版本**：正式端依赖服务端 task/quote/submission 及 source digest，绝不能用浏览器计时器/本地余额冒充实现。
- **用户自己的照片并未真正展现**：原型上传只保存文件名，车图仍为 SVG；只可用于导航和状态检验，不能评价“我的车在屏幕中央”的体验。
- **素材无法评价付费吸引力**：占位符和模拟变色不验证模型的同车输出能力。

## 验证边界
本次原型中的内联 JavaScript 已做语法解析校验（PASS）；并通过仓库连接确认写入研究分支。**原 Agent 的 34/34 Puppeteer PASS 仅适用于它提交的旧版本，不可当作本次修改的回归通过结果。** 当前会话未获得可运行的新分支本地文件/网络克隆能力，因此未重跑浏览器自动化和真机检查；状态为 `NOT RUN`。

## 下一位审核者的回归检查
1. 初次请求 succeeded 后再次触发完成、再次点 View result，不允许生成 Version 2，也不允许改变余额。
2. failed/cancelled 再次调用结算，不允许两次退款；processing 时取消必须不生效。
3. queued/processing 刷新后恢复同一个 submission ID；uncertain 必须保持未知而非假成功。
4. Garage 选 V1（即使已有 V2），Result/Compare/Favourite/Refine 必须是 V1；切换车辆不得混淆来源。
5. Style 草稿在 Original 上合法，尝试切到 V1 必须阻止；Detail 基于指定 V1 可独立提交。
6. 草稿保存失败和活跃任务存在时，确认提交必须受阻。
7. 再跑 320/375/390/430 宽度、VoiceOver 与 iPhone WebView；由可执行 QA 记录真实结果。
8. 引入真实后端之前进行任务幂等、报价过期、同步余额和归属权限独立审查。

**不建议直接批准该 PR 合并。**先完成一轮独立浏览器回归和目标用户任务测试，再由 Owner 批准交互契约。
