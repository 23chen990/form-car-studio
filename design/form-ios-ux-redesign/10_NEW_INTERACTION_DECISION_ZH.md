# FORM AFTERHOURS｜新版信息架构与交互决定（候选，待 Owner 批准）

> 方案 C：**Explore 建立动机，车始终是 Studio 主角，Garage 保留作品版本。** 本文是 PR #10 的独立后续提案，不能作为生产改造授权。

## 1. 不再暴露 Change List

```
Explore [灵感 + 最近车/任务] ─┬─ 首次：添加照片 ──┐
                            ├─ 返回：选择已有车 ─┤
                            └─ 演示车直接进入 ──┤
                                                ▼
Garage [车辆/版本] ─── 指定 Original 或 Version ─► Studio [大图]
                                                  ├── Style [Original only]
                                                  ├── Paint [Original/Version]
                                                  └── Wheels [Original/Version]
                                                       │
                                            本次草稿 + Review sheet
                                                       │
                                             明确一次性确认
                                                       │
                                           Task [可离开/恢复]
                                                       │
                                      Simulated Result / 真正 Version
                                                       │
                                       Compare · Favorite · Refine
```

根 Tab 仅 Explore 与 Garage，Tab **只做导航**。工作台为临时的 pushed session，不作为第三个 Tab；Review 与颜色选择为 Sheet，不再新增列表页面。重要返回路径：Explore→Studio→Back 回 Explore；Garage→Original→Studio→Back 回 Garage；Garage→V1 Result→Refine→Studio→Back 回 V1 Result；Compare→Back 回当前选定版本；Task→Back to Garage，不假装是回到编辑器。Sheet 的关闭/ESC 只结束当前 Sheet。

## 2. 屏幕与关键决定

| 场景 | 用户要知道的事 | 要求的唯一主要操作 | 删除的负担 |
|---|---|---|---|
| Explore | 这是一家能用车图探索造型的工作室；画面只是 CONCEPT | 试选定方向到我的车（旁边有清楚标记的样车演示入口） | 无长 onboarding/登录/年份表单 |
| Photo | 真实图片预览，未上传、未生成 | `Open my studio` | 选照片后不再进额外的 Ready 页面 |
| Studio | 确切来源、整辆车、草稿尚未生成 | Paint / Wheels / Style 直接试选，底部 Review | 不再管理 `Add Change`，不自动按 CSS 涂改照片 |
| Review | 正在改什么、保护什么、准确来源、一张图和价格 | `Create 1 look`（Demo 明确是假报价） | 无额外确认屏幕、无购买后自动提交 |
| Task | 同一 request ID，真实服务端才可声称进度 | 离开稍后返回或查看完成 | 不造假百分比或倒计时 |
| Result | 来自哪个父版本、是否真实生成 | Compare / Favorite / Refine | 不能把图片占位或模拟变色冒充完成照片 |
| Garage | 每辆汽车的 Original 与版本历史 | 选 Original/具体版本/添加车 | 不再强迫重复导入 |

**照片优先排布**：Studio 的源图占屏幕中部的主要视觉面积，采用 `contain` 并提供独立放大；底部工具条三个可触控按钮，辅助文案不盖过车辆。Sheet 为中等高度，不替代车图。样车与真实上传的照片有明确类型标签。

## 3. 约束直接落实到交互

- **Style**：只允许从 Original 发起 `explore`。研究候选 `Clean/Sport/Heritage` 仅展示，并不构成现有服务端公开注册。正式客户端必须读取已签发 `capabilities + published presetVersion`，不可硬编码放行。
- **Paint / Wheels**：从 Original 或明确 Version 发起 `detail`，受控的颜色 ID，选择 `Keep` 是 preserve 当前 source，不是 Restore Original，也不是“颜色叫 keep”。两色可以放进同一次 Detail 计划；是否允许组合还要看后端 release capability。
- **互斥不用让普通用户管理**：从 Style 点选 Paint/Wheels 的非 Keep 颜色时，前端先**替换为 Detail 草稿**并给 Undo；从颜色切 Style 时覆盖成 Explore 草稿并给 Undo。选择 Style + Version 直接禁止/提示换到 Original；Confirmation `quote()` 再次检查全部不合法情况。
- **静态图始终不变**：仅更新选中的颜色块、草稿摘要和说明；不模拟已换色/已换轮毂。
- **來源 ID 严格稳定**：数据模型 `carId + sourceVersionId|null + {styleId|null,bodyColor|keep,wheelColor|keep}`；每个 `carId/sourceId` 保存单独草稿，切换另一个车或版本恢复它自己的草稿而不串台。
- **版本不可覆盖**：示例成功只追加 `{versionId,parentSourceId,summary,simulated:true}`；收藏以确切 versionId 标识，Refine 基于所选旧版本而非列表最后项。

## 4. 照片链路与安全边界

- 文件选择使用 `input[type=file]`（JPEG/PNG/WebP）+ `createImageBitmap` 做文件可解码检查 + `URL.createObjectURL` 真本地预览，限制 10 MiB。**未做车型识别**，不可声称检测到“真车”。
- 在模拟 HTML 中，尝试 IndexedDB 保存 Blob 以便刷新后恢复。某些隐私模式/本机受管浏览器不允许 IndexedDB，此时明确提醒“本地图片存储不可用，重启可能需重选”；缺失时显示 Photo unavailable，**绝不替换成通用汽车来冒充用户照片**。
- 本原型不传网络、不持有账号/PII 服务器缓存；正式产品用 F12/F19 原生照片权限、HEIC 解码/方向、iCloud/大图资源、用户同意与 F07 持久化服务。浏览器 demo 不是原生摄影规范验证。
- 若 APP 切换用户身份，缓存/本地展示必须按 owner 隔离；`localStorage` demo 和 IndexedDB 不可直接移植为正式储存。

## 5. Quote / Task / Wallet 必须忠于 S01/S05

- 本 HTML 仅有初始 **2 DEMO CR**、虚构的 1 DEMO CR quote、离线计时器模拟 task；**不调用真实模型、报价、钱包、StoreKit 或账号 API**。
- 正式提交前由服务器 `/api/v2/projects/:id/plans` 取得有效 `planId,source digest,presetVersion,userCostUnits=1,expiresAt` 的不可变报价；检验 capability/consent/ownership/activeTask/credit；先持久化 submissionId 再用 `/api/v2/tasks` **同一个** submissionId 重放。不能以本地计时器/缓存余额代替服务器真相。
- 在确认 Sheet 一次显示 source、具体 edits、保护意图、**一张图**、真实余额/扣费、批准的供应商披露。报价缺失/过期/余额不足禁止 Submit；购买成功不自动提交。
- 异步仅 queued / processing / uncertain / succeeded / failed / cancelled 真状态；queued-only cancel；收到失败补偿后才显示返还。Unknown/uncertain 不自动生成新任务、不可假判成功。复用 F15 真任务轮询和账户恢复。
- **结果保护**：只有服务端有真实授权 output asset 才显示 `AI result` 并开放 Save to Photos。当前 demo 成功时仅新增版本记录，同样显示原图并特别强调 **NO AI IMAGE GENERATED**；Compare 双侧显示同一来源且注明对比演示不包含模型结果；保存按钮解释没有可保存的生成图片。

## 6. 分支约束与实施映射（均待授权）

| 现有任务 | 建议承接的改动 | 必须先检查 |
|---|---|---|
| F12 / F19 Photo | 导入后源图贯穿 Studio/Confirm/Task，保留原生权限、HEIC/iCloud 和同意 | 是否已有底图资产 blob/ref 对前端可用 |
| F13 Discover | 已有用户优先 recent car/task，浏览公开示例无需登录 | F37 真实授权 example 和正式 catalog 是否发布 |
| F14 Editor/Confirm | 用三入口工具代替 Change List UI；保持后端 `EditRequest`/plan 不变 | S05 的 Apply vs 即时写 draft 提案尚未批准；CAS/保存失败不可偷改 |
| F15 Task | 保持同一提交 ID 恢复；Task 返回 Garage | 后端任务权限、超时未知状态/账本证据 |
| F16 Result | 大图 Compare/Favorite/Save / exact version Refine | 真实输出资产授权、图片完整性与不可变历史 |
| F17 Garage | 汽车相册/版本分组/父版本来源/独立草稿 | 后端 projects/versions API 与帐号隔离能力；不得新开数据库 |
| F32 以后整合 | 不在此 PR 改任何 production wiring | 原有独立审查/迁移和 S05 Owner approval Gate 全部通过 |

## 7. 信息文案与品牌草案

英文尽量短：“Your studio”, “Try [style] on my car”, “Paint”, “Wheels”, “Review my look”, “Source photo · not edited”, “Your draft · not generated”, “1 new image”. 正式可用时确认 CTA 应使用 S05 固定格式 `Create 1 look - {units} credit`，并由真实 quote 赋值。**单次正式购买需另行明确**，不得用“免费试用/订阅”暗示。

视觉采用 *Midnight Garage / FORM AFTERHOURS*：夜间工作室的大幅车照、石墨色背景、轻微浅青柠绿操作强调，减少不必要的装饰特效，避免低价电竞 UI。源图的真实性与可见面积高于炫酷动效。字体与对比在真实 iOS Accessibility 下仍需实测。

## 8. Owner 需要明确审批的五个事项

1. 是否同意正式产品以“车辆主舞台 + Style/Paint/Wheels”代替 PR #10 Change List UI，并同步修订 S05/RFC？
2. Style 与 Paint/Wheels 的草稿互斥采用“自动替换 + Undo”还是“确认切换”？此选择属于交互契约不是换肤。
3. 哪些已注册的 Style 与 Detail 颜色能在首版正式发布？研究用三个名称不自动成为线上商品。
4. 何时能够得到**已授权、同一辆车、能证明 FORM 真实模型输出**的首屏案例？没有就不能以研究概念图作为营销证明。
5. 是否完成真实 quote/wallet/consent/version API 与 iPhone 真机验收，才考虑 S05 生效、合并开发工作？