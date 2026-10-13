# 给 FORM 负责人的决策报告

**本轮已经读到两款 App 的真实客户端生成逻辑；还没有证据证明任何一个 App 的实际生图质量更好。** Mody 更能解释客户端 Prompt 编排，Modyfy 更能解释选项 ID 交给服务端以及明确的图片缩放。真正决定效果的有效服务端 Prompt、基础模型、工作流和首次输出仍缺。[AOT05–AOT20、MFY02–MFY09、QUALITY_UNKNOWN_MODY、QUALITY_UNKNOWN_MODYFY]

## 各学三点

| Mody 值得学的点 | Modyfy 值得学的点 |
|---|---|
| Style / Extra / Color 分开表达，把意图聚合到生成前摘要；不能照搬所有部件能力。[UX05、UX11–UX14] | 普通汽车配具体改色/轮毂意象，使用途可理解；代入感仍是待测假设。[UX21] |
| 模板选择、颜色替换和保留相机角度规则可查，方便定位 Prompt 的贡献；不复制第三方私有文本。[AOT07–AOT09] | 图片输入有方向相关尺寸计算、JPEG90与 data URL 路径；FORM 应记录自己的实际变换，而不是抄参数。[MFY07–MFY09] |
| 建议写回草稿、Custom 与 Style 共用生成主干；FORM 保留“确认后才开工”，自由文字扩展需先修订冻结规格。[AOT05、AOT12、FORM23、FORM37] | 示例选图、Replace 和输入 recipe 恢复各有证据层级，适合启发首次探索与再次编辑；不照搬强制四步。[UX25、UX27、MFY06] |

## FORM 最需要改善的三件事

1. **P0：锁定改动与保留合同。** 使用现有受控 edit-plan / Prompt reference：当前 base、changes、preserve、能力与版本确定后才报价。解决 legacy style 的“低趴/前唇”与保护几何冲突，禁止名字或自由文本暗中影响 Prompt。F05/F08 上游，F14 确认界面、F29/F35 验收。[FORM21–FORM24、FORM37]
2. **P0：保护真实输入与输出原件。** F06 分开 input、master、display；F12 选图先本地，F07 上传与 AI 传输同意明确；记录方向、实际尺寸、编码及哈希。不能把缩略图送入下一轮或将 2400px 显示图称原生 4K。HEIC、iCloud 与相册权限留给 F19 真机验证。[FORM12–FORM15、FORM40]
3. **P0：让费用与任务可对账。** 一次确认对应一个冻结 quote / submission / task，用户次数与供应商费用分账；丢响应恢复同一任务，processing 不承诺免费取消，不自动换模型或重试。F09/F10/F11 上游，F14/F15/F27；高风险接线保持独立审核关口。[FORM18–FORM20、FORM25–FORM29、FORM41]

两项 P1：F13 做可信同车案例直达本地选图并提供原图单改入口；F16/F17 保留并完善现有同车版本、比较、收藏和导出。公开案例依赖授权与真实质量证据；不重新发明已存在的版本基础。五项完整验收见 [05](05_FORM_GAP_AND_PRIORITY_ZH.md) 与 [10](10_NEXT_ACTIONS_ZH.md)。

## 已核实的技术线索与产品风险

Mody 的 `createFinalPrompt`、模板读取、建议写回、上传、HTTP schema、RevenueCat 购买返回后生成均有静态调用链；3 条关键 BL 又经独立原字节解码。`flux2edit`、`pimageedit` 与本地工具请求确有引用，**只确认路由关联，不能确认 FLUX 或其他生产模型**。文字重写请求中的 `openai-chatgpt-5` 也只是一项客户端 selector。[AOT05–AOT22、INDEPENDENT_STATIC_01]

Modyfy 的 Hermes 业务可读。启动器的 critical / dependent 初始化错误会进入通用弹窗；已留存 Mac 日志不足以确定具体依赖。Mac 无法启动阻断新的运行观察，未阻断静态代码研究。再投入一次有限的合法真机观察有价值，反复修 Mac 或搜集更多 SDK 名称价值较低。[MFY01–MFY14]

不值得首版模仿：订阅/“免费试用”文案、付款后自动生成、长问卷、多娱乐/视频入口、品牌精确部件、未验证低趴/bodykit、隐藏重试或自动增强。Modyfy 录屏 Apple 面板为首周 $7.99、随后 $9.99/周，不是七天免费；两款录屏均没有可验收的成功生图或付款。[UX17、UX23、UX42、FORM37–FORM41]

**下一笔最有价值的研究投入：** 6 个有权使用的开发照片槽位，用同一已核实模型和输入管线，比较原创基础 Prompt 与只增加保留约束的 Prompt，共 12 个首次输出，盲评车型身份、目标执行与车灯/轮毂。它属于 252 计划内的子集，仍为 NOT_EXECUTED、预算 0，不能由本报告自动启动。[PLAN01–PLAN02；详见 07]
