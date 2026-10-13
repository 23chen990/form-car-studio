# FORM 原创架构：可验证的意图、输入与单次任务

本方案是面向现有 React / TypeScript / Vite / Express / Node24 SQLite 的原创设计建议，状态 PENDING_APPROVAL / NOT_IMPLEMENTED。审查源固定为 PR #3 SHA 467e20758414216f215fb4106d098dedc0b18c3a。它复用现有V2合同、Prompt、状态机、账务与schema，不复制Mody/Modyfy私有Prompt，不新增第二套后端、不改变F00–F38图，不执行模型或支付。

**首先建立可验的请求，再验证它是否能生成更好的同一辆车。** 确定性Prompt能消除语义漂移，却不能保证模型遵守；图像预处理、provider profile、首次输出和独立评审必须分别留证。当前只有F00/F01/F02/F03/F38的CODE_READY报告，V2应用尚未接线；这里的箭头都是设计流程，不是已完成运行链。

## 1. 直接复用现有模块，保留各自证据边界

| 责任 | 当前存在的代码 | 后续冻结落点 | 不能当作已完成 |
|---|---|---|---|
| Web入口与展示 | legacy App / api / export | F12–F17独立features与harness，F32薄接线 | F32生产UI、iPhone或设计吸引力 |
| 编辑语义 | shared/v2/edit-plan.ts的严格schema/action/capability/canonical digest | F08 plans/presets，F14 draft-v2/confirm | owner、consent、可用provider或实际颜色观察 |
| Prompt | shared/v2/provider-prompt.ts确定性builder | F05 server/v2/provider.ts、provider-profile.ts | 供应商参数支持、模型保真 |
| 图片 | legacy normalizeImage | F06 images.ts/assets.ts；F12 photo-input；F19 native桥 | native HEIC、master原分辨率保存、输出pixel digest |
| 任务 | shared/v2/task-policy.ts纯决策 | F09 tasks，F10 worker/recovery，F11 submission store，F15 poller | durable scheduling、并发race、重启恢复 |
| 用户与供应商费用 | credit-reservations纯reducer；schema中的lots/allocations/events/attempts | F04 wallet事务、F09 reserve、F10 settle、F27 budget | 真实lots/refunds、未知费用对账、cost circuit breaker |
| 同车版本与质量 | legacy append/parent、schema版本FK/唯一约束、quality-policy纯决策 | F10 immutable result、F16/F17历史、F28 feedback/audit、F29 registry、F35 quality/compensation | 真实同车识别、自动quality detector、补偿grant或独立review |

代码证据：[FORM01 · package.json:6](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/package.json#L6)、[FORM19 · server/app.ts:226](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/app.ts#L226)、[FORM23 · shared/v2/edit-plan.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/edit-plan.ts#L1)–[FORM29 · server/v2/schema.ts:134](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/v2/schema.ts#L134)、[FORM33 · src/lib/export.ts:12](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/lib/export.ts#L12)、[FORM34 · server/v2/db.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/v2/db.ts#L1)。现有入口仍是legacy。[FORM02 · src/lib/api.ts:50](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/lib/api.ts#L50)、[FORM03 · server/index.ts:4](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/index.ts#L4)、[FORM04 · server/app.ts:116](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/app.ts#L116)

建议运行方向为：

本地选图与Draft → 同意上传 → 私有原图/指定版本 → server-resolved意图 → immutable Quote → 一次明确确认 → 同一Submission → 事务接受Task/预留 → 一次Attempt → 校验Master → 原子Version/结算 → 原图/parent比较与后续Draft。

F12–F17只在独立test harness上形成可审查组件；生产index.html/src/main.tsx/server路由仍等F32。[FORM40 · docs/form-handoff/specs/05-ui-ios-copy.md:5](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-handoff/specs/05-ui-ios-copy.md#L5) 这不是把旧App.tsx wholesale rewrite成另一个产品。

## 2. 原创Prompt Builder的六个层次

当前schema2请求例仅用于解释受控合同，不是一个可执行quote，也不表示能力启用：

    {
      "schemaVersion": 2,
      "source": { "kind": "original" },
      "operation": "detail",
      "edits": {
        "bodyColor": { "action": "set", "value": "blue" },
        "wheelColor": { "action": "preserve" }
      }
    }

第一版EditRequest只有schemaVersion/source/operation/styleId/edits；原图detail不需要styleId，版本detail必须传所选versionId。[FORM23 · shared/v2/edit-plan.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/edit-plan.ts#L1) 当前launch配置所有capabilities=false，live/trial/purchase=false，supplier profile=null，external budget=0，所以例子本身不能启动模型。[FORM36 · docs/form-handoff/configs/launch.json:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-handoff/configs/launch.json#L1)

### A. 身份约束：源图片和可见身份先锁定

服务端按owner/project/sourceRef取实际私有bytes，记录sourceAssetId、digest和尺寸；selected V1永远不能被“最新V3”替换。引用不可由客户端URL决定。Prompt保护可见车身比例/轮廓、门数、窗、灯、徽标、车牌布局、可见方向，以及相机/构图/光线/场景；不从名称猜车型、年份、VIN或隐藏细节。

原创约束表达可以是：“对当前选定的车辆照片执行以下有限变化；保留同一可见车辆与镜头关系；对没有被明确允许修改的可见结构和场景保持现状；不要补造隐藏信息。”

这类文字是意图约束，不是“精确同车”的能力承诺。已存在builder的identity/scene约束可作初始版本，真正是否保真由输入→原始首图→独立图像评审证明。[FORM24 · shared/v2/provider-prompt.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/provider-prompt.ts#L1) 如果restore需要original-role参照，必须同owner、同project、已获适用同意、profile支持多角色且真的供图；缺一项就报价前拒绝，不能只在Prompt声称已参考原图。

### B. 整车方向：server preset展开，不拼接营销文案

explore只从original起步；styleId由服务端映射到不可变presetVersion与显式字段编辑。clean/sport/heritage/color是拟议可见方向，必须各有质量准入，不能从名字猜附加结构。八个旧ID继续可读历史，不等于全部对新生图开放。

V1 UI不提供预生成expert overrides；不将“更运动”翻译为lower stance/front lip/bodykit。旧shared/catalog.ts的sport文字含这些变化，legacy provider又保护geometry，因此不能原样搬进V2。[FORM21 · server/provider.ts:4](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/provider.ts#L4)、[FORM22 · shared/catalog.ts:9](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/catalog.ts#L9) 一个方向的“完整”应指一组受支持的配色/允许编辑有一致审美，而非额外造未承诺部件。

preset变更必须产生新版本/planDigest；已接受task继续使用quote锁定的版本，不因后台修改preset悄悄改变。

### C. 颜色和finish：不同字段，不伪造物理漆色

bodyColor与wheelColor分别set/preserve/restore_original；bodyFinish独立gloss/satin/matte，初始禁用。选择色名只是desired change，不是当前像素已变；UI保留“选择已完成，生成才更新图像”。

Prompt按受控字典将blue描述为一个普通视觉颜色目标，不能声称真实油漆编号、屏幕色卡等于实体漆面或每个像素精确RGB。色彩处理只帮助数字图片一致性，不证明真实材料准确。未验证finish不能被颜色标签隐含启用，轮毂颜色也不能隐含更换轮毂。

preserve表示当前selected base；restore表示正确original参照，不能把keep当色值。只有带可信来源的verified observation才能在报价前消除重复目标；requested recipe没有这项资格。[FORM23 · shared/v2/edit-plan.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/edit-plan.ts#L1)

### D. 已验证部件：能力、profile、质量三门共同允许

首版冻结字段是bodyColor/wheelColor；bodyFinish和generic wheelDesign仍须gate。此处“已验证”含两件不同的事：

1. 当前profile确实支持字段、引用角色、请求/输出格式及安全费用上界，且相应能力已有授权质量评估。
2. 针对当前base的observed值来自可信评审记录，而不是上次requested值。

wheelDesign只有generic sport_multi_spoke/classic_mesh这类受控样式；不接品牌、SKU、直径、精确fitment或任意参考照。若轮毂设计未启用，UI给原因并禁用；手工改HTTP也在server quote阶段拒绝FIELD_NOT_ENABLED。即使允许颜色，也不能顺带开放wheelDesign。

wheelDesign被实际允许时，只准改可见spokes，继续保护轮心位置、外圈视觉尺度、胎体、轴位置与stance；此时不能再发“保留全部spoke结构”这个矛盾指令。未改design时才保留spokes。现有builder已有互斥分支，后续F05测试必须核对multipart有效Prompt确实由它产生。[FORM24 · shared/v2/provider-prompt.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/provider-prompt.ts#L1) 没有mask/segmentation/强度接口的证据就不能承诺局部像素锁定或精确选区。

### E. free text：当前禁入；未来只能成为可确认的结构化提议

Mody归档00:42及01:35–01:41仅描述Custom Edit文字入口，UX09；不是后端系统Prompt或模型质量。[竞品复核](03_MODY_MODYFY_UX_ZH.md) 当前FORM冻结spec不允许free prompt，parseEditRequest严格拒绝未知keys。[FORM23 · shared/v2/edit-plan.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/edit-plan.ts#L1)、[FORM37 · docs/form-handoff/specs/01-editing.md:5](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-handoff/specs/01-editing.md#L5)

满足“表达自由”的原创候选是：未来经审阅规格修订后，文字先作为本地草稿意图，使用有限受控词表产生“建议变更＋未解析部分＋冲突”列表；用户必须确认或改成受控选择，再形成quote。它不直接透传provider，不用第二个模型猜车型/零件，也不把敏感原文带入一般日志。无法解析的意图保留为未支持，不承诺模型“尽力试”。

例如“深蓝，别换车，轮毂保留”可建议bodyColor=blue、wheelColor=preserve；“改成某品牌19寸低趴套件”应指出品牌/尺寸/stance不支持，而不是暗中改写成某个通用方向。这仅是待审的未来接口候选；当前生产不接收此字段，不新增已实现按钮或另一套引擎。

### F. 冲突与变更列表：提交之前逐项解释

编译顺序为source/owner/consent → parse strict contract → server preset展开 → 能力/profile/quality校验 → 可信no-op判断 → resolve changes/preserve → deterministic Prompt → freeze quote。未解析或冲突不能交给供应商自行决定。

| 输入/冲突 | 处理 | 用户确认信息 |
|---|---|---|
| detail带style | 拒绝DETAIL_MUST_NOT_APPLY_STYLE | 此次只改所选字段，不能附带整车preset |
| version restore但profile无original role | 拒绝ORIGINAL_REFERENCE_UNSUPPORTED，不reserve | 当前模型不能可靠恢复该字段 |
| color中含“Matte blue” | 将颜色和finish分开验证；finish禁用则不接受混合请求 | 只能选可用颜色；finish不可隐含执行 |
| 同字段来自两来源且不一致 | 当前UI不开放explore expert override；冲突需返回调整，不静默覆盖 | 明确最终字段及其来源 |
| preserve全部字段、或verified目标相同 | NO_EFFECTIVE_CHANGE | 选择至少一个变化；没有AI调用或用户预留 |
| wheelDesign set＋keep spoke | 编译器生成唯一相容的保护分支；不发矛盾文本 | 只允许spokes变化，位置/胎/stance仍保护 |
| lower stance/bodykit/brand/SKU/arbitrary reference | unsupported，报价前拒绝 | 已冻结范围之外 |
| raw free text/strength/negative_prompt/mask/未知参数 | strict unknown-field拒绝；不透传 | 需已验证合同和审阅规格，当前不可用 |

F14确认屏从同一个server plan生成基础图、changes、preserve与1输出/固定credit；不是客户端另拼一份说明。显示“已选择但图未更新”，undo/reset只动Draft，不调用模型。

## 3. 图像预处理可验证，不能把显示优化当质量提升

当前legacy把输入和输出都旋转/缩到2400px以内的PNG。[FORM15 · server/app.ts:83](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/app.ts#L83) 这能做文件校验，却无法证明原始模型master尺寸或本机HEIC。F06已冻结拆分职责；本建议按该任务推进，不引入收费识车或另一种模型。

| 阶段 | 建议处理与记录 | 拒绝/不做 |
|---|---|---|
| 本地选择，F12/F19 | 留原选图在本地，准确preview、remove/replace；实际adapter处理HEIC orientation/iCloud/OS取消 | picker/preview不upload；不假称已识车；不猜MIME |
| 上传输入，F06/F07 | 适用同意后读取实际bytes；检查10MiB、实际decode≤40MP、单帧；校正orientation，记录原尺寸/格式/哈希与normalizer版本，清理无用metadata | 不仅信扩展名；不自动trim/crop掉车；不偷偷云预检 |
| 原始与规范输入 | 私有保留授权原图；生成模型所需规范版本时记录变换、尺寸/颜色空间/digest与parent asset | display cache不能变成下一次编辑的source；不能把preview截图传作master |
| 传provider | 按已验证profile用准确input尺寸/格式；保留长宽比和完整可见车；所有resize/padding规则都版本化并在独立mock中可查 | 未知profile最小/最大尺寸时live disabled；不自动猜strength/mask/参考角色 |
| 原始输出master，F06/F10 | 单帧安全decode；≤32MiB/40MP资源cap；核对profile明确最小尺寸；记录实际native尺寸与哈希，保存master后独立生成display | 不将4096px mock output静默缩2400；不把资源上限宣传为4K或质量保证 |
| 精确无变化，F06/F35 | 在display缩放前将输入/输出按同normalizer版本规范为有方向的sRGB RGBA；比较尺寸＋pixel SHA-256 | 不能用PNG文件哈希、metadata差异或perceptual相似阈值判exact equality |
| 显示与导出，F17/F37 | 只从owned既有display/master做contain、thumbnail、静态comparison/recipe；记录实际export尺寸 | 不再AI增强/换背景/修脸/自动修车；不冒充原生分辨率或完美部件位置 |

canonical pixel normalizer仍须实际实现和校验，quality-policy目前只是消费digest而非看图。[FORM27 · shared/v2/form-quality-policy.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/form-quality-policy.ts#L1) 不同EXIF/metadata但相同规范像素、旋转、色彩输入、动画/decompression bomb、output/storage失败都要有合成证据。不能把这些测试称为真实照片、真实HEIC或模型保真通过。

正确处理后的图片是否更好仍未知；保真评审须分别看original、immediate base和首次原始output，不能只看downscaled display。image-affecting resize/normalizer/profile改变后必须记录新配置，不能沿用旧quality批准。

## 4. Provider Adapter只发送已验证的合同

F05复用buildEditPrompt，新增冻结allowlist内的server/v2/provider.ts、provider-profile.ts与测试。legacy Buffer-only接口不包含费用/usage/requestID，也允许配置base URL；不能拿它当新profile已被验证。[FORM21 · server/provider.ts:4](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/provider.ts#L4)

建议profile至少锁定：profileId/version、供应商身份、官方文档URL及获取日期、精确model/endpoint、input/output格式和尺寸约束、允许字段/引用角色、返回解析方式、timeout/reconciliation行为、nullable usage/cost语义、可辩护的每次成本上界、quality evidence引用、批准状态。没有填写真实配置和证据时都是unknown，不用“OpenAI-compatible”推导参数支持。

- quote固定provider profile、model、template、preset、input/output profile及政策版本；执行读取冻结快照，不读可能被换掉的当前配置。
- UI能力来自bootstrap，但server仍逐字段验证；enabled需要profile支持、已授权quality evidence、配置与预算同时满足。默认全部关闭。
- strength、negative_prompt、seed、mask、局部强度等没有冻结字段或该profile明确证据，就在adapter之前拒绝，不能以额外multipart参数“先试”。Prompt里的普通“不加bodykit”语句不等于供应商支持专用negative参数。
- 只发送私有owned asset bytes与声明role；不发送projectName/raw note，不接任意调用方URL；URL-only、invalid JSON/base64或不合规格输出显式失败，不跳到未批准host。
- adapter返回typed output/error、profile/model/requestID（可空）、真实尺寸、usage/cost（可空）与分类；未知保持null。public error不带raw prompt、private URL、key或upstream payload。
- 一accepted task初始最多一次attempt；mock test可证明“此caller request≤1次mock invocation”，不能证明上游不会重复计费或效果。

失败/恢复规则：

| 情况 | 用户任务与重试 | 用户credit | supplier exposure |
|---|---|---|---|
| quote/profile/capability/预算/同意不足 | 报价前拒绝；不创建accepted task | 不reserve | 不发attempt |
| submit响应丢失或重连 | 查询或重放同一owner/submission；不换ID | 读取既有一次reserve | 不新attempt |
| queued取消与worker claim race | conditional update，只能有一个结果；started后仅离开/恢复 | queued成功取消才durable release | 已started不得假定0 |
| provider timeout/进程丢失/未知结果 | processing→uncertain，支持的有界reconciliation；无隐藏retry/fallback | 到终态后按冻结规则release一次 | 仍包含未决最坏暴露，不抹去 |
| invalid/unchanged/storage failure | failed，result不入official version；清理临时asset | 原allocation release一次 | 按真实attempt记录，不能因退款归零 |
| 已明确失败后用户再次想试 | 新quote＋明确确认，显示费用与retry关系；每task仍≤1attempt | 新accepted任务按其quote | 新上界也计入总预算；不得后台免费救图 |
| 已交付但用户不喜欢/报告问题 | 原succeeded/version保留；主观偏好是下一次自愿编辑；可信审核补偿独立事件 | root唯一补偿由server写，非client自行grant | 不自动生成修复图或消失旧费用 |

默认不自动supplier重试、不中途换model、不开“上游无结果就免费重试”。将来真的要bounded retries，必须另有规格与预算；不能将本方案作为授权。[FORM38 · docs/form-handoff/specs/03-jobs-money-quality.md:5](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-handoff/specs/03-jobs-money-quality.md#L5)

## 5. 复用任务、幂等、账务与immutable same-car versions

一个task是一次明确确认，一个attempt是可能计费调用，一个version是一张接受交付；三者不能合并计数。任务流复用现有纯policy，持久状态必须由F09/F10落实：[FORM26 · shared/v2/task-policy.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/task-policy.ts#L1)

queued → processing → succeeded/failed；processing失去进程 → uncertain → 有界恢复终态；queued可以cancelled；terminal不回退；迟到输出不得复活failed/cancelled/deleted。

F09接受事务先查owner/submission重放，再校验quote/credit；task、plan确认、用户lot allocation与supplier最坏费用预留全成或全不成，commit后才网络。claim条件更新并先留attempt身份。F10完成事务重新检查owner/project/task/tombstone，同步写master/display引用、official version、settlement、status与事件；不跨await占DB事务，不回写旧session快照。现有schema已提供复合owner/project FK、submission/confirmedPlan唯一、active与officialVersion索引，仍不是事务完成证明。[FORM28 · server/v2/schema.ts:37](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/v2/schema.ts#L37)

用户账务复用reference规则：promo先、purchased后；reservation保存原lot分配；release回原来源；event key唯一。退款、试用和合并仍有独立任务与独立review，不能从demo余额建真实购买权益。[FORM25 · shared/v2/credit-reservations.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/credit-reservations.ts#L1)、[FORM29 · server/v2/schema.ts:134](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/v2/schema.ts#L134)

供应商账务记录profile/model/attempt、可空requestID/usage/estimated/reconciled成本、estimate basis和未决最坏暴露；总预算包含已知费用与未决暴露。schema当前有nullable attempt cost载体，但不代表费用预留事务/上限计算已实现。F27须明确durable accepted task/attempt快照的费用上界与状态如何避免重复计算；缺可辩护上界就拒live，不能填0。

immutable same-car version表示同project的源与结果关系不可被覆盖，不表示模型天然保持身份。V1和V3并存时，选V1新作的parent必须V1。自动保存、favorite、cover/name、设备导出是不同动作；metadata可以更新，image-affecting snapshot/source/master与成功历史不能重写。schema复合FK防跨project/owner误关联；legacy已有append与parent基础。[FORM19 · server/app.ts:226](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/app.ts#L226)、[FORM28 · server/v2/schema.ts:37](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/v2/schema.ts#L37)

desiredRecipe来自冻结plan；observedRecipe只从可信图像评审/证据记录取得，不从desired/用户自报生成。当前versions表没有独立observedRecipe/evaluator/evidence列，不能声称这一持久化完成。服务层缺可信观察时返回unknown；其正式落点需在所属任务/allowlist和审阅规格中明确，不能临时改完成的F02或在F32塞新DB设计。重复目标不能提前假定no-op；只有F35规范像素或可信评审证明适用时才处理。[FORM23 · shared/v2/edit-plan.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/edit-plan.ts#L1)、[FORM27 · shared/v2/form-quality-policy.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/form-quality-policy.ts#L1)、[FORM28 · server/v2/schema.ts:37](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/v2/schema.ts#L37)

root_task_id贯穿需要关联的质量补偿关系；root唯一benefit阻止跨policy/重复review多次grant。技术failure release与交付后compensation不同，Apple monetary refund另案。F35不能让client批准自己、改succeeded为失败或无限再生图。[FORM27 · shared/v2/form-quality-policy.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/form-quality-policy.ts#L1)、[FORM29 · server/v2/schema.ts:134](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/v2/schema.ts#L134)

## 6. 可以独立验的标准与仍需真实证据的标准

以下是验收提案，NOT_RUN；不新增测试文件、模型调用或task实现：

| 级别 | 独立可验问题 | 合格条件 |
|---|---|---|
| 合同/Prompt合成 | 相同plan重编译、rename、field变化、未知参数、方向/detail | 相同语义输出确定；rename不改变Prompt/digest；field/profile/template等变化改digest；未知项在quote前拒绝 |
| 冲突合成 | wheel design/preserve、restore缺role、finish隐入颜色、geometry扩展 | 不出现互斥指令；缺真正reference或能力拒绝；不silent ignore |
| 图像合成 | rotation/metadata/色彩、input cap、4096 output、动画、cross owner | master/display分离；canonical equality正确；越界拒绝；asset读取owner检查；只形成合成证据 |
| Adapter mock | malformed/URL-only/refusal/403/429/5xx/timeout/abort/unknown usage | typed error，null保持null，≤1 invocation，无fallback、新field或敏感日志 |
| DB/任务/钱独立关口 | 双提交、丢ack、双claim、重启、迟到结果、取消/删除、storage故障 | task/attempt/officialVersion与用户reserve/settle/release各一致；unknown liability保存；有实际SQLite race日志与独立review |
| 原生关口 | HEIC/iCloud/权限/后台终止/Photos/share/owner cache | 实际iPhone证据；浏览器/harness不替代 |
| 真实生图quality | 同车身份、目标执行、保护部件、artifact与愿保留 | 授权照片＋首次原始输出＋fixed profile/prompt/input pipeline＋独立评审；demo、概念图和最好选样不进入live分母 |

质量计划仍是30授权照片槽位：18开发，12holdout；162开发输出＋54连续编辑＋36锁定配置验证=252次提案。**252次均NOT_EXECUTED，预算授权0，本报告未启动其中任何一次。** holdout不参与选Prompt，prompt/model/pipeline改后需说明污染/新holdout；保留第一次失败、拒绝、未交付和纠正重试。冻结proposal的90% usable/zero未解决identity-critical也不是市场普适基准，不能拿小样本承诺全车型。[FORM39 · docs/form-handoff/specs/06-research-launch.md:5](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-handoff/specs/06-research-launch.md#L5)

模型选择、参数支持、真实费用与授权照片目前没有实证。不得因“Prompt看起来严谨”就开启wheel/finish或发布同车广告；profile的quality批准、单张结果的assessment、release owner批准是三个不同状态。

## 7. 当前待评审的具体决定

1. 在冻结合同内先落实F05确定性适配、F06输入/master/display、F08不可变plan；F12–F17组件仍走独立harness，复用已有保存/比较/草稿的有效部分。
2. 原图detail与server preset可按现有合同做；free text、strength/negative/mask、任意Extra、品牌精确部件、stance改变不在首版，需要正式修订后才能进入实现。
3. verified观察与supplier费用预留的持久落点需要具体服务设计和独立review，不将schema存在当完成，不绕过allowlist。
4. wallets/worker/idempotency、identity/IAP、删除与F32在独立关口前保持危险接线关闭。F32超过cap必须BLOCKED_TASK_TOO_BIG与审阅split；本方案不新增第40个任务。[FORM41 · docs/form-handoff/REVIEW_GATES.md:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-handoff/REVIEW_GATES.md#L1)
5. 先用可审查的零模型合成证据定位语义/输入处理问题，再在另获照片和预算授权后评估真实首图；每个质量结论都对应配置与首次输出。

这些是研究建议待审批，既不改变现有默认配置，也不自动触发实施、外部费用、merge或发布。五项产品优先映射见[05_FORM_GAP_AND_PRIORITY_ZH.md](05_FORM_GAP_AND_PRIORITY_ZH.md)；证据完整字段与全文件SHA-256见[统一证据账本](09_EVIDENCE_LEDGER.jsonl)。
