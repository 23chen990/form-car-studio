# Mody P1-C：离线分支与 Detail 证据（2026-10-14）

目标为 `com.cartuning.appitech` 3.1.440 build2，`App.framework/App` SHA-256 `7adc3271e13e82528512622b8f5e8303d5f11f4e6485f59c3919575d2f59c727`，本次重新读 Info.plist 与原 App 验证匹配。全部是 **CLIENT_CODE_LINKED / STATIC ONLY**，没有本次 UI 运行、模型调用或购买。39 个选定 `.bin` 与同一原 App 范围逐字节相符，24 条所需 BL 从原字节独立解码相符；见 `selected-source-check.json`，其中每个源 ASM / BIN 均有 SHA。这两个计数是定点结构校验，不能成为生成质量、运行路径或服务端通过证据。

ASM 相对路径以下均相对于既有 `mody-unflutter-compat` 导出。文件后缀为 isolate 相对地址；本文 PC 为后缀加 `0xe800` 的静态 VA。`f_0x…` 为 **相应原始 receiver 的字段偏移**；ARM 指令的 heap-tagged receiver 位移常为字段偏移减 1。同偏移在不同对象上不能混用。

## 一、Style / Extra / Color 的真正组合与选择优先

**字符串写入顺序与冲突胜者是两件事。** 已经能定出客户端哪份输入进入哪个位置，但远程模板和服务端对相互矛盾的描述如何解释仍为 UNKNOWN。

| 情况 | 客户端明确行为 | 代码位置和数据流 | 不能推断 |
|---|---|---|---|
| 标准 Style 组合支路 | 输出片段顺序为 **Style → Extra → Color**，之后 trim；没有在这条支路按 Style/Extra 的含义做覆盖裁决 | `MainViewModel/createFinalPrompt_286d58.txt` PC `0x295558`；receiver `f_0x1e0=false` 进入标准构造；第二 positional 参数 `X2=false` 在 `0x295860` 跳 `0x295c90`；Style 存 `0x295d10`、Extra 读 VM `f_0xa8` 于 `0x295d20` / 存 `0x295d34`、Color 存 `0x295d54`；interpolate `0x295d5c` → trim `0x295d64` | 不得写“Color 最后，所以 Color 一定赢”；此支路未见含义裁决，不代表全 App/远端不存在兼容规则 |
| Style 来源优先 | `promptCarItem` 非 null 时取它的 `style.prompt`；仅当整个 `promptCarItem` 为 null 才取当前 VM 所选 style。历史 car item 存在但 style/prompt 为 null 时走本地 fallback，不回退当前 VM style | 同文件 `0x295c9c–0x295cf4`；CarItem `f_0xb8` → Style model `f_0x20`；VM `f_0x198` → Style model `f_0x20`。`CarItemModel/toJson_1fae18.txt` `0x209718–0x209744` 将 CarItem `f_0xb8` 序列化为 `style`；`selectACardStyle_2b6980.txt` `0x2c51ac` 写 VM `f_0x198`，`0x2c51d4` 将所选项 `f_0x18` 写文本控制器 | 未取得服务端所选 Style 文本，不把模型字段名当作完整原源代码字段恢复 |
| Extra 来源 | 标准片段取 VM `f_0xa8` 的现成组合文本；历史 extras 在 paywall 返回路径先 map / join 后调用 setter。UI 临时 extras 提交也是 map / join → 同一 setter | `setExtraPrompt_287c78.txt` `0x296490` 写 VM `f_0xa8`；`generateCarAfterPaywall_26e248.txt` CarItem `f_0xc0` 于 `0x27cab8`，map `0x27caf4` → join `0x27cb00` → setter `0x27cb0c`。`OldStyleBuilder/sub_2b51f8.txt` `0x2c3a20→modifySelectedExtra`，临时 VM `f_0x1c0` 于 `0x2c3a3c` → map `0x2c3a64` → join `0x2c3a70` → setter `0x2c3a7c`。`modifySelectedExtra_2b52c8.txt` 清 VM `f_0x1b8` (`0x2c3af0`) 再 addAll 临时 `f_0x1c0` (`0x2c3b08`) | 列表操作证明当前提交实现；本轮未恢复每个远程 Extra 的文本或任意多选兼容性 |
| Color 来源的优先链 | **当前 named color（非 null 且非空）→ 当前 custom Color → 历史 `promptCarItem.selectedColor` → 非空当前 custom 文本控制器内容 → null/fallback**。前三种都经同一个颜色类型模板替换 `{yourColor}`；custom Color 先转 RGB 文本 | `createFinalPrompt` `0x2956d0/0x2956dc` VM `f_0x1a0` 非 null / length 非零 → template `0x2956f0` → replaceAll `0x295720`；否则 `0x295734/0x29573c` VM `f_0x1a8` → colorToString `0x295744` → template `0x295758` → replaceAll `0x29576c`；否则 CarItem `f_0xc8` `0x295780/0x295788` → template `0x295798` → replaceAll `0x2957c4`；否则 VM `f_0x208` → controller value/text (`0x2957d4–0x2957e8`)。CarItem toJson `0x2098cc–0x2098dc` 将 `f_0xc8` 写 `selectedColor` | `{yourColor}` 的模板正文为远程数据；当前 Color 是否保留车身/所有颜色、服务端覆盖胜者均 UNKNOWN |
| Named / custom Color 互斥 | 选择 named color 清 custom Color；选择 custom Color 清 named color。不是根据按钮或数组推断的互斥 | `changeSelectedColor_2b87d8.txt` `0x2c7008` 写 VM `f_0x1a0`、`0x2c7028` null VM `f_0x1a8`；`changeCustomColor_2b8db4.txt` `0x2c75e0` 写 VM `f_0x1a8`、`0x2c7600` null VM `f_0x1a0`。`colorToString_2809fc.txt` `0x28f28c–0x28f2f8` 为 RGB 结构、通道 getter 仍是动态 dispatch | 未运行 palette 和 picker，不声称选中真实值或实际颜色效果 |
| 高级组合支路 | 第二 positional 参数 `X2=true` 时走 **Angle → 高级修改 prompt 列表（逗号 join）→ Color**，这条支路不加入标准 Style/Extra 片段。高级列表先 flatten 历史 CarItem 的嵌套选项，再追加当前 VM map 的 values 所含 prompt。未见本函数内去重 | `createFinalPrompt` `0x295860` 另一分支；CarItem `f_0x98` `0x29588c`，嵌套 item prompt `0x29593c` 追加 `0x295990`；VM `f_0x1f8` 于 `0x295a18` → map values iterator → item prompt `0x295acc` 追加 `0x295b20`；Angle 优先 CarItem `f_0xa0.prompt` (`0x295b64–0x295b78`) → 当前 VM `f_0x1b0.prompt` (`0x295b8c–0x295ba4`) → `Same angle view` (`0x295bb4`)；join `0x295bfc`，Angle/列表/Color 的位置 `0x295be0/0x295c08/0x295c54`；interpolate/trim `0x295c80/0x295c88`。`generateCarAfterPaywall` `0x27cb18–0x27cb28` 根据 CarItem.angle 是否非 null 设置此 bool | bool 的原源级参数名 UNKNOWN；高级修改相互冲突的解释 UNKNOWN。不能把 Angle 这个 Style Builder 路径当作 Detail Angle 控件证据 |
| Custom 支路与默认/清空 | receiver `f_0x1e0=true` 时可以远程开关控制文字重写，或返回历史 / 当前 custom 文本，随后提前结束；标准 Style/Extra/Color 不是总是追加。`clearAllPrompts` 对 style、named/custom Color 明确写 null，并清 extras / 文本控制器；没有证据给用户宣称某个 Style/Color 永久默认 | `createFinalPrompt` `0x2955c8` 在 false 时跳过 Custom 重写；true 情况 `0x295600→gptCustomPromptIsActive` / `0x2956a4→getCustomPromptFromGpt`，普通返回 `0x295818–0x295854`；`clearAllPrompts_243478.txt` `0x251cc0` style null、`0x251ce8/0x251cf0` colors null。`backToStyleBuilder_4566e0.txt` `0x464f04` 将 `f_0x1e0` 设 false；`selectTab_4465dc.txt` `0x454df8` 是该 mode 字段 setter | 当前远程开关与模板 default UNKNOWN。本地 PP298 `<vm:101>` fallback 在既有导出没有原文字面值；本报告只引用 fallback 身份，不编写最终 Prompt |

标准生成最终文本链仍为 `generateCar(0x4328f4)/generateCarAfterPaywall(0x27ca48)` → `createFinalPrompt(0x295558)` → `generateAdvancedStyle(0x27ce28)` → `generateAdvancedStyleApiCall(0x27d25c)`。增量确认返回值在调用者保存并传作生成文本；request 构造以 `prompt` (`0x27d648/0x27d658`)、`imageUrl` (`0x27d65c/0x27d66c`)、`aspectRatio` (`0x27d674/0x27d684`) 写入结构。其后的真实执行模型、远端最终 Prompt、所选词的语义冲突均 UNKNOWN。

## 二、Detail：可定出的控件与请求分支

本轮新增同版本静态 UI 字面值是 `Tires & Colors / Change Tires / Change Tire Colors / Rims`。它们是 **打包代码的 UI 构造证据，不是本次 UI_OBSERVED**。`_openTireAndColorPickerBottomSheet@841265525_2e56e4.txt` `0x2f3f40/0x2f3f4c` 把两个页签 label 写 `NewItemAndColorPickerTabWidget.f_0x18/f_0x20`，`0x2f3f58` 写类别常量 `Tire`。state `build_42f4d8.txt` 的直接 calls `0x43e240→_buildItemsTab(0x3f402c)`、`0x43e24c→_buildColorsTab(0x3f1374)` 成立。

**最重要的分支判定不是 title/type：**`_handleGenerate` 及 `getMultiSectionPrompt` 都拿 `ToolBoxModel.f_0x88` 与 `Tire` 比较，toJson `0x20a43c–0x20a444` 确认这个字段序列化键为 **eventName**；`type` 则是另一个 `f_0x18` (`0x20a400–0x20a408`)。

| 控件/事件 | 值与状态 | 到描述/请求的代码链 | 闭合程度与 UNKNOWN |
|---|---|---|---|
| `Rims` 通用 Detail 图片列表；同一个选择 setter 也被 Change Tires 的 item 事件使用 | 点击选中的 `ExtraModifyModel`；setter `0x2f32ec` 存 ToolBoxVM `f_0xd0`。模型 `id=f_0x8,image=f_0x18,prompt=f_0x20,title=f_0x30` 由 `ExtraModifyModel/toJson_2136d4.txt` `0x221f04–0x221f48` 确认 | `ToolboxGeneralCutomDetailPage/_openRimsPickerBottomSheet…_2e4408.txt` `0x2f2c90` 默认标题 Rims；列表 builder PP11108 (`0x2f2d18`) → Function ref111535 → 既有 index 的 `sub_2e45dc` PC `0x2f2ddc`；其 tap callback PP11113 (`0x2f3208`) → Function ref111536 → `sub_2e4a5c` PC `0x2f325c` → BL `0x2f328c→selectExtraModify(0x2f32c0)`。随后 Generate `0x2f47cc→handleTargetImagePrompt(0x2f57c4)` → `0x2f581c→getMultiSectionPrompt(0x2f5834)`，使用 selected model.prompt | Rims 的 UI callback→setter 已通过部分 pool lookup + 旧 index 交叉定位。具体 rim 图案的 label/ID/prompt 由远程 item 数据决定，UNKNOWN。新 Change Tires item handler `sub_3e57b4` `0x3f3ff4` 也直调相同 setter，但其 UI builder PP23461→匿名 callback 的精确 pool 身份本轮未恢复，标明这个剩余边 |
| `Change Tire Colors` 的 named palette 事件 | palette item 的 `CarColorModel.f_0x10` 是 **color 字符串**，`f_0x18` 是 **image URL**，不是 RGB Color 对象。`sub_3e3578` (`0x3f1d78`) 的非 clear 分支 `0x3f1df0–0x3f1e00` 取两值并调 `ToolBoxVM.selectColor(0x3ef3f4)`；setter `0x3ef424` 写 `f_0xa8=color`、`0x3ef444` 写 `f_0xb0=image URL`、`0x3ef460` 清 `f_0xb8` custom color。模型 schema 见 `CarColorModel/toJson_71f18.txt` `0x80794–0x807d4` | Handler 检查 `eventName=Tire` 与 `ToolBoxVM.f_0xa8 != null`；如果 `newTireColorFlowIsActive` 为 true，`0x2f48bc–0x2f48d8` 直接拿 color 字符串作 prompt；否则 `0x2f4904→getGeneratePromptByType(PP11139)`，`0x2f492c` replaceAll `{COLOR}`。Tire 的参考/目标图可来自 `f_0xb0` (`0x2f4b74–0x2f4ba0` / `0x2f4dfc–0x2f4e28`)；CarToolItemsModel 的缺省选择 ID 是 `color_selection` (`0x2f4c1c/0x2f4ea8`)，不是服务器 modification enum | color event→state→prompt/target-image 参数是同版本代码链。已证明 state 是上述 widget 的成员、两个 build calls 与页签 label；剩余 UI callback PP23455/23456→匿名 palette event 函数的精确 slot 身份未解，不能称完整 UI 点击已观测。具体 palette color 值 / image URL 未取得，UNKNOWN |

### getMultiSectionPrompt 的结构性“覆盖”

`getMultiSectionPrompt_2e7034.txt` 首先检查 `ToolBoxModel.f_0x98=templatePromptIsActive`。当它为 **false**，且 selected ExtraModifyModel 存在、`prompt` 非空，`0x2f585c–0x2f5888` **直接返回选中 model.prompt**，不再选 template。这是函数内的明确优先规则；它是“函数返回哪份文字”，不是“模型哪项改装获胜”。

若未提前返回，代码根据 `eventName=Tire`、`tirePimageIsActive` 与 `ToolBoxModel.f_0x90=generateType` 选一个 `PromptTypes` enum，再调用 MainVM 模板选择函数。下列 slot 已定，enum 源级名称未定：

| 条件 | PromptTypes PP slot | PC |
|---|---|---|
| Tire 且 tirePimageIsActive=true | 12637 | `0x2f58f8` |
| Tire / flag=false / generateType=flux2 | 12638 | `0x2f591c` |
| Tire / 其他 | 12639 | `0x2f5928` |
| 非 Tire / generateType=pimage | 12640 | `0x2f5950` |
| 非 Tire / generateType=flux2 | 12641 | `0x2f596c` |
| 非 Tire / 其他 | 12639 | `0x2f5978` |

随后 `0x2f59bc→getGeneratePromptByType`，取远程 template.prompt；selected model 存在时构造 **结构** `section prefix + ToolBoxModel.title + section separator + ExtraModifyModel.prompt` (`0x2f59f4/0x2f5a00/0x2f5a08/0x2f5a14`)，在 `0x2f5a3c` **replaceFirst** `{MOD_PARTS_HERE}`。这证明了 section 消费对象和字段，不披露/还原完整 template。无 selected model 时走 PP298 fallback。

### Detail 路由的准确条件

记 `T=(ToolBoxModel.eventName==Tire)`、`C=(T && named color != null)`、`WC=(C && newTireColorFlowIsActive)`、`WT=(T && !C && newTireFlowIsActive)`。

- `WC`：prompt 是 color 字符串；否则有 `C`：颜色 template replace `{COLOR}`；否则是 getMultiSectionPrompt 的返回值。
- `T && (WC || WT)`：选择 `tireWorkflowFunc`；workflow ID 按 `WC` 选 newTireColorFlowWorkflowId，否则 newTireFlowWorkflowId。`_handleGenerate` `0x2f47f0/0x2f47fc/0x2f4808/0x2f4830/0x2f483c` 为对应 remote getters，条件见 `0x2f4860–0x2f49a0`；`tireWorkflowFunc_2eb05c.txt` `0x2f9a3c–0x2f9a54` 选 ID，`0x2f9a88→ToolBoxVM.toolImageEditWithWorkflow`，`0x2f9ee8→ToolBoxService.toolImageEditWithWorkflow`。
- `T` 且未选 workflow：tirePimageIsActive=true 选 PImage；否则 generateType=flux2 选 Flux；否则 generic Tool edit。**Tire 分支不直接沿用普通 generateType=pimage 判断。**
- 非 `T`：generateType 为 pimage / flux2 / topaz 分别选择对应 client tool method，其他走 generic tool edit。generateType 的字符串→enum关系由 `ToolBoxModel/_parseGenerateType…_1fed38.txt` 证明：`pimage→PP6346` (`0x20d5b0–0x20d5c8`)、`flux2→PP6348` (`0x20d5dc–0x20d5f4`)、topaz→PP6350；本文只称客户端路由别名，不称实际模型。

Workflow request 构造确认 `prompt` (`0x2fa54c/0x2fa55c`)、`imageUrls` (`0x2fa564` 及后续数组)、`aspectRatio` (`0x2fa830/0x2fa848`)、`workFlowId` (`0x2fa9c4/0x2fa9d8`)。所有当前 flag、workflow ID 的私有值和服务器效果均 UNKNOWN；没有请求 mask/局部像素效果的证明。Detail 先清 MainVM standard prompts (`0x2f46ec` 等)，不等于用户选择的 ToolBoxVM 同字段被清空。

## 三、未闭合事项与停止边界

1. **Angle／Spoiler／Exhaust 的 Detail 控件→请求：UNKNOWN。** 既有 string_refs 的 exact label 定点查询只找到 Angle（Style Builder / 本地化路径）；这不是同版本 Detail Angle 闭环。Spoiler / Exhaust 的 exact label 在此 JSONL 查询未命中，不能声称产品没有这些功能，名称或数据可能远程/不同版本。旧第三方 UI 仍为跨版本 HYPOTHESIS。
2. PromptTypes PP12637–12641 / 15848 / 11139 的具体 enum 名称 **UNKNOWN**。类 CID5973 与字段布局已存在，但本次 enum 对象填充解析遇 unboxed bitmap 后停止，不猜源码型名。
3. 当前 remote config、远程 Style/Extra/Color item 文本、所有 template 原文、服务器追加约束与实际模型 **UNKNOWN**。
4. Rims 的通用列表 handler已关联；新 Tires 两个 widget 的 PP23455/23456/23461→具体匿名 callback 身份尚未取得，state / direct event / downstream request 分别有证据，不能升级成 RUNTIME_OBSERVED 或说“整条 UI 已执行”。
5. 本地 fallback PP298/拼接空白 PP297 是既有工具的 VM base object 显示；未在此轮解出完整原文字面。顺序、null/非空分支成立，不通过写最终文本样例补空缺。

## 四、工具、命令与失败

- 已先复用 PR8 `offline_aot_slicer.py`。原工具得到 4函数/1边，发现 `kind` 覆盖外层文件类型变量；主线程研究分支修复后为 5函数/2边，又确认旧 schema 无法解析 `target` symbolic name；主线程增加唯一 `functions.name→pc` 映射后，最终 **5函数/145边/0safe refs，exit0**，保留三份 private slice。0 safe refs 是白名单局限，不是无业务字符串。
- 原 `unflutter-compat _debug objects` 对 Mach-O 报 `elfx: not an ELF file / bad magic`，**exit1**。没有复制/改写 App，未改原工具源码。
- 私有 `poolhelper` 复用已存 parser 的 `machox + snapshot/cluster`，GOPROXY=off，只输出18个所需 PP refs 与尝试 CID5972/5973，不做 disassembly / 全 analysis。第一次 compile 因 refID int64→int 类型转换失败；改私有 wrapper 后，pool refs 输出成功但 **额外 enum 填充遇 unboxed bitmap 导致 exit1**；根据主线程止损不再改 parser。前段 Pool rows 可与原 index 单独交叉核对，仅用于两个 Rims closure 的部分元数据链接，**不作为完整 enum 解析/测试通过证据**。
- `verify_selected_mody.py` 只核 App hash、Info.plist、39选定原BIN范围/导出PC、24条原BL；**exit0**。不执行 App，不声称真机/服务器通过。

## 五、FORM 的产品价值（研究启示，不修改 V2.2）

可借鉴的机制是把“当前选择／恢复的历史选择／Custom 输入”写成可测试的显式来源优先，而不只保存拼好的一段文字；对 named/custom 颜色采用明确互斥状态；将灵感整体组合和针对轮毂/颜色的参考图编辑分开记录。Mody 提示连续编辑可以同时携带 item 的结构、参考图片、模板分支和恢复数据，而“最后的句子”本身不足以复现编辑。FORM 可据此补离线设计问题/验收约束，但没有能力、付费或冻结规格的变更授权，也没有证据要求模仿其客户端模型别名。
