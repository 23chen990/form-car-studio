# FORM｜视觉并行期间的 Codex 最短施工单（非生产授权）
日期：2026-10-14；研究工作基线 PR #3 HEAD `758477e0d1b6a358006357b586ec7917a5dd4e26`，PR #8 研究参考。本文件不修改任务预算或冻结规格。

## 项目目标与当前缺口
Owner 正在另一个窗口确定正式 V2.1 视觉；当前窗口负责生成效果、赚钱路径和非视觉工程。**不要为等待 UI 定稿而停下原生开发**，也不要提前换掉现有浅色 UI。
当前 PR #3：29/39 CODE_READY_OFFLINE，F12/F23 已恢复并完成离线测试；F18 由于27条预计完整路径>当前20路径预算而 BLOCKED_TASK_TOO_BIG，2500行预算未测。F19、F21和后续 F24、F30、F31、F37、F32 受依赖阻断。S02 项目/历史/草稿/收藏等服务路由存在已记录的任务归属缺口。V2 功能均未进入生产入口。

## 施工线 A｜优先解除 F18并沿已有DAG交付（待 Owner 针对上限明确授权）
1. 用现有本地私有 F18 preflight、hash/31个模板记录对照目前 Git HEAD，清理没有必要的生成垃圾文件，列出真实需要的完整路径；不能为了通过20项人为漏掉 App 工程重要文件、签名/资源安全边界。
2. **仅在 Owner 明确授权后**，如果没有更简洁而完整的方案，将 F18.maxFiles从20提高至27，继续保持 maxLines=2500、allowlist、安全停机、guard、43冻结文件核验和审批轨迹。先测算2500行总量，如超限报告、提出可复核拆卡方案，不通过删测例/改守卫绕过。
3. 按原 frozen DAG 工作：F18→F19原生图像导入/HEIC/iCloud/分享、F21原生 Apple 登录/Keychain→F24 StoreKit/补偿恢复，以及条件满足的 F37、F30、F31。每张任务独立 source/evidence 提交；没有实际 Apple Dev Team/BundleID/签名、真实 iPhone/StoreKit 的地方标 NOT_RUN、保持 disabled。F30/F31若因真实商店政策、版权素材等缺失不能完成，停止在该关口并列 Owner 缺口，不能造测试事实。
4. 用户可验收的里程碑：在本机 Mac 模拟器能启动**打包的 React App**且无真实AI/购买；后续在权限允许后，能实际演示相册选图、返回、导出、登录、沙盒支付各自有据可查的状态。模拟器≠真实iPhone TestFlight。

## 施工线 B｜Style＋Extra＋Color 工程合同与隔离验证（不必等视觉）
Owner 确定首发需求：选1 Style、0/1 Extra、1 Color，以**一张原始车图或选定的确切版本**作为输入，服务器由白名单ID构造版本化Prompt，1冻结报价→1确认→1 AI任务/输出。不做Custom自由文字、不默认加独立LLM。已独立实现的研究版 composer+21项通过的纯Node测试见 [style-extra-color-lab](style-extra-color-lab/README.md)。

请从真实 PR3 合同核对以下事实：shared/v2/edit-plan.ts只支持 explore/detail；server/v2/plans.ts 对 explore额外 edits 抛 EXPLORE_OVERRIDES_UNSUPPORTED；server/v2/presets.ts现为颜色预设；shared/v2/provider-prompt.ts明确排除 Body Kit/Spoiler；现有版本、费用、Provider Profile、幂等、历史快照必须保持正确。**研究版 composer 是逻辑样例而不是可直接import进生产的可信安全实现。**

Codex可在独立审阅文档中定义最小 S01/S02/S05影响和实施拆卡：
- 合法请求 ID、白名单与版本；向后兼容已完成的 explore/detail/历史项目；exact original/version源与owner校验。
- Style 提供总体方向、Extra 为至多一项可选改件、用户指定Color覆盖Style推荐配色；冲突与不支持能力须在扣费前拒绝。Style-only是否真的造成有效变化要按真实功能判定，**不能把研究版 no-op 规则泛化成所有将来风格**。
- 针对选中改件去除互相矛盾的全局负面词；一个结果、一笔报价、同一不可变intent/模板版本/能力配置/供应商快照，保存request与observed两套状态，不能把“请求了宽体”当作“已经成功宽体”。
- 先用合成 fixture 测试完整组合、不兼容、颜色优先、bodykit与spoil禁止冲突、跨用户图权限、源版本、旧合同、冻结任务与已收款幂等/失败/撤销。
- 哪些文件落在现有卡的 allowlist之外，需要Owner新增/修改scope预算。**没有S01正式变更审批前，不在PR #3偷偷改schema、商品能力、客户收费目录或生图Provider。**
- 首轮真实质量验证预计3张授权图×3个有限组合=9次，仅为计划，花费需Owner另行审批；不能把研究工具的21项纯测试当生图质量通过。

## 施工线 C｜S02缺失路由归属和F32接线预案
复用 [PR #9预检](https://github.com/23chen990/form-car-studio/pull/9) 与 [S05 RFC](https://github.com/23chen990/form-car-studio/blob/codex/form-v2-implementation/docs/form-v2/rfcs/S05-ui-v2.1.md)。
确定 bootstrap、project/history、draft CAS、favorite/cover/name、feedback、wallet读等接口哪个任务实现，给出最小可审核任务映射与路径预算，避免在F32薄接线阶段挤入实际仓储/SQL。不可因此重复造wallet、server routes或绕开owner scoping。UI最终视觉待Owner批准S05后再接入。

## 避免浪费额度的执行顺序和汇报
1. 先优先拿下F18完整脚手架，顺着任务DAG一路推进独立于视觉的可做项；条件阻断就记录并继续下一条独立可做项，避免不断“等待视觉定版”。
2. 同时仅需一个有限的S01 Style＋Extra＋Color **可审核合同RFC＋离线fixture**；不要另起一轮竞品逆向，不重复生成现有 research prototype，不新增custom自由文字/LLM/多张联图等需求。
3. 当前产品UI保持隔离，S05最终方向等视觉窗口；不修改main、不合并PR、不触发付费生图/真实StoreKit消费、不部署、不迁移生产库。任何新批准的规格请保留差异、审批和guard记录。
4. 集中交付：实际source hash/CI、每张任务代码和设备/真实接口测试状态、仍缺的Owner决策、距可运行TestFlight的最短阻断链，不堆长篇重复研究文档。

