# Mody AI Flutter AOT：真实代码证据与限制

目标安装版为 **3.1.440 build2 / com.cartuning.appitech**。本轮在未加密 `App.framework/App` 上完成纯静态 AOT 分析，恢复了选定业务调用与字符串引用；没有运行 App、读取受保护 Runner 内存或调用私有接口。所有绝对地址均是该 thin Mach-O 的静态 VA；本输入 vmaddr/fileoff 相等，**不是运行时 ASLR 地址**。[AOT01、ASSET05]

## 1. 输入和工具固定

| 输入 | 路径 / SHA-256 / 状态 |
|---|---|
| App | `/Applications/Mody AI.app/Wrapper/Runner.app/Frameworks/App.framework/App`；15,099,328 B；`7adc3271e13e82528512622b8f5e8303d5f11f4e6485f59c3919575d2f59c727`；arm64、cryptid0 |
| Runner | `/Applications/Mody AI.app/Wrapper/Runner.app/Runner`；`52a37408d739a7cb8f508ce298eabae798bdb3e16a2960a97694217c103526cd`；cryptid1，受保护业务未分析 |
| Framework 旧扫描 | 原始日志 `frameworks-raw.txt` SHA `791ab4dd5a5db41167ee43fd2dace4641528acffd28c218667c9ed02d2d2cda9`；确认 67 项 cryptid0，不沿用旧工具“Encryption YES”错误标签 |

四符号位置：VM instructions `0x4000`，isolate instructions `0xe800`，VM data `0x7dabc0`，isolate data `0x7e4400`。`__text=[0x4000,0x7dabb0)`。Snapshot hash 为 `78da37fed6bf1489361a312568249f3f`，FullAOT3、arm64 ios、no-compressed-pointers。Flutter engine 字符串报告 Dart3.11.3；工具 `dart_meta.json` 的 3.11.0 是相同 hash 的解析 profile，**App 编译 SDK 的精确 patch 版本仍 Unknown**。[AOT01–AOT02、INDEPENDENT_STATIC_01]

[unflutter-iOS](https://github.com/turingH/unflutter-iOS/tree/b9a4828f2552227f16cec79a074e3d0b8f3df6b6) 固定提交 `b9a4828f2552227f16cec79a074e3d0b8f3df6b6`；README、BSD-3-Clause 许可证、go.mod、构建/解析路径已审阅。依赖 `github.com/zboralski/lattice v0.1.0`、`golang.org/x/arch v0.23.0` 经 go.sum / `go mod verify` 验证。官方 Go1.25.4 darwin-arm64 tar 的 SHA 为 `c1b04e74251fe1dfbc5382e73d0c6d96f49642d8aebb7ee10a7ecd4cae36ebd2`，仅存 private 隔离目录；未 sudo、Homebrew 或修改系统 PATH。[TOOL01；来源：Go 官方下载元数据](https://go.dev/dl/?mode=json&include=all)

分析命令在私有目录执行：

```text
private/tooling/unflutter --out private/raw/mody-unflutter-original --max-steps 10000000 App
private/tooling/unflutter-compat --out private/raw/mody-unflutter-compat --max-steps 10000000 App
```

两次均 exit0。第一次 15.16 秒只生成范围，strings/classes/signals 都为 0，**不算语义恢复成功**。对同一工具只做一组有测试支持的临时兼容补丁，再分析 16.25 秒得到以下结果。[AOT03–AOT04]

## 2. 为什么补丁必要、输出可信到哪一级

现代 ROData 对象的 CID 在 bits12…31，delta-before-object、16B 对齐、image header64B；原解析的旧标签/对齐/基址让字符串和类失配。PP 的原始 word offset 包含两个 header 槽，匹配现代 CID profile 后为显示引用补偿 +2；导出 `pool_idx` 是原始 word slot，逻辑 entry=`pool_idx−2`。修复依据对照 [Dart3.11.3 官方 snapshot 源](https://github.com/dart-lang/sdk/blob/3.11.3/runtime/vm/app_snapshot.cc) 与 [image layout](https://github.com/dart-lang/sdk/blob/3.11.3/runtime/vm/image_snapshot.h)，不修改 App。[AOT03]

5 个新增合成用例先红后绿：3 个覆盖现代字符串/CID/delta/越界与非字符串 offset，2 个覆盖直接 LDR 和 ADD+LDR 的 pool header。原版 `go test -json ./...`：109 pass / 33 skip；补丁版：114 pass / 33 skip、build exit0。补丁 SHA `c351606f3cd5b79ea1af22fcfc86a4d77ac23960fa68affb4e96e72657eff9c1`；兼容 CLI SHA `fe847c391efe638aa261709180f783e7e0bd980aaa8734b135729562d76a3d0b`。未声称支持所有 Dart 版本。[AOT03]

| 输出/校验 | 本轮结果 | 不能外推 |
|---|---|---|
| 函数范围 | 29,605；28,056 snapshot 标签＋1,549 generated 标签 | generated 名称不是源级业务名；优化/内联不可逆 |
| 调用边 | 208,071：189,648 BL、18,423 BLR | BLR、动态 dispatch 与 annotation 不是全部具体 target 已解出 |
| 字符串引用 | 33,182 | 需要具体指令和消费者，不能按关键词命中判功能 |
| Class layouts | 5,406 | `f_0x…` 多为合成偏移，不是已恢复全部真实字段名 |
| Thread | THR fields=0；41,244 unresolved THR refs | 线程对象字段语义不完整 |
| 保存成果 | functions/call_edges/string_refs、dart_meta、flutter_meta、ASM/BIN、signal.html/DOT | Graphviz 未安装，未生成 SVG；HTML存在不等于完整语义成功 |
| 独立检查 | 原 App SHA、29,605 范围、10 `.bin`、3 条 raw BL 全通过 | 只核字节/地址/边，不是全程序、支付或生图质量批准 |

必须使用正确坐标：`functions.pc` 是实际静态 PC；`index.pc_offset` 与文件名后缀相对 `0xe800`。例如 `createFinalPrompt_286d58` 的 PC 是 `0x295558`。独立 BL 解码 `0x27cb3c→0x295558`、`0x354c8c→0x354d08`、`0x2956a4→0x295ebc` 均与原字节、caller.bin 和 edges 相符。[INDEPENDENT_STATIC_01]

关键输出 SHA：functions `fc174c8d4776669a7959c8040a4f9e2a515087245d751b76e264801c6f5da518`；edges `8dfc50e7e217f8100ce851afc6196b59fe73150d979ab583c19149f2f31b969b`；string refs `da6029c4acbeea6a511d7bb5b32d0e79a590342658273dda232f15552b260364`。原始结果仅在本机 private/raw 两个分析子目录，未推送。[AOT04]

## 3. 三个指定 Prompt 函数：调用者、输入、输出

| 函数 / PC | 真实引用与输入 | 可证明的输出或动作 | 限制 / ID |
|---|---|---|---|
| MainVM.createFinalPrompt `0x295558`，2164 B | `generateCarAfterPaywall` 的 BL `0x27cb3c`、`generateCar` 的 BL `0x4329a0`；receiver 草稿、可选 named `promptCarItem`、Custom 分支状态 | 异步最终文本；类型模板/颜色替换、列表 join、相机角度约束、trim；Custom 可走重写 | 未完整恢复字段名/每个分支样本、所有顺序与冲突覆盖。AOT05、AOT09–AOT11 |
| MainVM.getGeneratePrompts `0x354c44`，196 B | `_TabGenerateViewState.initState` `0x354bec`；BL `0x354c8c→ApiService 0x354d08` | 从远程 query 的 docs 映射 GeneratePromptModel 列表并进入 VM | 远程真实 prompt 值未取得。AOT06–AOT08 |
| MainVM.applyCarSuggestionToPrompt `0x2c58d8`，84 B | suggestion closure `0x2c58bc`、BeforeAfter suggestion tap `0x461778`；传入建议文本 | `TextEditingController.set:text` `0x2c5908`＋notify `0x2c5910` | 此函数无直接生成/网络调用，建议来源未完全确认。AOT12 |

模板集合也有字段链：ApiService 构造器 `0x221c50` 取 `generatePrompts` collection，`0x221c5c` 存 `[receiver+87]`；getGeneratePrompts `0x354d38` 读同一字段。query/get 含动态调用，doc 转换闭包 `0x354f2c` 调用 fromJson。模型 fromJson `0x354f44` 读取 `type`/`prompt` 于 `0x354f70/0x354fcc`，toJson 也使用这两个键。[AOT07–AOT08]

因此可以确认：**客户端模板选择逻辑＋远程模板数据**，而非“所有私有 Prompt 都被恢复”。风格、颜色、Extra 可进入类型模板/拼装路径，颜色有 `{yourColor}` 占位替换；在若干位置调用 getGeneratePromptByType、replaceAll、colorToString，之后以逗号连接并附加保持相机角度规则。尚不能可靠写出所有输入的完整排序、缺省/覆盖规则或服务端追加约束。相机文本保护也不证明轮毂、车灯、身份已保留。[AOT09]

Custom 分支在 `0x295600` 读取 `gptCustomPromptIsActive`，可在 `0x2956a4` 调 GptService `0x295ebc`。请求有 `user_prompt` 与 832 字符的本地 `system_prompt`，有汽车改装意图/英语输出形式线索；仅分析结构，未公开第三方私有原文。当前远程开关值、服务端改写仍未知。错误返回分支可保留原输入；是否实际命中不确定。[AOT10]

该**文字重写**请求包含 temperature=0、max_output_tokens=100（Dart Smi `0xc8`，不能误读成200）、selector=`openai-chatgpt-5`、request version=`0.0.1`；jsonEncode `0x295ff4`→post `0x296008`→timeout，解析 output/text。selector 和 version 只说明客户端发送值，不能确定 OpenAI 实际执行、基础模型发布日期，更不能当生图模型。[AOT11]

## 4. 生成、图片、工具路由和模式

| 路径 / PC | 请求或关键调用 | 证据结论 |
|---|---|---|
| MainVM.generateCarAfterPaywall `0x27ca48` / generateCar `0x4328f4` | extra 组合→createFinalPrompt→text moderation→generateAdvancedStyle | 共用 Prompt/常规生成主干。named `isFreeGeneration` 存在不证明免费。AOT05、AOT13 |
| ApiService.generateAdvancedStyleApiCall `0x27d25c` | input helper `0x27d374`、image moderation `0x27d4cc`；`prompt,imageUrl,aspectRatio`；post `0x27d718`；predictionID `0x27d7a8` | 真实请求构造可读，服务端有效 Prompt/模型未知。AOT13 |
| top-level imageToUrlProcessImageInput `0x280cd0` | 远程下载/本地图、aspect 检测、compress；Storage.putFile `0x281128`、getDownloadURL `0x28113c` | 图片准备→存储URL有边；不能说 helper 属于 ApiService 类。AOT14 |
| ApiService.compressAndGetFile `0x283f0c` | Flutter wrapper `0x284180`→common `0x6fd89c`→MethodChannel `0x6fda80` | 11项参数列表的1920/1080/35有代码证据。AOT15 |
| ToolBoxService.toolImageEditWithFlux `0x2f631c` | URL resolver /多图片循环；`prompt,imageUrls,imageSize`；flux2edit `0x2f6c28`→post `0x2f6ca4` | 路由与代码有关；实际FLUX模型/version未知。AOT16 |
| toolImageEditWithPImage `0x2f80e0` | `prompt,imageUrls,aspectRatio`；pimageedit `0x2f8b30`→post `0x2f8bac` | 独立请求形态，供应商未知。AOT17 |
| toolImageEditWithWorkflow `0x2f9f68` | `workFlowId` `0x2fa9c4`＋图片/Prompt；post `0x2faa84` | 工作流选择存在；远程ID/节点/模型未知。AOT18 |
| toolImageEditWithTopaz `0x28dd68` | `imageUrl`，topazupscale 别名 `0x28e344`→post `0x28e3c0` | 独立工具候选；不是已证实每次自动后处理。AOT19 |
| fluxCustomColor `0x4b9d0c` | Toolbox VM caller `0x4b9c8c`；flux2edit `0x4ba160` | 颜色工具有分支；不证明准确改色/保几何。AOT21 |

压缩的字段顺序与 [官方 FlutterImageCompressCommon 参数列表](https://github.com/fluttercandies/flutter_image_compress/blob/main/packages/flutter_image_compress_common/lib/flutter_image_compress_common.dart) 相符，支持解释为 minWidth1920、minHeight1080、quality35；这是外部 schema 对照，不是假定安装版等于当前上游。**不写“实际上传固定1920×1080”**：源长宽比、格式分支与 native codec 决定输出；PNG质量语义也不同。没有实际文件与真机测试。[AOT15]

Detail handler `0x2f4510` 有 clearAllPrompts、premium检查、handleTargetImagePrompt、getGeneratePromptByType/replaceAll，以及轮胎流程 remote flag / workflow ID 分支。目标 helper `0x2f57c4→getMultiSectionPrompt`，后者有类型模板调用。Custom/Detail 点击事件名在 `0x465938/0x465700` 有真实引用。**可确认 Detail 有独立业务分支；不能固定映射三个入口到三个生产模型。** 视频归档只记双页签，不能把新静态发现倒写成同一录屏第三 tab。[AOT20、AOT25、UX46]

多URL不是蒙版，多section Prompt不是像素局部编辑。selected 请求中没有可靠确认 mask、strength、专用 negative、seed、LoRA/ControlNet、身份 embedding；这是所查路径的 Unknown，不是断言服务端没有。crop SDK 存在未升级为生成前真实裁剪。Topaz 命名不证明供应商或超分效果。[QUALITY_UNKNOWN_MODY、ASSET25]

## 5. 付费、历史、视频与 SDK 等级

Paywall2.startPurchase `0x2d795c` 调 Purchases.purchase，返回后 `0x2d79f0` 进 modyPurchase；modyPurchase `0x2d7c40` 的 premium相关分支 `0x2d8430` 调 generateCarAfterPaywall，再到 Prompt/生成主干。Purchases.purchase 到 MethodChannel 也有静态链。**CODE_LINKED 购买回调，不是 RUNTIME_OBSERVED 交易**：金额、到账、签名校验及用户授权未验证。[AOT22]

HistoryService.getCarHistory `0x2102bc` 调 Firestore snapshots `0x2103c8`；生成请求涉及 GeneratedImages doc / predictionID / CarItemModel。服务端 HTTP→doc 写入、全生命周期、作品是否真正保存的连接仍缺，流程图使用虚线。[AOT13、AOT23]

两种 video workflow / streamimage MainVM→ApiService 静态关系已找到（`0x2dbd74→0x2dbf08`、`0x2dc608→0x2dc79c`），视频状态 enum 存在；生产视频能力/质量未知，FORM首版不模仿。[AOT24]

资源盘点：161文件/75,370,849 B，13可解析JSON（11 Lottie），36 SVG、82 PNG、10 MP4等；166 Manifest 引用对应154文件＋12缺失 `.DS_Store`。`.env`只记录键与哈希；图片/Prompt/config值不公开。[ASSET06–ASSET09、ASSET19]

| SDK / 插件 | 本轮最高支持级别 | 不能推断 |
|---|---|---|
| Firebase12.14.0：Storage/Firestore | 选定上传/模板/历史函数 CODE_LINKED | 所有server写入、账户当次访问、保真 |
| RevenueCat5.67.1 / Flutter9.16.1 | Purchases→paywall callback CODE_LINKED | 交易成功、退款、模型质量/套餐上限 |
| Adjust5.6.2 / ScateSDK7.0.5 | 元数据 STATIC_PRESENT；选定Scate事件调用可见 | 实际采集/发送、转化或所有事件时序 |
| Image picker / TOCrop3.1.2 | STATIC_PRESENT | 真实裁剪规则或照片构图变化 |
| FlutterImageCompress | 选定压缩到channel CODE_LINKED | native真实输出、每个生成模式共用参数 |
| Gallery save / photo_manager / sqflite / prefs / SDWebImage | 元数据 STATIC_PRESENT；部分偏好/下载引用可读 | 完整保存/导出/SQLite任务/缓存一致性 |

SDK 链统一停在已经取得的一级：存在→静态引用→调用边→运行观察→效果验证。本轮没有真实生成、购买或效果验证。[ASSET20–ASSET32；业务对应 AOT14–AOT23]

全部结论的原始来源、ASM位置、SHA、命令与限制在 [09账本](09_EVIDENCE_LEDGER.jsonl)。双竞品及实际质量因素见两份专项报告；工具失败和有限修复见 [08](08_TOOL_FAILURES_AND_LIMITS_ZH.md)。
