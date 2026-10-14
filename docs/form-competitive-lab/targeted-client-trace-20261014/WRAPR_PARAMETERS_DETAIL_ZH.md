# Wrapr：同版本改装选项到请求的离线追踪

研究日期：2026-10-14。仅静态材料读取；未执行 App / Hermes、未访问服务端、未生成图、未购买。以下为本轮脱敏研究结论，原始 HASM、安装包和长配置均留在已有私有目录。

## 已闭合的结果

Wrapr 1.0.1 build6 / `com.eldaragayev.Wrapr` / HBC96 的本地配置已恢复：5 个 category、19 个参数组、92 个固定选项值；Paint 另有 12 个颜色名称。公开候选 CSV 只含 `category / parameter_key / option_value / order`，共 104 行。

`Paint` 在代码中的分类名与请求值为 `Custom Paint & Wraps`。`Body Kit`、`Wheels` 是 `parameters` 对象的键；不是该链中的独立 `modificationType`。例如选择 `Add Modifications` 内的 `Body Kit = Wide Body`，传输结构为 `modificationType = Add Modifications`、`parameters[Body Kit] = Wide Body`。同名 `Wheels` 在两个 category 中有不同选项，必须保留分类上下文。

所选类别共用 CreateCarScreen、LoadingScreen 和 `generateCarModification` 请求函数；已闭合至 `#9782` 的 JSON POST 构造。此结论证明客户端函数相同，不能推断服务端模型相同或不同。

所有证据类均为 `CLIENT_CODE_LINKED`。标签来源是同版本本地 UI 配置及 JSX 控件代码，没有本轮 `UI_OBSERVED` / `RUNTIME_OBSERVED` 或真实生图成功证据。

## 配置映射

| modificationType / category | parameters 键 | 同版本选项值（实际顺序） | 数组位置 → 键赋值位置 |
|---|---|---|---|
| Custom Paint & Wraps | Finish Type | Matte, Glossy, Metallic, Pearl, Chrome | #9767 `0x001b925e` L383547 → `0x001b9266` L383548 |
| Custom Paint & Wraps | Pattern | Solid, Racing Stripes, Flames, Carbon Fiber, Custom Graphics | #9767 `0x001b926b` L383549 → `0x001b9273` L383550 |
| Custom Paint & Wraps | Intensity | Subtle, Moderate, Bold, Extreme | #9767 `0x001b9278` L383551 → `0x001b9280` L383552 |
| Change Background | Theme | Sci-Fi, Fantasy, Horror, Nature, Urban, Apocalyptic, Cyberpunk, Retro | #9767 L383559 → L383560 |
| Change Background | Time of Day | Day, Night, Sunset, Dawn, Blue Hour | #9767 L383561 → L383562 |
| Change Background | Weather | Clear, Cloudy, Rainy, Stormy, Foggy | #9767 L383563 → L383564 |
| Change Background | Intensity | Subtle, Moderate, Dramatic, Extreme | #9767 L383565 → L383566 |
| Add Modifications | Body Kit | Sport, Aggressive, Wide Body, Street, Track | #9767 `0x001b930b` L383573 → `0x001b9313` L383574 |
| Add Modifications | Spoiler | Subtle Lip, Wing Spoiler, Duck Tail, Large Wing, No Spoiler | #9767 L383575 → L383576 |
| Add Modifications | Wheels | Stock, Aftermarket Alloy, Deep Dish, Carbon Fiber, Chrome | #9767 `0x001b9325` L383577 → `0x001b932d` L383578 |
| Add Modifications | Stance | Stock Height, Lowered, Slammed, Raised, Air Suspension | #9767 L383579 → L383580 |
| Clean & Detail | Scratch Removal | Light Scratches, Deep Scratches, All Scratches, None | #9767 L383587 → L383588 |
| Clean & Detail | Dent Repair | Small Dents, Large Dents, All Dents, None | #9767 L383589 → L383590 |
| Clean & Detail | Element Removal | License Plates, Stickers, Dirt/Grime, Background Objects | #9767 L383591 → L383592 |
| Clean & Detail | Enhancement | Brightness, Contrast, Saturation, Sharpness | #9767 L383593 → L383594 |
| Swap Components | Headlights | LED, HID, Halo, Angel Eyes, Stock | #9767 L383601 → L383602 |
| Swap Components | Grille | Honeycomb, Mesh, Chrome, Blacked Out, Stock | #9767 L383603 → L383604 |
| Swap Components | Wheels | Sporty, Luxury, Off-Road, Vintage, Modern | #9767 `0x001b93df` L383605 → `0x001b93e7` L383606 |
| Swap Components | Bumper | Aggressive, Sporty, Clean, Off-Road, Stock | #9767 L383607 → L383608 |
| Custom Paint & Wraps | Color | Red, Blue, Black, White, Green, Yellow, Purple, Orange, Pink, Teal, Indigo, Gray | #9700 L380888–L380910；#9703 L381096–L381098 发 `name` |

`safe_catalog_candidate.json` 保留每个数组、键赋值、分类赋值的精确 PC 与源行。上表 PC 为 HASM 头的 HBC 文件 offset 加函数内 instruction offset；不是 native VA / ASLR 地址。

## 逐边证据

1. 首页分类按钮传显示 title：`#8503` 建四个普通分类卡片（L344659/L344668/L344676/L344684），`#8506` 用其 env[11] map 到 `#8519`（`0x001a13be` L345148、`0x001a13c7` L345150）。`#8520` 的 `onPress` 取该卡片 `title`，传给 env[6] 的 `#8517`：`0x001a1ad5` L345747、`0x001a1adc` L345749。Paint 有单独按钮 `#8518`，`0x001a1740` L345521 固定传 `Custom Paint & Wraps`。普通卡片的 `id` 仅见 JSX key 使用，不是请求分类值。
2. `#8517` 把其参数1写进 `modificationType`，navigate `CreateCar`：`0x001a1724` L345504、`0x001a1729` L345505、`0x001a172d` L345506。`#7553` 路由登记将 `CreateCar` 绑定 `CreateCarScreen`（L305317–L305322），将 `LoadingScreen` 绑定同名组件（L305329–L305333）。屏幕出口 module878 / `#8496` 通过 getter 绑定 module936 与 module947（全局 L4540、getter `#8497` L344514、`#8501` L344566）。
3. `#9666` 读取 `route.params.modificationType` 到自身 env[1]（`0x001b5b60` L379068、L379069），从 `MODIFICATION_TYPES[type]` 取配置到 env[2]（`0x001b5b71` L379072、`0x001b5b77` L379073）。module936 的 dependency[7] 为 module945（全局 L4830），`#9663` 将其导入到 env[6]（L378829–L378832）；module945 即 `#9767`（L4873–L4876）。
4. `#9666` map 配置的 `parameters`（`0x001b63ad` L379548、`0x001b63b8` L379550）到 `#9693`。后者把参数名存在新 env[0]（`0x001b6e00` L380520），map `config.options[parameterName]`（`0x001b6fac` L380619、`0x001b6fc0` L380625）到 `#9694`。
5. `#9694` 每个 option 成为 TouchableOpacity；option 字符串同时作 Text children（L380699）与 closure env[0]（L380657）。选中样式使用 `selectedParams[paramName] === option`（`0x001b705d` L380672、`0x001b7061` L380673）。`#9695` onPress 从环境取参数名与 option，调用 env[12] 的 `#9681`（`0x001b7151` L380738）。
6. `#9681` 参数1/2保存为 `paramName/value`（L380091–L380094），调用 React 参数状态 setter env[8]，传 updater `#9682`（`0x001b69d1` L380098、`0x001b69d6` L380099）。`#9682` 对原对象用 builtin44 `copyDataProperties`，再 `PutOwnByVal(newObject, value, paramName)`（`0x001b69e5` L380113、`0x001b69f4` L380117）。不同 key 保留，同一 key 后一次覆盖前一次；该字段并非数组多选。
7. Paint Color 独立状态：`#9666` 向 ColorPicker 传 selectedColor=r19、onColorSelect=r27（L379526–L379529），二者源自 useState 第二次字符串状态（L379126–L379133）及自身 env[9]。`#9701` map 本地色表到 `#9702`（L380986–L380989）。`#9703` 按下色块取色表项 `name`（`0x001b767b` L381096），调用 `onColorSelect(name)`（`0x001b7682` L381098）。色表的 hex 是色块显示数据，此调用送出的值为名称。
8. `#9685` 拷贝参数状态 env[7]，配置启用 color picker 时 append `Color = env[9]`（`0x001b6bb3` L380260、`0x001b6bcd` L380267）。CustomDescription 非空/真值时 append `CustomDescription = env[10]`（`0x001b6be6` L380274、`0x001b6bef` L380277）；UI 的 `onChangeText` 为独立 React setter，maxLength prop=250（L379634–L379640），不复制任何用户文字或私有 placeholder。
9. `#9685` navigate `LoadingScreen`：type 来自自身 env[1]，合成参数为 r6，`originalImage` 来自 env[6]（`0x001b6c11` L380286、`0x001b6c16` L380287、`0x001b6c1f` L380289、`0x001b6c28` L380291）。`#9794` 读取上述 route.params，并保存 type/parameters/originalImage 到自身 env[1]/[2]/[3]（L384809–L384814）。useEffect → `#9795` → `#9796` → `#9797` → generator `#9798` 的环境层次已逐层核对（L384927、L385192–L385195、L385212–L385215、L385226）。
10. `#9798` 从 LoadingScreen env[3]/[1]/[2] 取三实参（image/type/parameters），调用 `generateCarModification`（`0x001ba884` L385310、`0x001ba896` L385314）。其 module947 dependency[7] 是 module946（全局 L4885，导入 env[8] 在 `0x001b9e9a` L384626）；module946 / `#9768` 导出 `#9779`（`0x001b9498` L383656、`0x001b949d` L383657）。
11. `#9779` apply module946 env[15] 的 `#9780`；`#9780` 产生 generator closure `#9781` → `#9782`（L384089/L384094、L384111–L384118、L384129）。`#9782` 参数1经过 `prepareImageForUpload`（module env[13]：L383632–L383633；调用 `0x001b98fb` L384171），恢复的值进入 `image`；参数2/3直接进入 `modificationType/parameters`（`0x001b990f` L384177、`0x001b9914` L384178、`0x001b9919` L384179）。
12. `#9782` 对对象追加 `quality`（`0x001b991e` L384180）、新 requestId（`0x001b997d` L384200），JSON.stringify（`0x001b99ed` L384226）成为 POST body（L384217–L384227），fetch 调用于 `0x001b9a02` L384230。内部 endpoint 的值不交付。

## 默认值与选择规则

- CreateCarScreen 初始化 image、Color、CustomDescription 为空字符串，参数状态为空对象 `{}`，加载状态 false；参数默认值没有从配置首项自动赋入。证据：`#9666` L379103–L379152；env[6]/[7]/[9]/[10] 的来源、setter 与使用边均已核对。
- 每个 parameter key 为单字符串，重复点同一选项再次赋该值，切换为另一选项覆盖同一 key；不同参数键共存。证据：`#9694` 的严格相等显示分支、`#9695`、`#9681/#9682`。客户端此 handler 没有跨字段互斥判断；服务端兼容性未知。
- 此屏要求图片和配置的每个 parameter key 有真值，Paint 另要求 Color；并非只选 Body Kit 就提交。`#9679/#9680` 逐键计完成度（L380022–L380047、L380071–L380078），按钮 disabled 取完成度结果（L379174–L379178、L379663–L379664），`#9685/#9690` 还逐键过滤未填值（L380232–L380240、L380471–L380476）。CustomDescription 不计必选参数。
- **quality=high 仅在已追到的 LoadingScreen 三实参调用路径成立。** `#9798` L385314 没传第四个 quality；`#9782` L384158–L384168 在第四实参缺失/undefined 时赋 `high`。不能外推其他调用者、服务端分辨率、收费或增强行为。

## 输入来源与实际验证

- 安装包：`WRAPR_INFO` 确认 1.0.1/build6/bundle ID；SHA256 `57965b9526682d09f38fff947da7a0714d6e9afaf34766f69448ca2fae3dc544`。
- HBC：同目录 `main.jsbundle`，2,870,393 B，SHA256 `20b19c5ca6e0969e35ec79e4d699e7748cb6782f331925d7e1798793c67e5bbb`，HBC96、9,902 function headers；已有 parser 验证内置 footer SHA1。
- 既有导出：`WRAPR_HASM`，24,177,678 B，SHA256 `fce8dafd39715a97b5180573760b69898f675075caf9ae32b5e6cc91daac8917`。
- 既有来源记录：同目录 `candidates.private.json`，SHA256 `c6883f5f9a1bc98d685a93b03225f5342fbd0570cdcfef30b63edc7f702ed028`；Wrapr 条目同版本/同路径/HBC96。既有 `hermes.exit` 为0。该历史清单本身未保存 HBC SHA256，因此另作当前原字节与旧导出的定点一致性验证，未伪称历史 hash 已有。
- PR8 `offline_hermes_slicer.py --profile wrapr` 实跑 exit0，命中 #9782@0x001b98a3；报告 `initial_slice.private.json`。它是索引，数据流结论由上面人工寄存器/闭包审阅得出。
- `verify_saved_export.py` 实跑 exit0：初次43个函数、扩展至导航 getter 后47个完整函数，另定点核对 `#0` 中相关 module 声明段；HASM header、所选范围每条指令、字符串及 serialized-buffer 注释与当前 HBC 格式读取精确相等。没有重新输出完整反汇编，也没有执行字节码。当前47函数＋相关全局声明段校验留在 `saved_export_binding.private.json`；这是静态来源绑定，不能算实际 UI、网络、模型或付款测试。
- `build_safe_tables.py` 实跑 exit0：5分类、19参数组、92预设值、12色名、104 CSV行。不是合成生成结果。

## UNKNOWN 与 FORM 的实际价值

服务器怎样解释字符串分类/parameters、是否转换为提示词、用哪个模型或 workflow、有没有额外预处理/保护约束/类别优先级、如何解释 high、哪些组合接受或拒绝、真实输出质量与局部保真、真实付费或 free 状态：均 UNKNOWN。

对 FORM 可直接用于后续评审的是：参数必须附带 capability/category 上下文；同一个 Wheels label 下的选择集合不能混为一张全局表。静态控件→选择状态→请求对象应有可复核字段与保存记录。Wrapr 的本地必选组设计也提示，在 FORM 的单项编辑评审中要明确“保留现状”与“必须重新选择”的区别。以上是研究输入，不修改 V2.2 规格，不证明 FORM 已支持 Body Kit、Stance、视角或精确零件编辑；能力上线仍需独立质量证据与另外的授权。
