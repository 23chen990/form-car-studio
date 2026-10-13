# FORM下一步：五项建议与一个质量实验

本页是 **RESEARCH_ONLY / PENDING_APPROVAL** 的具体建议，不自动启动产品实施。现有任务图、allowlist和危险接线审核优先；实施继续使用PR3规定的implementation分支，不将研究PR当产品获批。本轮已完成可供评审的报告与证据，不需要再安装分析工具。

## 五项改进的实施与验收

| 优先 / 提案 | 前置与冻结任务 | 建议修改范围 | 预期收益；成本/风险 | 明确验收 |
|---|---|---|---|---|
| **P0 G03：确定性改动/保留合同** | F05依赖F01；F08依赖F04/F05/F06/F07；F14依赖F08/F11/F13 | F05 `server/v2/provider.ts, provider-profile.ts`及其测试；F08 plans/presets/routes-plans；F14 editor/confirm/draft-v2与harness | 可定位Prompt/目标执行问题、减少互斥要求；范围中等，真实质量收益待实验；零模型离线可做 | 原图detail不套style；选V1用V1；rename不改Prompt；禁用field在quote前拒；wheelDesign保护分支不矛盾；multipart来自同一plan，≤1mock invocation；live仍关闭 |
| **P0 G02：输入/master/display与本地选图** | F06依赖F02；F12依赖F07/F11；F19依赖F18 | F06 images/assets＋synthetic tests；F12 photo/photo-input/harness；F19 native-media及明确iOS allowlist | 减少不必要图像损失和隐含上传；范围中等，HEIC/EXIF/codec有真机风险；原生工作不由浏览器替代 | preview/remove/cancel各0upload/model；同意后才持久化；4096px synthetic master不缩2400；orientation/digest/oversize/animation/cross-owner检查；实际HEIC/iCloud证据另列 |
| **P0 G04：确认、幂等、费用与恢复** | F09←F08，F10←F09，F11←F09，F15←F10/F11，F27←F10/F22；先独立wallet/worker/身份审核 | tasks/routes-tasks、worker/recovery、submission-store/api-v2、task/poller、budget/rate-limits；只各自allowlist | 提高收费与等待信任；范围大、钱/并发高风险，不声称一次UI修改能完成 | 丢ack/reload同一task；重复/异义key不双扣；双claim/取消竞态/重启/迟到result无多attempt/version；user lot和supplier未知暴露分开；只queued可取消；不隐式retry/fallback |
| **P1 G01：可信案例直达选图＋原图单改** | F13←F12；正式素材F31←F19/F26/F30；质量F29←F14/F27 | discover/navigation/harness；已有licensed placeholder只用于清楚标记Demo；公开case权利/质量登记按原任务 | 减少术语/选择负担、提高上传动机的可测假设；组件成本较小，素材/用户研究是依赖 | 一个case动作到本地选择；无需读style详情；detail不暗套preset；8–12用户能解释用途/demo/费用；浏览全部0generation；无真实质量不宣传同车效果 |
| **P1 G05：保留版本并改善比较/继续编辑** | F16←F14/F15，F17←F16，F35←F10/F16/F28，F37←F15/F17/F19/F26 | result/Comparison、garage/export-v2、quality/compensation、owner-scoped cache与各测试 | 复用已有append/parent/比较/收藏，提升再次改车及可追溯性；中等范围，补偿/删除独立门 | 从旧V1分支仍parent=V1；比较/收藏/导出0AI；cover可指旧favorite；master/digest有出处；exact unchanged不造official version；root唯一补偿、未知observed不填desired |

依赖、allowlist取自固定PR3任务卡；成本是相对工程范围，非工期或美元报价。完整缺口与源码Evidence ID见 [05](05_FORM_GAP_AND_PRIORITY_ZH.md)：FORM12–FORM15、FORM17–FORM29、FORM30–FORM41。本次只读核对任务卡，未执行这些测试或修改这些模块。

F05/F06的离线任务前置已经有参考/Schema基础，外部模型缺失不要求填假配置；其他任务按DAG等待相应CODE_READY与review，不数值顺序跳跑。F32冻结10文件/1000changed lines若放不下，要BLOCKED_TASK_TOO_BIG并提审split，不能删测试、越allowlist或先接危险系统。[FORM41；FORM_CODEX_START与固定任务合同]

## 最值得申请的一个实验

先完成零模型合同/图片合成验收，再考虑 **6个有权开发槽位×2个原创Prompt＝12个首次改色输出**。固定provider/model/profile、同一规范输入和参数，只改变保留约束；随机盲评身份、目标、灯/轮毂、背景和愿保留。12属于162开发计划内；原总量216＋36＝252包含这12，执行后才是150＋54＋36＝240待执行。目前252全部NOT_EXECUTED。细则和空槽位见 [07](07_QUALITY_AND_RESEARCH_PLAN_ZH.md)。[PLAN01–PLAN02]

输出达不到身份/可用门时缩窄能力；不能把失败图删除后宣传成功。不要以竞品API名称、严谨Prompt或native分辨率替代这项质量证据。

## 哪些后续动作需要单独授权

- **真实模型与照片：** 明确有权使用的照片、用途/传输/私有存储，精确供应商/profile/参数及可辩护的单次成本上界、12次或更大阶段预算。当前均缺，预算0，不发请求。[PLAN01–PLAN02]
- **购买/账户/真机研究：** 竞品购买或试用、研究账户、私人素材传输及用户访谈/记录；启动正常支持设备的有限观察在这些依赖前止步，不绕认证。Android包合法获取/读取方式尚未建立；缺包就保留缺口。[ASSET16、MFY10–MFY15]
- **首版边界变更：** raw free text、任意参考图/Extra、bodykit/stance、品牌精确fitment、strength/mask/专用negative、订阅/视频等必须先有审阅规格修订；此研究不授新功能。[FORM37–FORM40]
- **危险接线与发布：** migrations、wallet/worker/idempotency、identity、Apple购买/退款、删除和F32按REVIEW_GATES及审计issue独立验；merge/部署/上传Store/国家开放/实际模型配置另需owner许可。本报告、mock测试和Draft PR均不批准这些动作。[FORM41]

可以在既有实施授权与任务前置满足时继续安全离线任务；本研究完成后不自行扩展成生产实现。私有原件、报告、branch与Draft PR的交付位置见 [00](00_README_ZH.md)。
