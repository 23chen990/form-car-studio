# V2.1 深色工作室 → 冻结 S05：先修三个会导致返工的体验分歧

**REVIEW REQUIRED；不是现行 UI 规格。** 用户认可的 V2.1 汽车视觉方向可以保留，但交互与当前 V2.2 生成合同存在以下必须修正的地方。

## A. 首页灵感卡不能直接冒充 V2 styleId

概念演示里 `street` 等属于**内部编辑案例**，不是已获批准的 FORM 生成 preset。合法 style ID 的原始集合在 `shared/v2/edit-plan.ts`：`clean`, `sport`, `dark`, `heritage`, `track`, `rally`, `touring`, `color`；即使合法也不自动表示本次**已批准可公开生成**。

建议两类卡片：

1. **编辑灵感示例**：若无生产素材许可/已验证结果，明确标 `Example - not your car` / `Demo color study`，可浏览收藏灵感；不展示可付费生成承诺。
2. **已发布的可试用实例**：必须带稳定的真实已批准 style ID / catalog version、权利与模型能力记录；`Try this look on my car` → 选照片 → 确认 immutable server quote。不能从概念卡显示名直接构造未知 styleId。

## B. 一次“整体 Style + 自选漆色”在首发合同中不允许

`shared/v2/edit-plan.ts` 允许 `operation='explore'` + `styleId` + original；但 `server/v2/plans.ts` 当前 `resolveCurrentRecipe` 在 215–216 行**拒绝任何 Explore edits**，错误码 `EXPLORE_OVERRIDES_UNSUPPORTED`。并且 S01 写明 V1 UI 不暴露生成前专家覆盖。

所以 V2.1 虽然将 Style / Paint / Wheels 放在同一工作区菜单里，首发真正提交时必须清楚区分：

- **整体造型探索**：`{schemaVersion:2,source:{kind:'original'},operation:'explore',styleId:'<approved native style>',edits:{}}`，没有前置 paint override。
- **改一个已支持细节（原图或选定旧版）**：`{schemaVersion:2,source:{kind:'original' OR 'version',versionId?},operation:'detail',edits:{bodyColor:{action:'set',value:'red'}}}`，**没有 styleId**。可供交互选择的字段只有 `bodyColor/wheelColor`（还要经过真实 Provider capability）。
- **生成后继续**：以明确 versionId 进入 detail；“从原图试另一套”回到 original explore。这两条不得根据最近版本隐式切换。

**视觉不必拆回一堆表单**：可以保留汽车主视觉与底部抽屉，但确认时只显示这次*真实可提交*的合法编辑要求；一旦在整体造型路径中点击 Paint/Wheels，按经过审批的产品方案明确提示“这属于单项编辑，将切换创作模式”，不能悄悄组合到 Explore 请求中。未来如果要支持 Style + Expert Override，须独立服务端能力/成本评估及受审 S01 修订。

## C. 概念收藏 vs 真正车库必须分开

V2.1 离线原型的 My Ideas 保存的是**风格灵感**，不是真正的用户生成结果。真正 F17 车库要求持久化的 project/versions/cover/favorite、owner-scoped 资产与历史 parent 分支，不能以本地 `Set` 收藏概念替代。

建议：发现页可提供“保存灵感”，但标签不能叫“Saved to your garage”；生成结果经过后端成功持久化后才能显示“Saved to your garage”，收藏与保存到相册是另外两个操作。

## D. 产品视觉验收（待单独 S05 UI RFC）

- 保留深色汽车为主视觉，44px 可用点击区，含 320/375/390/430 宽度与 200% 文本检查。
- 工作区用户照片不随非生成选择即时改变。抽屉 `Cancel`/ESC 与 `Apply` 状态分离；放弃草稿本地操作不等于删车库历史。
- 结果展示包含完整车轮/车头、可比较的实际原图与对应版本；任意 V1 refinement 一定使用 V1 明确资产而非最新 V3。
- 首次无授权素材、Provider 能力或当前 catalog 时，所有不合规可付费入口关闭；不能用概念图片冒充成功案例。
- F32 之前，F13–F17 只在隔离 harness 里与合成数据集成；生产入口仍保持旧版兼容。

本文件是 [PR #8 产品转化评审稿](https://github.com/23chen990/form-car-studio/blob/research/form-targeted-client-trace-20261014/docs/form-competitive-lab/targeted-client-trace-20261014/PRODUCT_TRANSFER_UI_RFC_INPUT_ZH.md) 的**合同差异补充**，不重复逆向证据；需要 Owner 正式批准 S05 视觉差异后才能改正式代码。
