# FORM 交接开发：现有 F 任务映射、状态与文案草案

**本文件是待批准设计规格，不是命令 Codex 直接开始改代码。** 严格优先 `AGENTS.md`、`FORM_CODEX_START.md`、冻结 `docs/form-handoff/DECISIONS.md`、现有 task guard 和 PR #3 实际 HEAD。下列字段/按钮仅为交互契约建议，不能在没有现有 API 支持时自行造第二套后台。

## 一、页面状态机（展示层）

| 状态 ID | 用户所见 | 允许事件 | 核心不变量 |
|---|---|---|---|
| HOME_CASE | 可信的已授权案例和选择套用 | SELECT_CASE、COMPARE、OPEN_DEMO、START_UPLOAD | 浏览与切换**零生成**；无素材时给缺口提示 |
| DEMO_VIEW | 预先准备的示例图，标示“示例” | NEXT_CASE、START_UPLOAD、BACK | 不能让示例被误认为用户实际结果 |
| LOCAL_PHOTO | 系统相册/本地车图预览 | PICK_IMAGE、REPLACE、BACK、CONSENT_NEXT | 只本地解码，不暗中上传 |
| CONSENT_READY | 版本化授权说明 | APPROVE、CANCEL | 拒绝仍保留本地草稿；真实传图必须按已批准同意流 |
| EDIT_DRAFT | 指定原图或历史版本的大图；少量改装项 | SET_STYLE、SET_FINISH、SET_COLOR、SET_SUPPORTED_PART、RESTORE_ORIGINAL、CONFIRM | 变动的是**草稿意图**，不修改图片字节、不调用模型 |
| QUOTE_READY | 底图＋修改明细＋单次任务报价 | CONFIRM_JOB、BACK、BUY_PACK | quote 过期/变更须刷新、用户重新确认 |
| ENTITLEMENT_PENDING | 实际商店报价与购买状态 | PURCHASE_STARTED、PURCHASE_CANCELED、BALANCE_REFRESH | 不假成功、不凭客户端声称余额、不自动发任务 |
| WAITING | 排队/处理中/待确认/可恢复状态 | LEAVE、RESUME、REFRESH、QUEUE_CANCEL_IF_ALLOWED | 一逻辑任务一次扣次；请求幂等；超时不能擅认无成本 |
| RESULT | 用户自己真正输出的结果与前后对比 | SAVE、FAVORITE、COMPARE、FEEDBACK、REFINE | 结果不能覆盖原图；保存与收藏不同 |
| RESULT_REFINE | 从用户指定的结果/历史版本继续 | MODIFY_ONE_THING、BACK、CONFIRM | 新版本要再次明确确认与新报价 |
| RECOVERABLE_ERROR | 错误类型与恢复动作 | RETRY_OR_RESUME、CHANGE_PHOTO、BACK | 重试是否新收费由后台任务身份/账本决定，不能伪造返款 |

所有关键跳转保存来自所选 CASE 的意图、原图/版本 ID、草稿参数、采购返回意图，恢复前必须校验账号与资源所有权。不要使用本地 HTML 的模拟数据作为真账本。

## 二、与既有任务图对齐

| 体验问题 | V2.2 对应任务 | 应当如何实现 |
|---|---|---|
| 上传+本地预览+图片权限 | F07/F11/F12/F19 | 尊重现有先处理同意，再创建私有资产和原生桥 |
| 以案例引导+无模型示例 | F13/F37 | 只做选择意图/预置素材浏览，严格零生成 |
| 选择原图或历史版本/草稿/确认 | F08/F11/F14 | 保持选中 base 不变、使用现有 quote / idempotency |
| 排队/恢复/错误/质量补偿 | F10/F15/F35 | 真实任务状态机，恢复同一任务，补偿不可重复 |
| 比较、收藏、作品库、导出 | F16/F17/F19 | 只在既有独立资源与保存动作上加 UI，勿混同 |
| Apple 身份及购买返回 | F20–F24/F36 | 首版一次性次数包，真实 StoreKit，试用闭合，真实费用数据 |
| 最终素材与隐私审核 | F26/F28/F29/F31/F33 | 法务/授权/品牌与真实成品验证前不可发布 |
| 最终接入生产 | F32 | **仅在依赖任务就绪、设计确认后**；不得绕开 F35–F38 |

按任务卡白名单处理文件。禁止直接修改 PR #3 的 F02/F03、数据库、支付规则、入口、锁文件、工作流来图省事。React/TypeScript/Vite+Capacitor 保留，不追加 Flutter、RevenueCat、Adjust 或新的大框架。

## 三、不可直接移植的“看起来能跑”

上一轮可点击原型的模拟钱包、登录、支付完成、倒计时、生成结果、模型/成本代理、示例车图、私有授权弹层等，都**不是**生产实现。只有结构/设计 token/中英文正式文案/纯 UI 判定逻辑/可独立测试的组件有条件参考。面向海外发布的英文文案另行审核，不把中文原型原样当英文成品。

## 四、关键屏幕的测试中文与 EN-US 文案候选

| 场景 | 中文验收 HTML（建议） | 正式 EN-US（候选） |
|---|---|---|
| 首屏主标题 | 看看你的车，换一套造型会怎样 | See what a new look could do for your car |
| 强 CTA | 把这套试在我的车上 | Try this look on my car |
| 无门槛示例 | 先用示例车看看 | Explore a sample car |
| 方向摘要 | 已选：深色车漆 · 运动轮毂 | Selected: Dark finish · Sport wheels |
| 选图说明 | 选一张能拍到整辆车的照片 | Choose a photo showing your whole car |
| 图片建议 | 车身完整、光线充足、遮挡少 | Full car in frame, good light, minimal obstructions |
| 本地预览 | 仅预览了照片，尚未提交生成 | Photo selected. No generation started |
| 草稿提示 | 你只选好了改动，还没有生成图片 | Changes selected. No image generated yet |
| 配置入口 | 车身颜色 | Paint color |
| 质感入口 | 漆面质感 | Paint finish |
| 轮毂能力闸门 | 当前暂不支持这项修改 | This edit isn't available yet |
| 报价前 | 生成一张新效果图会消耗 1 次 | One new image uses one credit |
| 付款前 | 价格以 App Store 显示为准 | Price shown by the App Store at purchase |
| 购买取消 | 已取消购买，你的改装选择还在 | Purchase canceled. Your selections are saved |
| 付款到账 | 次数已更新，确认后才开始生成 | Credits updated. Confirm to generate |
| 等待 | 正在处理你的改装，可以稍后回来查看 | Working on your edit. You can come back later |
| 恢复 | 继续查看这次任务 | Resume this edit |
| 结果 | 这是你的新版本 | Your new version is ready |
| 前后对比 | 查看原图与改装效果 | Compare with original |
| 下一次 | 继续改一处 | Refine one more detail |
| 无真实案例 | 示例素材尚未验证，暂不能用于正式宣传 | This example isn't approved for release |

文案需在真实商品和能力确定后由负责人再审；“已保存”“次数已更新”必须只在**真实事件后**出现。样例图需显著写“预置示例/概念演示”，不能在生产混淆。

## 五、保护性边界

- 一次明确确认对应一个逻辑任务及不超过一张官方版本，不隐藏第二张生成。
- 原始图、每次完成版本、用户主动选中的底图不可覆盖；恢复“原始照片”必须是明确动作。
- “颜色”与“质感”分开，通用轮毂项需供应商能力证明；不承诺品牌 SKU、轮毂尺寸、悬架/轮距真实规格。
- 没有已审定商品 ID / server quote / owner consent 就显示不可购买或等待授权，不编造价格、账号权益或退款。
- 在图像失败或支付返回时，不要重复扣次，也不自动允诺补偿；F04/F09/F10/F35 的服务端规则优先。
- 图片输入上限、缓存、保留期、删除/退款、审核等由冻结规范与已批准法律策略决定，不由 UI 猜测。
