# 真实质量研究计划：30槽位、252次，全部未执行

状态：**NOT_EXECUTED。0张照片入组、0真实模型请求、0真人受试、授权支出0。** 数字表示冻结方案中的登记位置和拟议对照量，不是素材、费用或效果已获批准。[PLAN01–PLAN03]

依据固定PR3的 [S06研究与发布规格](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-handoff/specs/06-research-launch.md)、PR4证据模板及PR6待验证假设。真实照片/许可/可识别车辆信息只能留在批准的私有位置；公开Git只保存空槽位、合成fixture、脱敏证据。[FORM39、UX48]

## 1. 完整登记位置

每格当前为空，车辆/照片/授权/哈希均未填写。入组需登记权利、允许用途/处理方、真实format/尺寸、车身类别、可见特征、视角/光线/遮挡及重复/学习效应。未知授权阻断处理与营销，不能为完成表格发明车型或owner事实。

| 槽位 | 组别 | 当前状态 | 槽位 | 组别 | 当前状态 |
|---|---|---|---|---|---|
| D01 | 开发 | RESERVED_UNFILLED | V01 | 严格留出 | RESERVED_UNFILLED |
| D02 | 开发 | RESERVED_UNFILLED | V02 | 严格留出 | RESERVED_UNFILLED |
| D03 | 开发 | RESERVED_UNFILLED | V03 | 严格留出 | RESERVED_UNFILLED |
| D04 | 开发 | RESERVED_UNFILLED | V04 | 严格留出 | RESERVED_UNFILLED |
| D05 | 开发 | RESERVED_UNFILLED | V05 | 严格留出 | RESERVED_UNFILLED |
| D06 | 开发 | RESERVED_UNFILLED | V06 | 严格留出 | RESERVED_UNFILLED |
| D07 | 开发 | RESERVED_UNFILLED | V07 | 严格留出 | RESERVED_UNFILLED |
| D08 | 开发 | RESERVED_UNFILLED | V08 | 严格留出 | RESERVED_UNFILLED |
| D09 | 开发 | RESERVED_UNFILLED | V09 | 严格留出 | RESERVED_UNFILLED |
| D10 | 开发 | RESERVED_UNFILLED | V10 | 严格留出 | RESERVED_UNFILLED |
| D11 | 开发 | RESERVED_UNFILLED | V11 | 严格留出 | RESERVED_UNFILLED |
| D12 | 开发 | RESERVED_UNFILLED | V12 | 严格留出 | RESERVED_UNFILLED |
| D13 | 开发 | RESERVED_UNFILLED | — | — | — |
| D14 | 开发 | RESERVED_UNFILLED | — | — | — |
| D15 | 开发 | RESERVED_UNFILLED | — | — | — |
| D16 | 开发 | RESERVED_UNFILLED | — | — | — |
| D17 | 开发 | RESERVED_UNFILLED | — | — | — |
| D18 | 开发 | RESERVED_UNFILLED | — | — | — |

账本有30独立 `SLOT_D01…SLOT_D18 / SLOT_V01…SLOT_V12` 记录，photoSlotId兼容PR4。留出组不参与调Prompt、挑模型或选图片处理参数；同车、近重复角度和同一原图变体不得跨两组隐性泄漏。

## 2. 252次如何组成

| 阶段 | 数量计算 | 目的 / 当前状态 |
|---|---|---|
| 开发对照 | 18照片×3任务×3配置＝162 | 受控改色、完整受支持style、单项wheel/detail；配置待证据核实与预注册，NOT_EXECUTED |
| 连续编辑 | 从开发组取6车×3连续编辑×3配置＝54 | 每次对immediate base及original分别测漂移；每序列各3次，NOT_EXECUTED |
| 原开发方案 | 162＋54＝216 | 保留原216次proposal |
| 严格验证 | 12留出照片×3任务×1锁定最终配置＝36 | 不再选参数/模板，失败保留，NOT_EXECUTED |
| 总计 | 216＋36＝252 | 不是批准支出；不把重试、额外纠正或新增模型自动塞入额度 |

每种配置至少冻结真实provider/model/profile、官方合同证据、Prompt/template/preset、input normalizer、input/output规格及预算政策。缺checkpoint支持/精确model、成本上界、照片许可或能力证据，live保持关闭。第三任务只用核实支持的字段；wheelDesign/finish不因计划列出就成为生产已启用能力。

三配置可用于原有baseline与候选比较，具体内容未填，不假造已选模型。若generic editor作为baseline，必须另有同照片/任务/预算下实际操作证据。工具样例、竞品宣传图、mock/demo和最好图不能替代首图。

## 3. 先执行一个信息更集中的小实验

预注册提案PLAN02：从开发组有权照片预先挑6槽位（在取得素材前不指定虚构车辆），同一模型、同一规范输入、参数、output规格和费用政策，只改Prompt：A基础受控改色，B加入原创身份/构图/非目标结构保留。共12个首次请求，是162的子集，不是252外再加12。

选择顺序与匿名输出代号随机化；若provider支持且经核实可固定seed，再按合同固定，否则记录随机性Unknown，不能偷偷传未支持参数。无隐藏重试、reroll或换model，第二次纠正属于新明确确认和独立成本。先完成零模型的编译/冲突/图片合成检查，再申请真实小实验所需权利与预算，不为走通流程提前调用。

两名独立评审看original＋base＋首个raw output master，尽量盲掉Prompt/配置标签；分歧由第三评审或书面复查，不用单一AI judge当真相。用户偏好与工程保真分别记录。6图只能估计方向和暴露失败，不能推广市场成功率。

## 4. 每张首图怎样评价

评分是预注册提案，不是当前已有结果；0–4分别表示未达成/严重错误至充分满足，身份关键错误另有二值标记，不被均分掩盖。

| 维度 | 具体观察 | 避免误判 |
|---|---|---|
| 车辆身份 | 可见车身比例、车门/窗线、轴距视觉、灯/格栅/车标相容性；是否仍像原车 | 不根据不可见徽标、方向盘或零件号猜车型；NA保留 |
| 目标执行 | color、style允许项、wheel/detail所请求字段是否可见完成 | requested recipe不是observed；“图好看”不等于目标达成 |
| 构图/背景 | 视角、车的位置/尺度、透视、背景边界/物体与光照是否漂移 | 不把合法输入orientation修正当模型构图改变；记录真正传入input |
| 非目标保护 | 未要求的车色/部件/灯/玻璃、轮心位置、胎体、轴/stance | 改spokes时不能要求保原spokes；保胎/轮心等保护条件明确 |
| 结构artifact | 灯对称、轮辐连续/数目合理、车轮圆形/遮挡、车门/车窗连接 | 只评可见部位；AI细节锐化不等于正确结构 |
| 连续漂移 | 既对上一步base，又对original；前三次累积偏差 | 下一步以选中master为底图，不把display缓存当输入 |
| 愿保留 | 真实车主是否愿收藏/导出，并能指出原因 | 相册/收藏行为与自动保存分开，满意度不等于保真 |

每条PR4 observation记录保留photoSlotId、task/config、授权ref、firstOutput、retries、elapsedMs、visibleUserCharge/spendAuthorized/actualSpend。新增task/attempt、prompt/input/output digest、尺寸、model/profile、成本估计/真实usage、评审者和故障分类。未知requestID/usage/cost为null，不填0假装免费；此次计划本身实际支出为0。

原始有效请求/照片/许可不进入公开Git。公开日志只保留匿名ID、版本、结构化观测和合成fixture；诊断去除Prompt、私有URL、凭据、车牌/个人资料。

## 5. 分母、指标与停止门

保留第一次输出、拒绝、失败、timeout、取消和未交付。分别报告：请求数、accepted jobs、provider attempts、有效输出、可用首图、需纠正任务；输出质量与未交付率同时展示，不只看已经完成的好图。纠正重试、主动探索新风格、补偿与技术release分开，不重复计“留存”。

时间从实际事件戳测量：selected photo→first valid result和first usable result分别记录，含用户确认/等待阶段；录屏时间码不能充当生成耗时。收费面板打开不计购买完成，share sheet打开不计已分享。

冻结S06提出内部候选门：锁定验证集**零未解决identity-critical失败**、至少90%评为可用；未交付同时进入总交付报告。这里沿用，不把小样本门变成市场准确率承诺。按task/可见车辆类别报告数量与不确定性，不能去掉失败以过门。[FORM39]

身份关键失败先关闭或缩窄能力；目标无效、结构错误应重新选配置/合同，但不能在看过holdout后悄悄调参再称严格验证。Prompt/model/normalizer/preset或关键参数变动时声明holdout污染并按规格重新验证或用新留出集。记录多重比较和以前参与用户的学习效应。

任何时候：授权/预算/成本上界不足，或图片/凭据有边界问题，停止相关真实请求并保留记录；不试探竞品内部API、购买订阅或绕过平台校验。非费用的离线合同/合成工作可继续。

## 6. 人类研究不是模型评审的替代

| 研究 | 人数 / 问题 | 不能代替 |
|---|---|---|
| Round1 Demo | 8–12目标用户：30秒能否理解用途、第一动作、本地照片选择、同意、费用与状态、demo含义 | 真实保真、付款意愿、生成延迟或转化率；30秒只是观察点 |
| Round2真实结果 | 12–16车主：独立完成、是否仍是自己的车、能否有目的继续改、实际收藏/导出 | 全国市场比例或已批准发布；必须真实授权结果/预算与研究同意 |

两轮均NOT_EXECUTED。招募、录音录像/笔记权限、私人资料存储需单独落实。例图权利、真实模型效果、独立危险系统审核和owner go/no-go是不同门，任何单测/表格校验都不能替代。

## 7. 成本与实施边界

实际费用预案当前未填写。未来审批应写：精确profile、请求上界、12首图预算与可否扩展至252、失败/未知结果的最坏supplier exposure、禁止自动重试、到上限立即停止。user credit退款不抹去supplier费用；unknown timeout必须保留未决暴露。没有可信报价时不填美元预算或推算竞品成本。

F29质量登记/评估、F35质量与补偿政策、F28诊断、F31合法素材复用现有任务图；F05/F06/F08/F09/F10上游按原依赖进行，F32接线不得绕过审核或cap。本轮只交付计划和证据，没有重排实施分支、填owner事实或启动任一研究请求。
