# 生图质量来源专项：恢复了什么，仍缺什么

**知道的真实客户端 Prompt 逻辑已经明显超过字符串搜索；知道的实际生产生图模型仍为零个已验证模型。** Mody 可以追到模板集合、类型选择、颜色替换、构图约束及可选文字重写；Modyfy 标准汽车改装主要提交选项 ID，完整 Prompt 仍在服务端。两者没有授权输入→首次输出的效果证据，不做质量排名。[AOT05–AOT21、MFY02–MFY09、QUALITY_UNKNOWN_MODY、QUALITY_UNKNOWN_MODYFY]

## 1. 我们知道了多少真实 Prompt

| 范围 | 已知 | 未知 / 不能承诺 | 级别与证据 |
|---|---|---|---|
| Mody模板来源 | Firestore `generatePrompts` collection→GeneratePromptModel(type,prompt)→VM列表→按type取模板 | 当前远程文档、全部预设正文、历史版本、服务端再改写 | CODE_LINKED，AOT06–AOT08 |
| Mody结构化拼装 | 颜色占位替换、colorToString、列表join；附加相机角度保持文本；Style/Custom共享createFinalPrompt入口 | 所有style/extra顺序、覆盖/默认与冲突策略未完整恢复 | CODE_LINKED，AOT05、AOT09 |
| Mody自由描述 | Custom状态、trim、可选remote flag、GptService文字重写、返回text与错误fallback分支 | 当前flag是否开启、有效server重写文本及实际输出 | CODE_LINKED，AOT10–AOT11 |
| Mody私有system文本 | 客户端832字符字面量存在并进入system_prompt；只报告汽车意图/语言形式与schema | 不复制原文；不能把文字重写system Prompt当最终image Prompt或完整身份保护方案 | CODE_LINKED，AOT10 |
| Mody建议 | 点击建议→set controller text→notify | 建议的生成来源/准确率，不是直接开工 | CODE_LINKED，AOT12 |
| Mody Detail | 目标/多section Prompt、类型模板与颜色替换、remote tire流程分支 | 精确部件template、局部像素锁定、活跃workflow和route完整映射 | CODE_LINKED＋Unknown，AOT20 |
| Modyfy CarStyle / CarMod | imageData、itemIds、collection；Style ID / Extra ID / Color ID的组合可查 | 完整英语Prompt、保留约束、服务端模型适配/模板改写 | CODE_LINKED schema，MFY02–MFY04 |
| Modyfy其他prompt字段 | AI工具再次编辑分支读取prompt；泛模型/诊断元数据存在 | 不能混入CarStyle Prompt Builder；SDK内通用模型术语不证明汽车生图调用 | CODE_LINKED但用途有限，MFY06 |

“恢复多少”按范围回答，无法给可信百分比：没有完整源或远程模板分母。可确认 Mody 的客户端编排规则、一个文字重写请求结构及一条构图约束；不能说拿到所有私有Prompt。Modyfy可确认输入ID合同，未恢复标准汽车改装最终文本。完整模板、服务端路由配置和有效请求仍是质量研究缺口。

## 2. 我们知道了多少真实模型信息

| 名称 / 字段 | 真正看到什么 | 为什么不认定为实际生图模型 |
|---|---|---|
| `openai-chatgpt-5` | Mody **文字重写**POST里的selector；temperature0、max_output_tokens100、request version0.0.1 | 无上游回执；selector可由服务端映射；request version不是基础模型版本；用途不是image generation。[AOT11] |
| `flux2edit` | ToolBox Flux和custom-color函数内实际route引用；prompt/imageUrls/imageSize | 路由可以换模型/组合流程，未见checkpoint、provider执行或生成回执。[AOT16、AOT21] |
| `pimageedit` | PImage工具及颜色请求分支；prompt/imageUrls/aspectRatio | PImage不是可验证模型规范名；不能猜供应商。[AOT17] |
| `workFlowId` | Workflow请求字段及轮胎remote getter | workflow graph、节点/参数/活跃ID未知；不能推断ControlNet/分割/LoRA。[AOT18、AOT20] |
| `topazupscale` | 独立工具imageUrl请求，与Topaz命名函数相连 | 供应商、倍率/真实超分效果未知；无每次生成必经此工具证据。[AOT19] |
| `chatapi` / `customcolor` | 各自聊天/颜色函数中有引用，作用域不同 | 聊天路由不能自动归到GptService或汽车生图；别名不能替代真实模型证据。[AOT26–AOT27] |
| Modyfy `aiModelId/aiModelType/aiSubModelType` | pending项和result.inputs/再次编辑有这些泛字段 | 未解析成基础模型/vendor/version；可能是产品分类，字段名本身不够。[MFY02、MFY06] |
| Firebase / RevenueCat / Adapty / Sentry等 | 承载模板、请求/存储、权益或诊断的客户端组件 | SDK存在或诊断框架的模型术语不证明生产图像模型。[ASSET20–ASSET42] |

目前可以核实的是**客户端route引用、请求字段与文字selector**；没有任何一个基础生图模型达到“实际生产执行已验证”，没有量化模型贡献或云端fallback证据。两者都停在选定客户端静态级，不得因此宣称“竞品采用FLUX.2/GPT image/Topaz全自动链”。[QUALITY_UNKNOWN_MODY、QUALITY_UNKNOWN_MODYFY]

## 3. 五个质量来源的证据强度

强度评价针对所列实现证据，不是效果分数；“未发现”始终限于本轮选定代码，不是证明服务端不存在。

| 因素 | Mody AI | Modyfy | 对真实效果的验证 |
|---|---|---|---|
| Prompt编排 | **较强CODE_LINKED**：type模板、颜色替换/join、相机约束、可选文字重写；远程正文未知 | **中等CODE_LINKED**：style/extra/color ID与collection组合；服务端Prompt未知 | 两者都无有效server Prompt/输出，贡献Unknown |
| 输入图处理 | **较强CODE_LINKED**：下载/缓存、aspect、压缩、Storage上传；1920/1080/35参数及格式分支 | **较强CODE_LINKED**：方向相关resize、JPEG90、尺寸不足fallback、dataURL；Android另有RNFS分支 | 没有实际上传文件、EXIF/色彩/设备codec或结构细节对照 |
| 模型/工作流 | **中等客户端路由证据，实际模型弱/Unknown**：多工具schema/remote workflow | **中等服务端分类合同，实际模型Unknown**：Callable＋选项ID、泛model字段 | 无生产checkpoint/version、workflow graph或provider回执 |
| 局部编辑 | **中等意图证据**：Detail/颜色/轮胎分支、多URL；没有可靠mask/强度 | **中等类别/recipe证据**：CarMod及再次编辑；没有所查路径可靠mask/强度 | 没有像素锁定、关键结构保存率或目标改动成功率 |
| 后处理 | **有限CODE_LINKED**：独立Topaz命名工具；自动必经处理未知 | **有限**：返回URL、状态、余额和显示；自动超分/修复未确认 | 无前/后master、重试救图或分辨率/清晰度效果证据 |

特别避免两种误判：Mody quality35与Modyfy JPEG90是不同编码路径的参数，不能推导谁图更好；相机角度文字约束、多参考URL和局部菜单不保证原车身份、轮心、胎体、车灯或背景不变。[AOT09、AOT14–AOT20、MFY07–MFY09]

## 4. Style Builder / Custom Edit / Detail Edit到底是否不同

Style与Custom共用MainVM.createFinalPrompt→generateAdvancedStyle主干。Custom有自由描述与remote-controlled文字重写；结构化路径用type模板/颜色等组合。Detail有清理草稿、目标模板、多section与轮胎流程remote选择，属于不同客户端业务分支。[AOT05、AOT09–AOT13、AOT20]

因此“完全只是三个UI入口”不符合所见分支；“各有不同模型”也不成立。可确认**Prompt入口/参数组织有差异，Detail有工具工作流选择载体**。准确的UI→request逐分支映射、活跃remote config、当前生产模型均Unknown。不能把Flux/PImage函数名各分配给Style或Custom，更不能把视频仅有双页签的画面补成三tab。[UX46、QUALITY_UNKNOWN_MODY]

Modyfy不能按Mody三个模式硬套。它有全车Style的ID组合、CarMods部件分类、Effects及其他工具复用入口；CarStyle/CarMod共享主要Callable payload字段。模型是否按collection或会员改变不可确认。[UX28–UX32、MFY03–MFY06、MFY10]

## 5. FORM可以独立实现和验证什么

以下都由FORM合同与通用工程原则原创实现，不移植竞品代码、资产或Prompt。当前V2参考模块存在但未接线；本报告没有实施。

| 原创改进 | 可独立验证的事实 | 还需要真实效果实验 |
|---|---|---|
| 单一确定性Prompt Compiler | 从server plan编译：目标字段、保护字段、当前base、profile/template版本；detail不注入整车style；rename不影响语义；同字段冲突被拒 | 更严谨Prompt是否真的保车灯/轮毂/车型，要有同配置A/B首图 |
| 有条件保护关键结构 | wheelDesign未改时保spokes；被允许改spokes时只保护轮心/外圈视觉尺度、胎体、轴与stance；不发相互矛盾指令 | 文字保护不是mask或几何保证，真实profile与首图门仍必需 |
| input / master / display分开 | orientation、actual dimensions、format、digest、normalizer version；master不因UI预算缩小，下一编辑用正确base master | 编码/尺寸对局部细节的损失须对照，不照搬35或90 |
| 能力与参数合同 | unknown field/strength/mask/negative/任意URL报价前拒绝；只有已核实profile和质量能力可以开放 | 是否支持真实局部编辑、wheel/finish必须合法provider证据与效果 |
| 可审计首次输出与版本链 | 不覆盖input/output；每task≤1初始attempt、无隐式fallback；失败/uncertain/补偿与supplier exposure分账 | 首图满意度、累积编辑漂移与真人愿保留需要独立评审 |

来源：FORM23–FORM29、FORM37–FORM41。详细方案见 [06](06_ORIGINAL_ARCHITECTURE_ZH.md)。原车身份不能靠“识车”标签或requested recipe自证；observed recipe需可信观察，没有证据保留unknown。免费文本、任意参考图/部件/低趴/品牌fitment不在当前冻结首版，不能借研究默默开放。

原创保护规则可先用受控计划表达：`base=current_selected_master; changes=allowed_fields_only; preserve=all_other_visible_vehicle_and_scene_fields; geometry=locked; output_count=1`。这只是FORM语义设计示意，具体provider文本由既有builder在字段/能力校验后生成；没有假装能锁住像素或恢复不可见徽标。

## 6. 下一步最值得做的一个实验

**固定模型/图片管线/参数，只比较原创Prompt保留约束的12首图A/B。** 从18开发槽位里预先选6张权利明确、无重复/holdout重叠的图，任务统一为受控改色。A使用当前合法基础Prompt，B仅加入由plan明确的身份/构图/非目标结构保留规则；不增加文字改写模型、mask、强度、超分或隐藏重试。[PLAN02]

以随机代号让两名独立评审看original＋首次raw master；分别评分车型身份、改色执行、背景/视角、轮心/胎体/车灯与愿保留。失败、拒绝、timeout、无输出都保留在交付分母，纠正重试另记；若出现身份关键错误先停止该能力，不用最好图掩盖。小样本只能支持方向判断，不能发布准确率或全车型承诺。

这12次属于162开发对照的子集，不另加到252总数；其余开发配置与顺序任务在预注册后执行。**NOT_EXECUTED：当前0照片入组、0模型请求、预算0。** 所需单独授权是照片用途/存储、真实供应商和精确配置、可辩护单次费用上界、总预算及真人研究同意。无需再安装分析工具。[PLAN01–PLAN03；登记与门槛见07]
