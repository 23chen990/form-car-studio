# FORM 当前差距与五项优先建议

审查对象固定为 FORM PR #3、提交 467e20758414216f215fb4106d098dedc0b18c3a。证据来自该 Git 对象及字节相符的干净 implementation worktree，未使用主目录的未提交代码。所有建议状态为 RESEARCH_ONLY / PENDING_APPROVAL；没有改产品、分支、39 个任务图或默认费用。

**现状是：legacy 应用继续运行，F00、F01、F02、F03、F38 有 CODE_READY 报告；V2 尚未组装接线。** 把当前提交说成“只有 F00/F01/F02/F38”会漏记 F03；把六个参考模块说成已经完成完整 V2，同样不成立。

## 先明确真实模块状态

| 范围 | 固定提交中的真实状态 | 证据与不能外推的内容 |
|---|---|---|
| 应用栈 | React / TypeScript / Vite / Express；server使用Node SQLite | [FORM01 · package.json:6](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/package.json#L6)、[FORM04 · server/app.ts:116](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/app.ts#L116)。本轮未启动应用，不能据依赖清单声称任何部署状态 |
| F00 | 有基线恢复盘点与 CODE_READY 报告 | [FORM05 · docs/form-v2/progress/F00.json:2](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-v2/progress/F00.json#L2)。报告记录30 legacy测试、build与6浏览器测试；本轮未重跑，也不等于iPhone/模型/StoreKit通过 |
| F01 | 六个shared/v2纯参考模块已安装，报告CODE_READY | [FORM06 · docs/form-v2/progress/F01.json:2](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-v2/progress/F01.json#L2)、[FORM23 · shared/v2/edit-plan.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/edit-plan.ts#L1)–[FORM27 · shared/v2/form-quality-policy.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/form-quality-policy.ts#L1)。151个合成案例不证明数据库原子性或实际生图质量 |
| F02 | 独立增量schema、db helper及schema测试报告存在 | [FORM07 · docs/form-v2/progress/F02.json:2](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-v2/progress/F02.json#L2)、[FORM28 · server/v2/schema.ts:37](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/v2/schema.ts#L37)、[FORM29 · server/v2/schema.ts:134](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/v2/schema.ts#L134)、[FORM34 · server/v2/db.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/v2/db.ts#L1)。CREATE/FK/UNIQUE不是应用使用这些表的证据 |
| F03 | 迁移代码、dry-run CLI与合成演练报告已存在 | [FORM08 · docs/form-v2/progress/F03.json:2](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-v2/progress/F03.json#L2)、[FORM35 · server/v2/migrate.ts:45](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/v2/migrate.ts#L45)。报告codeCommit=4980b5bc85dcf696f323dc33360f88a1dc17e9c1；独立迁移审核与生产恢复仍未完成 |
| F38 | PR检查配置与CODE_READY记录存在 | [FORM09 · docs/form-v2/progress/F38.json:2](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-v2/progress/F38.json#L2)。此报告记录Actions运行，未配置主分支保护；本轮未独立重取运行状态 |
| 当前接线 | App使用legacy types/catalog/api，client使用/api/*；server入口仍import legacy app/provider | [FORM02 · src/lib/api.ts:50](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/lib/api.ts#L50)、[FORM03 · server/index.ts:4](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/index.ts#L4)、[FORM04 · server/app.ts:116](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/app.ts#L116)。未发现生产入口调用V2 DB/services；不是F32完成 |
| F04–F37 | 固定提交没有其CODE_READY报告；F05/F08–F17等任务卡仍是后续实施合同 | 不能把目录中的预写Prompt、钱包、状态机或质量策略升级为已集成特性；F32接线与独立审核必须单独验收 |

各报告引用的codeCommit都已核对为审查HEAD的祖先。F02旧报告中的“F03 paused”是旧时点状态，后续F03.json更新了当前事实；本研究没有改旧证据。审查方法、工具版本和44条代码证据的完整SHA-256见[统一证据账本](09_EVIDENCE_LEDGER.jsonl)；额外阅读笔记仅存本机 `private/form_audit_notes.md`。

## 竞品依据的等级

以下时间码来自 PR #6 固定提交 5b1b203364cbf117a49f1506af3b449b5fd5f303 的二手文字材料，本轮未复看原片、操作、付款或生成。归档录屏的App版本、实际地区和录制日期没有独立确认。时间码只是录像位置，不能计算加载/生成耗时。详见[竞品UX复核](03_MODY_MODYFY_UX_ZH.md)。

Mody原定位：[02_RECORDING_TIMELINE_ZH.md](https://github.com/23chen990/form-car-studio/blob/5b1b203364cbf117a49f1506af3b449b5fd5f303/design/form-first-session-v2-review/02_RECORDING_TIMELINE_ZH.md)。Modyfy原定位：[06_MODYFY_VIDEO_TIMELINE_ZH.md](https://github.com/23chen990/form-car-studio/blob/5b1b203364cbf117a49f1506af3b449b5fd5f303/design/form-first-session-v2-review/06_MODYFY_VIDEO_TIMELINE_ZH.md)。

这两段材料都没有可验收的成功输出或已完成付款；不能用它们证明任一菜单的模型效果、私有Prompt、转化或收入。PR #5保持 VISUAL_APPEAL_REJECTED；PR #6蓝图保持设计假设，不能重新包装成已通过设计。

## G03：先把“改哪里、保留什么”变成可验证合同

**优先级：P0（真实生图开放前的质量与合同阻断项）。**

- **当前真实状态及源码：** legacy refine已经传入选中的baseVersionId，worker确实按此base取图并append新版本，不是每次都取latest。[FORM17 · src/App.tsx:176](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/App.tsx#L176)、[FORM19 · server/app.ts:226](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/app.ts#L226) 但legacy Target只有bodyColor/wheelColor，不表达restore_original；provider将projectName放入Prompt，并叠加旧风格字符串。[FORM16 · shared/types.ts:17](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/types.ts#L17)、[FORM21 · server/provider.ts:4](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/provider.ts#L4) sport要求lower stance/front lip，而provider又要求保留几何；这是一处可读的指令冲突。[FORM22 · shared/catalog.ts:9](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/catalog.ts#L9) 新edit-plan与provider-prompt支持显式action、能力门和确定性约束，但尚未接到route。[FORM23 · shared/v2/edit-plan.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/edit-plan.ts#L1)、[FORM24 · shared/v2/provider-prompt.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/provider-prompt.ts#L1)
- **竞品文档/时间码：** Mody 00:20–00:22、00:50–01:08，UX05/UX11/UX12；Modyfy 01:13–01:24，UX29/UX30。它们启发风格、额外项、颜色/finish的意图分离，不能证明精准执行。Mody 00:42和01:35–01:41仅证明文字入口被记录，UX09，不是私有系统Prompt。
- **用户问题与价值：** 用户必须知道当前修改的是原图还是V1、选择是否已经生效、哪些东西会保留。先锁定语义，才能定位“没变”“换了车”“多加了部件”来自输入、Prompt、模型还是输出处理，避免仅凭更长的Prompt掩盖问题。
- **最小改动建议：** 在既有F05/F08中用受控字段编译Prompt；在F14展示基础图、修改清单、保留清单与草稿未生效提示。detail不套整车style；preserve表示当前base，restore必须有正确original-role引用且能力允许。不得把desired target当observed appearance。
- **冻结冲突：** 不允许首版raw free text、随意Extra/bodykit/spoiler、品牌SKU、stance改变或预生成expert overrides。PR6蓝图10文件第16行的“低趴风”不能越过PR3 specs/01-editing.md第9、27行。未验证wheel/finish以及strength/negative参数保持关闭；若要扩展，先有审阅的规格修订。
- **F12–F37落点及模块：** F14：src/features/editor/*、src/features/confirm/*、src/lib/draft-v2.ts；F29：research/form-v2/*与tools/evaluate-form.mjs；F35：server/v2/quality.ts、compensation.ts。上游仍是F05 provider/profile、F08 plans/presets，不新增第二后端或任务编号。
- **验收建议：** 原图能直接detail；从V1改色不读V3；rename不改变语义digest/Prompt；重复requested blue不能当已验证blue消除no-op；wheelDesign禁用时在报价前拒绝；启用的mock wheel编译不得同时要求保留spokes；未授权模型为零调用。真实同车/目标执行必须另有授权首图与独立图像评审，单测不代替质量通过。

## G04：报价、确认、任务、双账和恢复作为同一条信任链

**优先级：P0（扣次数、外部费用、并发恢复阻断项）。**

- **当前真实状态及源码：** legacy已有key重放查询、单active约束及1credit事务预留，不能说完全没有幂等。[FORM18 · server/app.ts:610](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/app.ts#L610) 但client key只在useRef里，跨reload不能提供F11的持久确认身份；没有V2不可变plan quote。[FORM17 · src/App.tsx:176](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/App.tsx#L176) legacy取消可作用于processing并abort；这不能证明供应商不收费。[FORM20 · server/app.ts:196](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/app.ts#L196) 状态屏已有uncertain和不自动再发文案，仍对全部active显示Cancel，poll还请求全state。[FORM44 · src/App.tsx:1143](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/App.tsx#L1143)[FORM43 · src/App.tsx:278](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/App.tsx#L278) 新schema已有submission/plan/active/version唯一骨架，supplier与用户lot是独立记录。[FORM28 · server/v2/schema.ts:37](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/v2/schema.ts#L37)、[FORM29 · server/v2/schema.ts:134](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/v2/schema.ts#L134)
- **竞品文档/时间码：** Mody 01:18–01:29，UX15/UX16；Modyfy 00:28–00:37，UX22/UX23。前者是等待表现后付费引导，后者是选图前可关闭的订阅页；都未证明开工或付款完成，不复制其收费时机和试用表述。
- **用户问题与价值：** 网络断了后要知道是否已经接受、还要不要重按、会不会再扣。清晰的quote、同一submission与真实task能减少重复确认，也让费用未知时保留可对账记录。
- **最小改动建议：** F11先持久化owner-scoped submissionId；F14显示服务端冻结底图/changes/1输出/1credit；F15只取task摘要，hidden暂停、foreground恢复；仅queued可取消。F09原子接受任务、用户lot allocation和最坏supplier exposure；F10原子写result/version/settlement。保留现有真实状态表达，不加假百分比。
- **冻结冲突：** 不设订阅/免费承诺；不在支付到账后自动生图；HTTP timeout/abort不能当零成本；不隐藏重试或换provider；不给processing“免费取消”。未知usage/cost保留null，预算默认0；高风险接线先满足REVIEW_GATES。
- **F12–F37落点及模块：** F14确认组件、F15 src/features/task/*与task-poller.ts；F27 server/v2/budget.ts、rate-limits.ts；F28安全诊断；F35根任务补偿；F36默认关闭的trial。上游F04/F09/F10/F11仍不可绕过。
- **验收建议：** 丢submit response+reload只得到同一task；不同语义复用key为409；新key不能再确认旧plan；两个并发请求不得多预留；cancel/start只有一个结果；worker重启/迟到output没有第二attempt/version；用户release一次且未知supplier exposure不被清零；评审证据同时列balance、expense/exposure、version count、UI state。真实StoreKit与签名验证继续待独立关口。

## G02：选图先本地，上传与AI分享各有真实同意

**优先级：P0（隐私与真实输入质量阻断项）。**

- **当前真实状态及源码：** 文件选择后立即FileReader→createProject→持久化，随后才reset consent；UI checkbox要求project已存在。[FORM12 · src/App.tsx:437](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/App.tsx#L437)、[FORM13 · src/App.tsx:1076](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/App.tsx#L1076) 服务端legacy创建route未检查版本化consentRecordId。[FORM14 · server/app.ts:446](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/app.ts#L446) 当前有真实MIME/大小/解码/旋转限制且明说不识车，应保留其诚实边界；input和output共用2400px normalize，还没有F06的master/display分离。[FORM15 · server/app.ts:83](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/app.ts#L83)
- **竞品文档/时间码：** Modyfy 00:44–00:49有Example Photos，00:56–01:00记录Replace，UX25/UX27；Mody 00:34–00:41图像不完整只支持选择UI变化，UX08。不能由这些画面得知何时上传、内容识别、相册处理或隐私同意。
- **用户问题与价值：** 选一张照片不应该隐含已经云存储/分享给模型。用户也需要实际的错误与构图指导，知道自己的图能否按当前能力处理。
- **最小改动建议：** F12将picker/preview/remove留在本地；经版本化上传说明后F07持久化；AI传输前单独披露真实provider/purpose并检验适用同意。F06分开input normalization、output master校验、display生成；HEIC交给F19真实native adapter，不猜MIME。
- **冻结冲突：** 不增加未批准识车模型、云预检或第二照片；不声称on-device AI/no collection。processor/retention/license未知就是发布缺口，不能填owner事实或假法律时限。
- **F12–F37落点及模块：** F12 src/features/photo/*、photo-input.ts及独立harness；F19 native image bridge；F26删除与session/cache生命周期；F31真实素材/政策；F37 owner+asset+hash cache。上游F06/F07必须先具备合同。
- **验收建议：** picker取消、preview、remove的upload/plan/reserve/model计数全部0；未同意不能存图；错owner/旧policy同意被拒；旋转、大图、iCloud/权限失败可恢复；输出master不因display目标静默缩到2400；账号切换与delete不显示前owner缩略图。真实HEIC/iPhone/删除恢复另验，不以Chromium通过替代。

## G01：用一组可信同车案例直达创作，并给原图单改入口

**优先级：P1（最高体验建议；发布案例仍依赖P0质量与授权）。**

- **当前真实状态及源码：** hero是带DEMO COLOR STUDY标识的样例，首CTA滚到八方向目录；Try this look on my car在style详情内。[FORM10 · src/App.tsx:644](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/App.tsx#L644)、[FORM11 · src/App.tsx:886](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/App.tsx#L886) 上传、explore仍携带styleId；refine要求已有version。[FORM17 · src/App.tsx:176](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/App.tsx#L176) 因此不能把冻结的“案例直达/原图detail”当成当前已完成功能，也不应把诚实demo图改称实测AI结果。
- **竞品文档/时间码：** Mody 00:00–00:07，UX02；Modyfy 00:22–00:26的普通车与具体改色/轮毂意象，UX21；00:44–00:49示例入口，UX25。这些仅形成“是否更容易理解和代入”的研究题，没有转化提升证据。
- **用户问题与价值：** 用户先要理解“我的车能怎样变”，再决定交照片；不必先读八个style术语，也可能只想改一处。可信案例把入口和具体任务联系起来。
- **最小改动建议：** F13增加case-to-photo主动作与Change one detail副路；style详情可选，公开example预览零生图。已有licensed demo作为内部路径；公开真实case要同时有rights、same-car/目标执行评审和版本信息。视觉重新验证，不恢复PR5。
- **冻结冲突：** 不新增必走onboarding/车型问卷；不把竞品照片或概念图作FORM成果；四个visible方向只是质量门后的候选，八个legacy ID仍可读；不沿PR6的低趴/任意部件拓宽首版。
- **F12–F37落点及模块：** F13 discover/navigation组件、F37 preview*；F29质量registry、F31licensed assets、F28最小诊断。组件在F12独立harness演示，生产App.tsx等到F32。
- **验收建议：** 一个明确case动作进入本地选图，不强制详情；detail不注入preset；demo/example标签可被8–12目标用户正确理解；无指导情况下能说明会改哪里和是否收费；失图仍有可靠示例/重试而不冒充结果；浏览、展开、返回全部零generation。人数是冻结研究计划，NOT_EXECUTED，不是已有用户证明。

## G05：把结果保留为同车版本，让比较和质量问题都有出处

**优先级：P1（结果价值）；身份错误/无变化的质量规则是开放真实生图前P0门。**

- **当前真实状态及源码：** 已有append版本与parentVersionId、结果strip、比较、收藏、selected-version refine、export/report。[FORM19 · server/app.ts:226](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/server/app.ts#L226)、[FORM30 · src/App.tsx:1274](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/App.tsx#L1274) 不应重写这些功能。legacy比较覆盖original/parent，garage默认latest；暂无chosen cover与任意两同项目版本选择。[FORM31 · src/App.tsx:1635](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/App.tsx#L1635)、[FORM32 · src/App.tsx:1873](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/App.tsx#L1873) export从现有图Canvas contain，无AI请求。[FORM33 · src/lib/export.ts:12](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/src/lib/export.ts#L12) 质量policy是纯参考，不能检测图像身份或写补偿账。[FORM27 · shared/v2/form-quality-policy.ts:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/shared/v2/form-quality-policy.ts#L1)
- **竞品文档/时间码：** Mody 00:33/01:31–01:34空garage，UX07/UX18；Modyfy 02:02–02:06结束，UX35。两款均缺结果、保存、比较、连续编辑证据，UX42；独立GARAGE补图无时间码，只能用作构图线索，UX36。这项价值主要来自FORM冻结合同，而非声称竞品已证明有效。
- **用户问题与价值：** 新图不等于满意图，自动保存不等于收藏；修改旧版不应改latest或覆盖历史。保留source、request、output和状态，才能解释质量与费用，支持真正有目的的下一次编辑。
- **最小改动建议：** F16显式区别Saved to your garage/Add to favorites/Save to Photos，允许正确base与比较；F17加入用户chosen cover和同项目版本比较；F35用服务端canonical pixel digest判断确切无变化，用trusted review处理质量；保持succeeded结果不可重写，补偿为单独事件。
- **冻结冲突：** 不把requested recipe或自动保存当质量/满意度；不把模糊相似度当exact no-change；不自动模型修复或无限赠送；不称Apple货币refund；导出实际尺寸不能冒充原生4K；不建跨项目/社交传播功能。
- **F12–F37落点及模块：** F16 result与Comparison，F17 garage/export-v2，F28 feedback/audit/events，F35 quality/compensation，F37 owner cache。上游master/display为F06；ledger/worker仍F04/F10。
- **验收建议：** 旧favorite仍可为cover；从V1出分支结果保留parent=V1；任意同项目两图比较/收藏/导出零AI；无图不替换成stock输出；不同PNG metadata但同normalized pixels只release一次且无official version；approved compensation按root_task唯一，技术release不再补一次；share-sheet-open不记为已发布。真实同车评审必须纳入首次输出、失败和非交付，不能只选最好图。

## 执行边界与下一次产品评审

这五项是范围内的优先建议，不是五个新任务，也不是自动实施顺序。具体执行仍按V2.2依赖图和各task allowlist；F32只有10文件/1000 changed lines的冻结cap，放不下应记录BLOCKED_TASK_TOO_BIG并提审拆分，不能减测试或把接线塞到别的任务。

在当前零预算、live/购买/trial/capabilities默认关闭状态下，可审查的下一产物是独立组件/合成合同/干跑证据，不是更漂亮但未经验证的真实生成宣称。[FORM36 · docs/form-handoff/configs/launch.json:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-handoff/configs/launch.json#L1)、[FORM40 · docs/form-handoff/specs/05-ui-ios-copy.md:5](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-handoff/specs/05-ui-ios-copy.md#L5) 钱包、worker、身份/IAP、删除及F32需独立关口；本研究没有替代审查、批准模型或开启功能。[FORM41 · docs/form-handoff/REVIEW_GATES.md:1](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-handoff/REVIEW_GATES.md#L1)

已有PR6关于前3分钟的时间轴是目标观察节奏，不能承诺3分钟出真实图。252次质量方案仍NOT_EXECUTED，预算授权为0；注册照片与owner事实为空缺时不得补造。[FORM39 · docs/form-handoff/specs/06-research-launch.md:5](https://github.com/23chen990/form-car-studio/blob/467e20758414216f215fb4106d098dedc0b18c3a/docs/form-handoff/specs/06-research-launch.md#L5) 原创实现边界见[06_ORIGINAL_ARCHITECTURE_ZH.md](06_ORIGINAL_ARCHITECTURE_ZH.md)。
