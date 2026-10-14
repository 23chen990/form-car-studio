# FORM｜V1.0 Style＋Extra＋Color 产品目录候选与 Prompt 设计前置决策

状态：**PRODUCT CATALOG PROPOSAL / NOT APPROVED / NOT LIVE**；2026-10-14。
本文件是 Owner 讨论候选目录，不改 S01/S02/S05、PR #3、Provider Profile、钱包、计费、真实模型调用。**菜单是否上架与 AI 能否做到是两项不同审批**。本研究假设仍是首发 1 Style＋0/1 Extra＋1 Color，一次冻结报价、一次确认、一次生图。Custom 自由文字暂缓。

## 一、先定术语

- **Style**：整体改装审美与设计方向（不是纯色滤镜，不能成为没有任何可见变化的空收费项）。Style 可以推荐 1 Extra＋1 Color 的**显式可见预填方案**，但不能暗中添加未选套件或偷偷覆写用户选择。
- **Extra**：这次明确允许改动的一个附加部件或一组经过清晰界定的套件；即「改变哪里、改变成什么」。首发用户最多选一项，先解决保真与组合复杂度。
- **Color**：**车身外部漆面**的颜色（以及在已通过质量/能力审批后可选的表面质感），不是车窗、车灯、轮胎或轮毂颜色。轮毂颜色是另一个 Quick Mods 字段；不要将 Body Color 误解为 All-Car Color。
- **No Extra** 和 **Keep Original Paint** 均有明确语义；Style 自身若没有经过验证的独立变化，同时选择 No Extra＋Keep 应拒绝无效收费，而非生成相似图片。
- **已发布目录**和**草案目录**分开：候选项可以多，用户付费看到的项目只能是已获得真实授权照片/模型结果证据且通过兼容性审核的子集。

## 二、Style：建议先建 7 个候选（非 7 个已获质量许可的商品）

| styleId | UI 英文名 | 中文含义 / 设计意图 | 推荐的显式 Extra＋Color | 必须防止 |
|---|---|---|---|---|
| `clean_oem_plus` | OEM+ Clean | 原厂升级感：克制、边缘精致、保留车型特色；适用面广 | Sport Wheels＋Metallic Silver | 偷偷换车型/品牌/灯具 |
| `jdm_street` | JDM Street | 日系街头改装审美：低调运动化、干净而有张力 | Subtle Widebody＋Midnight Blue | 把非日本车型变成日本车型；无授权贴标 |
| `euro_performance` | Euro Performance | 欧系性能车审美：整体紧凑、低调但犀利 | Mild Lowering＋Graphite Gray | 在原车上硬套某品牌 RS/M/AMG 实物配件 |
| `track_inspired` | Track Inspired | 赛道视觉：清晰的空气动力外观、有速度感，非真实赛车工程 | Front Splitter＋Racing Red | 未选择时擅自加巨大尾翼/赛道背景 |
| `american_muscle` | Muscle Street | 美式肌肉车改装审美：强壮、简洁、强调姿态 | Sport Aero Kit＋Gloss Black | 将轿车改成 Dodge/Mustang 等另一车型 |
| `vip_luxury` | VIP Luxury | 高级定制、细节精致、可选深色奢华或浅色清爽 | Ducktail Spoiler＋Pearl White | 强制变成黑色/强制过度低趴 |
| `offroad_adventure` | Off-Road Adventure | SUV/皮卡越野视觉：强韧、实用取向的外观概念 | Mild Lift＋Forest Green | 把普通轿车变皮卡；任意改变车身/轮距 |

Style 是用户能看懂的「审美方向」，每张卡片实际展示的可售卖案例必须有授权、同车 before/after 及明确绑定的 recipe。**推荐组合自动预填不是强制套用**，Color 明确以用户最后选择的字段覆盖推荐颜色；Extra 以用户最终选择为准。

`offroad_adventure` 需要车型适用性控制；不要求新用户填 VIN 或猜车型年份。不可靠的车类/角度判断不能冒充确定识别。前台若无法可靠判断，应该明确选择要求或先不发布该卡。

## 三、Extra：建议 8 个主类＋None；具体可收费 ID 须选择明确变体

| 类别/主展示名 | 建议 extraId（最初候选） | 唯一允许的主要变化 | 对原车必须保持 | 风险/备注 |
|---|---|---|---|---|
| None | `none` / API `extraId:null` | 不新增任何实体改件 | 所有现有部件 | 不是收费的独立效果 |
| Widebody | `widebody_subtle` | 加宽可见前后轮眉、翼子板外轮廓 | 车门、车窗、车轴关系、品牌/车型身份 | **高视觉冲击＋高失真风险**，优先质量实验 |
| Sport Aero Kit | `aero_kit_sport` | 协调的前后下包围/侧裙套件，**不默认加宽轮拱** | 原车灯、车门、车窗、轮距、未选尾翼 | 与 Widebody 定义必须区别；组合比较贵/难 |
| Rear Spoiler | `spoiler_ducktail` | 一只克制鸭尾/小尾翼 | 原有后灯、行李箱形状、全车其他部件 | 从后/后45度可见效果最好；巨型 Wing 延后 |
| Sport Wheels | `wheels_multi_spoke` | 可见轮辐更换为通用多辐运动样式 | 轮心位置、胎外径、胎壁、车身姿态 | 具体品牌/尺寸/offset/适配性不保证；Quick Mods 可复用轮毂逻辑 |
| Stance / Ride Height | `stance_mild_lower` / `stance_mild_lift` | 相对地面的温和降低/升高姿态 | 车型身份、轴距、摄影视角、车轮数 | 几何与阴影易失真；升高只对适合车型 |
| Front Splitter | `front_splitter_subtle` | 可见前保险杠下方增加小前铲 | 后包围、未选尾翼、车灯、车牌 | 正面/前45度效果最好 |
| Carbon Accents | `carbon_accents_subtle` | 少量确定位置的类碳纤维外观饰件（需明确面积/位置） | 车身原漆主色、形状、未选区域 | 黑车可能对比度不足；不冒充真实材料 |
| Racing Stripes | `racing_stripes_clean` | 跟随车身曲率的小范围条纹/车贴 | 底色与部件结构、车灯和车牌 | 条纹颜色需与用户 Color 对比，不能产生假品牌 Logo |

**Body Kit ≠ Widebody ≠ Front Splitter**：Body Kit 是一组前后包围/侧裙外观件；Widebody 的重点是轮拱、翼子板外扩；Front Splitter 只改变前下方一个部件。不能用同一个“sportier car”Prompt 卖三个不同名称。

上表分为 8 类；`Stance` 的低趴/抬高是互斥变体。初始仅 1 Extra 组合，扩展为 2 个并发 Extra 需要另行验证能力及兼容性，不应因为竞争者可多选就直接开放。

## 四、Color：建议 10 个含 Keep 的精选候选

| colorId | UI 名称 | 对应视觉语义与当前合同风险 |
|---|---|---|
| `keep_original` | Keep Original | 完全保留选中底图原来的车身漆面；不假设已知道原车颜色 |
| `gloss_black` | Gloss Black | 标准黑色亮光 |
| `matte_black` | Matte Black | 黑色哑光；**当前 bodyFinish 仍是能力受限字段** |
| `pearl_white` | Pearl White | 带珍珠感白漆；当前 finish 枚举**尚无 pearl** |
| `metallic_silver` | Metallic Silver | 金属银；现有 finish 未单独支持 metallic |
| `graphite_gray` | Graphite Gray | 深石墨灰，默认普通汽车亮光质感 |
| `racing_red` | Racing Red | 饱和而真实的赛车红 |
| `midnight_blue` | Midnight Blue | 深蓝，保留自然反光 |
| `forest_green` | Forest Green | 深绿，适配复古/英伦/户外等风格 |
| `midnight_purple` | Midnight Purple | 深紫；**当前 V2 color enum 尚无 purple** |

Color Stage **始终要显示色块＋名字＋ Keep**，但首发具体可显示的 finish 仅限已通过 Provider Profile/质量测试的状态。更自由的 RGB/HEX Picker、双色、Wrap 图案属于独立能力扩展，不是此次偷偷塞进去的“Color”。Color 选择最终覆盖 Style 的默认**车漆**，不覆盖轮毂（若要轮毂配色，走已支持的轮毂独立字段）。

## 五、推荐组合，避免新用户对空白选项发呆

- `jdm_street + widebody_subtle + matte_black`：视觉冲击最大的**待验证**代表组合。
- `clean_oem_plus + wheels_multi_spoke + metallic_silver`：强调自己的原车身份，适合克制车主。
- `track_inspired + front_splitter_subtle + racing_red`：赛道视觉的细节变更。
- `euro_performance + stance_mild_lower + graphite_gray`：姿态和外观统一，但模型几何风险大。
- `offroad_adventure + stance_mild_lift + forest_green`：仅在适合车类、足够质量证据支持时发布。

所有推荐都应是**确定三个 ID、可编辑的预填 recipe**；用户点 Discover 案例或 Style 卡时带入 Studio，产生 0 次模型费用。未验证真实效果前，不能把合成氛围图当作效果证据。

## 六、硬兼容和能力规则（先定这部分，Prompt 才写得正确）

1. 来源：`source.kind=original` 或明确已授权 `source.kind=version,versionId`；不自动使用 latest 版本；版本 ID 的语法校验不等于拥有者校验。
2. Style 唯一选择、Extra 可为 null（正式 build 请求以 null 表示 None）、Color 唯一选择。拒绝用户直接传任意 Prompt、模板版本、模型名、供应商或价格。
3. **Color 优先**：例如 Style 的推荐 Silver＋用户最终 Matte Black，实际只含 Matte Black，不能同时含两种不同车身颜色。
4. **只允许实际选定的几何修改**：Widebody 允许轮拱/翼子板形状变化，不要附带“所有车身轮廓不得变化”；Ducktail 允许后翼增加，不要附带“禁止任何 Spoiler”。
5. **镜头/部件可见性**：后视才更适合 Ducktail，正/前45度才适合前唇；在未建立可靠观测前应提示用户选择适合照片，而非把“不可见也自动加”当作正常付费生成。
6. **不兼容先拒绝**：Offroad 风格＋lowered stance、VIP 奢华＋后续巨大赛道翼等需要目录白名单/人工审核，而非把冲突交给图像模型。
7. **照片身份保护**：原车车门数、玻璃/车灯/标志、摄影视角、背景应尽量保持，除非选择的可变化区域明确允许相应像素变化。
8. **一次费用＝一个冻结结果任务**：保存目录版本、选项 ID、模板版本、Provider Profile、源图资产和 outputCount=1；换价/换能力需要新 quote。同一个 submissionId 不得重复收费。草稿修改/浏览案例不收费。
9. **历史数据兼容**：原 V2 `explore/detail` 和历史版本的原意不被重写。建议新增受审的 `build` 合同（例如 schemaVersion=3）或等价新 endpoint，而不是把旧 `explore` 隐式改义。
10. **公开目录与内部审计分开**：App 仅拿已发布的 ID、文案、顺序、缩略图（授权）、兼容能力与变体；服务器私有 Prompt 与模型配置不下发。

## 七、首批测试 vs 正式菜单

这是一个**候选池**，不是声称能稳定生成 7 × 9 × 10 种效果，也不是“630个可卖组合”。推荐用小额审批实验验证高价值的3条完整配方，再扩展风格/车型/光线/角度。三张授权图片×三套配方＝**9次试探性调用计划，尚未授权**；9 次只证明是否值得继续测试，**不能保证全部组合、更不能证明可量产**。

用户真正看得到的正式可购买目录应是：经真实生成及质量验证的 **少量高辨识度 Style、少量可靠 Extra、已验证颜色／质感的精选组合**。没有任何可信结果时即使目录结构完整也保持收费能力关闭。

## 八、选项定稿后，才进入 Prompt 和发布配置

依次冻结：
1. 产品级分类与名称（本候选文档）；
2. 每项变更部位/保护部位、来源角度、与其他项兼容矩阵；
3. 三类受控 Prompt 模块（Style 气质、Extra 允许的物理变化、Color 最终漆面要求）＋共享身份/场景保护；
4. Provider capability 和真实图像质量门槛；
5. 最终面向用户的案例与目录 publishing、服务端版本管理、旧任务快照兼容。

**此时尚不改正式生图 Prompt。** 模块化确定性编译为首发优选，不默认额外 LLM。参考同目录 `style-extra-color-lab` 研究实现与 `sec-backend-mvp-20261014` 31 项兼容测试，避免 Codex 重写已完成研究代码。

## 九、需要 Owner 真正拍板的四个问题

1. 这 7 个 Style 是否过多？是否将 `vip_luxury` / `euro_performance` 合并，让首页只露出 5 个被证明有价值的 Style？
2. 第一批 **最优先验证**的 Extra 是否定为 Widebody、Wheels、Spoiler（高兴趣但风险高），Front Splitter 作为更容易控制的备选？
3. Color 是否确认「车身颜色／可选漆面」而非「整个车连轮毂一块变色」？是否把 Matte/Metallic/Pearl 先视作候选，等真实结果再上架？
4. 继续保持 **最多一个 Extra**，通过从精确版本再编辑来探索更多改件，还是为将来最多 2 个 Extra 预留兼容协议（但首发不开放未测多选）？

在 Owner 明确审批并指定真实模型/照片/预算前，这一稿仅记录讨论候选，不代表所有效果已支持。
