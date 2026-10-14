# FORM｜Style＋Extra＋Color 最小 S01/S02 兼容 API 草案

**状态：PROPOSED / NOT OWNER-APPROVED FOR IMPLEMENTATION**，基线 PR #3 `758477e`。服务端由现有 Node24 Express/SQLite 提供；保留已通过的 V2 explore/detail 及历史数据，任何新增行为不得静默改变旧任务费用或调用模型。

## 1. 推荐新增显式的 `build` 生成请求，而不是悄悄重解释 V2 `explore`

`shared/v2/edit-plan.ts` 当前 `schemaVersion:2` 只有 `explore/detail`、旧 `styleId`、受限 `edits`。`server/v2/plans.ts` 会拒绝 explore 中任意 edit overrides；`shared/v2/provider-prompt.ts` 当前全局禁止 body kit/spoiler。故给当前 `explore` 加三个对象/删除负面 Prompt，会改变已冻结的 plan snapshot/policy/账本语义。

**建议讨论采用新增版本化消息**（版本 3 只作为技术提案，不擅自改变对外 v2 HTTP 路由）：

```json
{
  "schemaVersion": 3,
  "operation": "build",
  "source": {"kind":"original"},
  "styleId": "street",
  "extraId": "widebody",
  "colorId": "matte_black"
}
```

- 使用允许的 ID，不从用户提交现成 Prompt、价格、供应商、图片 URL、质量标签、额外参考图或付款状态。
- `extraId` 必须是已批准的一个 ID 或 `null`，不能任意数组；`colorId` 必须是已批准 ID，允许 `keep`。3 个选择能否生成，必须按**服务端已发布且经实测的能力目录**确定。
- 不要自动把旧版 `sport` 的颜色风格映射成包含宽体的新版 `street`；旧作品/任务与其原 template/preset/quote 同版本保存。
- `source` 可为 `{kind:'original'}` 或 `{kind:'version',versionId:'...'}`；允许何种源由 profile/release gate 判断，不得默认 `latest`。由**真实服务端 owner+project+asset**权限检查决定可读性，不能依赖版本 ID 格式。
- 前端目录是受限展示集合，但服务端必须再次验证当前发布配置。下架后老作品可显示旧 recipe，重新生成要按当前能力显式验证或拒绝。

## 2. 服务端组合优先顺序（冻结版本）

1. `SOURCE`：明确 original 或真实拥有的 selected version；有原图参考需求，真实供应商也必须支持并实际提供对应参考图。
2. `STYLE`：汽车外观主题，不隐含额外不受支持的结构改件；明确其适配的 Extra 白名单。
3. `EXTRA`：最多一个真实获准结构改件，给出允许改变的几何区域；与 Style 互斥则拒绝报价。
4. `COLOR`：用户指定的合法颜色覆盖 Style 建议配色，`keep` 按确切来源保持当前车漆；若 Style 自身有其他真实视觉变化，不能简单把 Style-alone 判为 no-op。
5. `PRESERVE`：模板必须与选中的 Extra 一致。加尾翼就不能再发“不得加尾翼”；宽体修改翼子板，但车窗、车灯、轴距、轮心、摄影视角等保持。
6. `REALISM`：摄影一致性、合理边缘与阴影、可见部分真实性，不承诺真实物理安装或合法上路。
7. `OUTPUT`：一个计划＝1 输出＝1 明示用户积分费用＝1 条任务；不因 Prompt 优化暗自叠加模型轮次或再次收费。

默认仍用确定性模块化 Prompt，不额外使用 LLM 重写。只有质量实验实际证明 LLM 有意义，另行审批成本和延时。

## 3. 冻结计划和服务端安全边界

- **quote 之前**完成：session+owner/consent、source 资产可访问、合法照片、白名单、Style/Extra 兼容、Color 覆盖、ProviderProfile 是否支持改件/来源、预算和 no-op 判断。
- **quote 时**冻结 `schemaVersion=3`/operation、`sourceAssetId`+digest/owner/project、`catalogVersion`、`templateVersion`、`capabilityVersion`、`styleId/extraId/colorId`、`providerProfileId` 与 model/version、输出配置、真实 credits，计算服务端 canonical semantic digest。原 S01 的 plan TTL 和签名等校验不可被跳过。
- **task 提交**继续只接收原有 `{planId,submissionId,consentRecordId}`，沿用持久唯一值、UNIQUE(owner,submission)、UNIQUE(owner,confirmed_plan) 与未确认上游账单不可自动重试策略；UI 双击刷新不能产生第二笔消费。
- **完成结果**存 request/desiredRecipe（想做什么），observedRecipe（有评估证据才知道生成真正做到了什么），以及源版本/模板/profile/费用，不允许把“请求宽体”说成“验证已宽体”。
- **失败/补偿**沿用现有 F10/F25/F35/F27，而不是再建钱包或人工改本地积分；供应商效果差不保证自动退积分，按已审批策略处理。
- **能力回滚**：目录禁用时新 quote 失败；已确认计划按被冻结的契约执行或按批准规则安全终止/释放；不可无提示换低质量模型或改变价格。
- **日志**仅收脱敏参数 IDs、任务/模板/费用；用户照片、密钥和供应商私有 Prompt 不进入 public GitHub。

## 4. 文件级最小受审改动（这不是已获准的 task allowlist）

| 文件/层 | 预计修改方式 | 需独立批准的点 |
|---|---|---|
| `shared/v2/edit-plan.ts` 或经审批新 `shared/v2/build-plan.ts` | **保留旧 parser 原义**；新增 discriminated build request/parser | schema 版本/新增 fields、backcompat 测试及 frozen scope |
| `server/v2/presets.ts` + 经审批的受控目录 | 为新增 Style/Extra/Color 存版本、兼容和可见/禁用规则 | 原 legacy presets 不改义、状态发布归属 |
| `server/v2/plans.ts` | 给 Build 按旧 plan 服务冻结字段/quote；扩展 payload 验证 | 旧 plan digest/quote/ledger 不变、更改新 digest 定义 |
| `shared/v2/provider-prompt.ts` 或独立 `build-prompt.ts` | 按部件允许变化动态构造保护文本，模板版本化 | Provider Profile/能力/效果证据；审查 prompt 注入及逻辑冲突 |
| `server/v2/provider-profile.ts`、`provider.ts`、`worker.ts` | 核对一次生成确实只需一个 provider 请求、额外参考图/掩膜真实能力 | 不擅自开放 live、不静默切模型、不绕过额度 |
| `src/lib/api-v2.ts`，F14/F13 编辑组件 | 选择器草稿只产生受控 IDs，一次确认报价，保存源/版本 | 视觉最终方案由另一个窗口确认并批准 S05，避免提前重写页面 |
| `tests/v2/**` / 独立服务测试 | request/backcompat/plan/收费/owner scoping/失败/旧作品只读 | 冻结允许文件、DAG 变更、Guard、当前 CI |

**不要把真实服务器路由和 SQL 偷塞进 F32 的 1000 行薄接线。** S02 workspace/history/draft/favorite 绑定的缺失已在 PR #9 审计；应给明确被审查的任务归属/新增受限任务，服务器请求、权限和 DTO 得完整验证。

## 5. 本目录可复用的代码成果

`sec-build-intent.mjs` 是**纯请求/目录合同参考验证器**，以模拟且受信任的目录为输入；默认没有 live 权限、真实授信/扣账接口或图片生成入口。它使 Codex 以后无需重新写基本白名单检查：

- 新 v3 与老 v2 明确分开；无法把 explore/detail 误报成 Build；
- Style+Extra 兼容、选项禁用、Color/Extra 单值、`keep` 和 no-op、source 精确 versionID；
- 任意 user Prompt、价格/供应商、用户提供“已允许”开关或原图 URL 被拒绝；
- 冻结 catalog/template/capability 版本+唯一 outputCount；
- Node 22 离线 31/31 synthetic tests 通过，不等于 Node24 项目 CI、数据库事务、生产授权和模型质量。

## 6. 决策提案最少只要两个审批点

1. **S01/S02**：批准独立 Build 消息及其版本兼容/保存/计费/任务范围与路径预算，包含谁负责编写现有缺失持久化路由；研究版源代码不得直接当生产审批通过。
2. **真实模型能力验证**：哪几组 Style/Extra/Color 可以上线收费，必须由有版权/授权的真实汽车照片、有效模型配置及独立封顶预算的实验决定；研究组合器不会生成图片。现有完整 252 调用计划仍为计划，当前一小批 9 次也非自动许可。
