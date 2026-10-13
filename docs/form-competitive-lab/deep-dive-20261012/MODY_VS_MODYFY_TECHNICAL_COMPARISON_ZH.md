# Mody AI与Modyfy技术对照及初始化调查

**Mody有更多客户端Prompt编排证据；Modyfy有明确的ID请求合同和方向相关图片缩放。两者都不能确认实际生产生图模型，也不能凭工具输出量比较生图质量。** Modyfy Mac启动失败没有令本轮静态逆向失败：可读Hermes业务已覆盖生成请求、结果、图片和初始化流程。[AOT05–AOT20、MFY01–MFY15]

## 1. 安装、技术栈与可读取范围

| 项目 | Mody AI | Modyfy |
|---|---|---|
| 实际inner App | `/Applications/Mody AI.app/Wrapper/Runner.app` | `/Applications/Modyfy.app/Wrapper/Modyfy.app`；/Applications定位成功，~/Applications限定搜索无另一同名包 |
| Bundle/版本/执行文件 | com.cartuning.appitech；3.1.440 build2；Runner | com.ai.car.app；1.2.0 build71；Modyfy |
| 栈 | Flutter / Dart AOT，native Runner wrapper | React Native0.83.1 / React19.2.0，Hermes bytecode96；不是Flutter |
| 主程序 | SHA `52a37408d739a7cb8f508ce298eabae798bdb3e16a2960a97694217c103526cd`；cryptid1 | 38,064,720B；SHA `7874eeeb8482208625f57da59b1b1bcf9c4af76c7bb4ce78539a6847d827a465`；cryptid1、cryptoff20480/size4096 |
| 业务载体 | App.framework/App；15,099,328B；cryptid0；四Snapshot符号 | main.jsbundle；10,497,976B；SHA `99172009031933c890db1aca3c1385183bc2ef5104817a84c1155431ef430d0c`；无需解密native即可读取 |
| 可读组件范围 | 67 Framework旧原日志核对cryptid0；Flutter资源、metadata、选定AOT业务 | inner App9个Mach-O：main1，8 Framework0；Hermes/JS属性/数字、modules.json、资源/隐私manifest |
| App Store来源 | 已知本机wrap安装结构与公开身份；不读购买凭据 | codesign显示Apple iPhone OS Application Signing链与匹配BundleID；Wrapper元数据/SC_Info存在；普通receipt/Spotlight字段缺，安装交易未独立验证 |
| 公开身份 | App ID6523376299；录像版本未知 | App ID6762754163；官方页当时1.1.14不同于安装1.2.0，不能混用 |

Mody App SHA `7adc3271e13e82528512622b8f5e8303d5f11f4e6485f59c3919575d2f59c727`。Modyfy modules.json SHA `7a01e5cffe395e40f0c218c78add96a0c2f88267115a198081ca5aac367a33cb`，Info.plist SHA `f78f7147de714adac7ee0d96277ceddb75b784deaa04930927f0dd60dae4db56`。全部本机原程序保留原位未修改。[AOT01、ASSET01–ASSET05、ASSET12–ASSET16、MFY14–MFY15]

Modyfy8 Framework均有LC_ENCRYPTION_INFO_64、cryptid0：Clarity、hermesvm、FBAEMKit、FBSDKCoreKit、FBSDKCoreKit_Basics、FBSDKGamingServicesKit、FBSDKLoginKit、FBSDKShareKit。本轮只读检查所有inner App候选文件的magic/load commands，排除receipt/SC_Info个人与DRM元数据；未绕过主程序的加密区。[MFY15]

[Apple官方Modyfy页面](https://apps.apple.com/us/app/modyfy-ai-car-designer/id6762754163) 与 [Google Play官方页面](https://play.google.com/store/apps/details?id=com.ai.car.app&hl=en) 产品/开发者身份相符。公开安装入口不等于已取得APK、版本相同或原始包再分发许可。Android尚无包/哈希，静态分析NOT_EXECUTED；本地iOS Hermes已足以推进核心任务。若合法商店设备安装及允许的原始包访问成立，RN/Hermes载体有技术可行性；不得从iOS结果假造Android实现。[ASSET16]

## 2. 恢复工具与引用质量

Mody用unflutter-iOS固定commit＋一组兼容修复，29,605范围中28,056有snapshot标签、33,182字符串引用、208,071候选边。3条关键BL和10个BIN另有独立原字节核验。现代PP/ROData修复不意味THR/动态派发完整，类字段偏移仍多为合成名。[AOT02–AOT04、INDEPENDENT_STATIC_01]

Modyfy用 [hermes-dec0.1.7固定commit](https://github.com/P1sec/hermes-dec/tree/a0f18f97ab661eb8ed659c8c683a0d21ea619e69)、bundled Python3.12.14；2个上游断言通过，目标完整disassembly exit0。29,188function ID /35,098 strings全部range有效；大量29字节apply wrapper共享字节范围，先沿environment/closure/generator找主体，再查Call和属性。工具是AGPL-3.0+，输出及工具未打包进入FORM或公开二进制分发。[MFY01、TOOL02；格式来源：Hermes官方HBC定义](https://github.com/facebook/hermes/blob/main/include/hermes/BCGen/HBC/BytecodeFileFormat.h)

这些数量描述覆盖范围，不能比较代码完整率、业务复杂度或图片质量。Mody恢复较多名字不代表对服务器更了解；Hermes直接看到field/schema也不能自动确定动态函数的实际执行。

## 3. 函数证据、Prompt与生成工作流

| 业务 | Mody：代码位置与最高证据 | Modyfy：代码位置与最高证据 | 技术结论 |
|---|---|---|---|
| Prompt入口 | createFinalPrompt0x295558，caller0x27cb3c/0x4329a0；AOT05 | CarStyle#20352、CarMod#20361选取ID；MFY02/04 | Mody可读文字编排更多；Modyfy最终文本主要服务端Unknown |
| 模板/选择 | getGeneratePrompts VM0x354c44→API0x354d08；collection字段+87、fromJson type/prompt；AOT06–08 | runGeneration#20355/#20364 itemIds＋collection；MFY03/04 | 都有远程内容载体，完整正文/活跃配置缺失 |
| 自由文字/辅助 | remote flag→GptService0x295ebc，建议→controller0x2c5908；AOT10–12 | AI工具再编辑#22482读prompt，不能等同CarStyle；MFY06 | 不把其他AI工具或SDK术语归到汽车生图 |
| 图片准备 | top-level helper0x280cd0→compress→Storage，AOT14/15 | #22518/22519→createResizedImage→#22526 dataURL，MFY07–09 | 两者CODE_LINKED；无实际上传尺寸/encoder效果验证 |
| 标准生成 | API0x27d25c prompt/imageUrl/aspectRatio→post→predictionID；AOT13 | #20355 imageData/itemIds/collection→httpsCallable→outputs.url/credit；MFY03/05 | 请求schema不同，服务端job/model不确认 |
| 局部/工具 | Detail0x2f4510、Flux/PImage/Workflow/color分支；AOT16–21 | CarMod#20364与Effects分类/recipe，MFY04/06 | 模式有业务分类；未证明mask/局部像素锁定 |
| 任务/结果 | CarItemModel、GeneratedImages doc、History snapshots0x2103c8；AOT13/23 | pending/status/result/url/credit状态消费，MFY02/05 | 客户端有载体；服务端原子性、状态机、重试/救图Unknown |
| 付费/权限 | RevenueCat purchase→modyPurchase→afterPaywall；AOT22 | Adapty profile→isPremium/isPro/credit；MFY10 | 权益有静态联系；交易或高套餐更好质量未证实 |
| 再次编辑 | Prompt草稿/建议与history载体，AOT12/23 | #22481 result.inputs恢复collection/urls/itemIds；MFY06 | recipe恢复值得借鉴；不代表同车版本保真验证 |
| 后处理 | 独立Topaz命名工具，AOT19 | 返回图URL与显示处理，MFY05 | 没有每次自动超分/修复证据 |

Mody比Modyfy能确认更多**客户端工具路由/工作流选择**，包括实际引用的flux2edit/pimageedit别名及workFlowId；两者对**真实基础生图模型**都是Unknown。Mody文字selector openai-chatgpt-5只说明重写请求，不能增加“确认的生图模型数”。[AOT11、AOT16–AOT20、QUALITY_UNKNOWN_MODY、QUALITY_UNKNOWN_MODYFY]

Mody三模式：Style/Custom共享生成主干、Prompt分支不同，Detail有目标/轮胎流程。Modyfy全车style按style/extra/color组合，CarMods/Effects按类别，不能硬映射成Mody三tabs或固定模型。录屏均无成功首图，不用UI给代码质量背书。[UX05、UX28–UX32、UX42、UX46]

## 4. Modyfy图片预处理的可确认规则

iOS模块#22512（0x931549）设置1920/1080/JPEG90；#22519（0x931898）用宽高比和Math.round算target：横图宽>1920时缩宽并同比缩高；竖图高>1080时缩高并同比缩宽；未超阈值返回原尺寸。缺尺寸返回1920×1080fallback，因此不能声称“永远保比例”或“所有图都传1920×1080”。#22518创建resized image，#22526 fetch/blob/FileReader.readAsDataURL。[MFY07–MFY09]

Android独立模块#22533也有同样1920/1080/90常量，压缩后RNFS.readFile(base64)；本机是iOS版本，Android分支静态存在不证明Android实际codec或上传行为。原生resizer桥的mode/onlyScaleDown选项存在，不把泛字段当此业务已确认裁剪/蒙版。Mody的1920/1080/35与它不构成效果排名。[AOT15、MFY09、ASSET35]

## 5. Modyfy初始化失败：已确认到哪一层

用户报告Apple Silicon Mac弹窗：Initialization Error / Required services could not be initialized…；商店标“专为iPad设计，未经macOS验证”。本轮未重启App、重装或调整签名/系统策略。该平台标签为用户提供的运行环境信息，不把当前官方页面与安装版本混成同一macOS测试结论。

**代码原因已确认到“通用初始化catch显示弹窗”，实际失败依赖尚未确认。** factory#6614于+0xfb创建#6623、+0x100存env10；initializer body#6708（0x7763e9）catch +0x7d3后，+0x88d读env10、+0x891 Call1；#6623（0x7739a7）调Alert.alert并读SPLASH.INITIALIZATION_ERROR_TITLE/MESSAGE，cancelable=false。[MFY11]

启动顺序先critical组Firebase、Adapty、AppsFlyer：map调用task→Promise.allSettled→筛rejected名称，非空throw。dependent组为Adapty paywall products、AppsFlyer-Adapty integration、Remote configuration state，也对rejected throw。分别可到同一catch；错误字符串类型含“Critical initialization failed”与“Dependent initialization failed”，不公开额外内部日志/配置。[MFY12]

| 候选 | 当前支持 / 反证范围 | 判断 |
|---|---|---|
| iPad应用与macOS兼容性 / WebKit环境 | 用户提供平台标签；保存日志有WebContent bootstrap/xpc、context/server port问题 | 有候选证据，尚未连接到critical/dependent具体throw |
| 网络 / 服务端依赖不可达 | 保存Analytics NSURLError及归因网络失败；多个初始化任务可能依赖网络 | 不能把归因失败当核心Firebase初始化失败 |
| Firebase / Adapty / AppsFlyer初始化 | 三者确是critical任务；Adapty实现有异常throw路径 | 任何一个可触发通用弹窗；当次哪一个Unknown |
| paywall产品 / SDK集成 / remote config | dependent任务有throw路径 | 活跃状态/当次返回Unknown |
| 设备校验 / AppCheck / 权益身份 | 当前选定错误链无当次拒绝日志或可归因证据 | Unknown，不能确定，更不能绕过 |
| DRM / 签名 | main cryptid1且正常Apple签名可见 | 未见签名拒绝致该弹窗证据；不得把加密本身当启动故障原因 |

正常macOS日志读取仅有限窗口/进程，保留脱敏摘要（2026-10-12 19:35–19:37），没有凭据/访问token；原始精确argv未完整留存。日志未包含dialog对应的失败组/throw名称；唯一RUNTIME_OBSERVED记录是诊断，**不是生产模型执行或成功生成**。[MFY13]

## 6. 实际影响、投入价值与FORM建议

Mac启动失败阻断新增的交互、网络请求、购买与真实效果观察；对静态Hermes业务恢复影响较小，Prompt/输入schema/状态/初始化主体仍可读。main受保护区使部分native初始化/桥实现不可见，但不是放弃业务研究的理由。

值得继续的是：一次有限、正常支持平台的合法真机观察，确认初始化失败组及用户可见输入→确认→结果；需要账户/私人素材/费用时先独立授权。Android包获取是可选第二路线，缺合法原始包时不投入安装循环。当前继续猜模型、修Mac无限重启或抽更多SDK字符串，收益很低。[ASSET16、MFY11–MFY15]

FORM最有价值的原创实现：受控plan编译、input/master/display分离、base与recipe有出处、首次输出/失败保留、provider能力与费用有证据才开放；并使等待/余额与server task一致。它们在现有React/TypeScript/Express/SQLite与F任务中有落点，无需迁移Flutter/Firebase。质量提升需独立A/B验证，不能因架构严谨就宣传完美原车身份。[FORM23–FORM29、FORM37–FORM41；详见05/06与IMAGE专项]

所有静态地址、function ID、文件SHA、工具/命令、观察与不能推断内容在 [09账本](09_EVIDENCE_LEDGER.jsonl)。原始代码、资源、配置与全部内部hosts只存本机private目录，未公开。
