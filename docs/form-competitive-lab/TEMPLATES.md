# 研究记录协议与月报结构

## 唯一对象键

{appId}-{storefront}-{version_or_unknown}-{date}-{questionId}。App ID 为 Apple 的数字字符串，不以名称代替。非 App 类通用替代方案另建 category，不伪造 Apple App ID。所有时间以带时区 ISO 8601 记录，不写“3天前”当作稳定发布日期。

## 单条 observation 记录

模板：templates/observation.template.json。以下字段含义：

- status：NOT_RUN / BLOCKED / RECORDED；没有真实证据则不写 RECORDED。
- claimKind：OFFICIAL_CLAIM / OBSERVED_BEHAVIOR / REVIEW_SIGNAL / STATIC_ARTIFACT / INFERENCE；后四项不能互相冒充。
- method：APP_STORE / PUBLIC_DEVELOPER / USER_REVIEW / PERMITTED_HANDS_ON / REA_PUBLIC_WEB / REA_AUTHORIZED_ARTIFACT / GENERAL_AI_BENCHMARK。
- authorization：NOT_CHECKED / PUBLIC_SCOPE_REVIEWED / SPECIFIC_APPROVAL，获批准只表示记录中该项确实已经批准。REA_AUTHORIZED_ARTIFACT 必须是 SPECIFIC_APPROVAL。
- evidenceRef：公开 URL 或私有仓储中不包含敏感信息的 opaque ID。绝不直接存原始 IPA/HTTP 流量/密钥。
- evidenceDigest：记录私有原件 SHA-256（仅用于完整性校验），不等于来源真实可信或使用合法。
- confidence：LOW / MEDIUM / HIGH / UNKNOWN；发布的单条用户评论即使可信，也不能自动代表频率高。
- applicabilityToFORM：与当前代码/需求的关系，需有指向代码 SHA 或规范的引用。
- privacyAndBudget：第三方数据是否包含个人/敏感信息、实际测试花费和权限审批；零是实测零，未知为 null。
- sample：测试任务、照片槽位与车型类别（匿名编号）、首次输出、失败、重试、可见等待；不把私人照片或品牌车牌放进公开样例。

模板默认 NOT_RUN / UNKNOWN / null。填入未知不能改成0、false或成功。非公开证据不得放在公开仓库，报告仅存摘要与可验证的私有引用。

## Decision record

模板：templates/decision.template.json。默认 RESEARCH_ONLY，缺证据不得升级 APPROVED_FOR_BACKLOG。每个 decision 至少关联一个已经审查的 observation，必须能复核结论并写清拒绝理由。候选改动不得覆盖正在执行的 Codex V2.2 规格。

## 研究月报

标题：FORM 竞品证据研究月报｜月份｜数据范围｜核验日。

1. 重大结论：最多3个，经证据确认并明确对FORM的影响。
2. 竞品基线表：App ID、地区、版本、功能更新、公开 IAP 及历史一致性。不同商品及地区不做草率环比。
3. 实际操作研究：样本、同题操作、首出结果/失败/重试、图像身份与目标修改、成本（未知就UNKNOWN）。
4. REA 辅助发现：目标与授权、具体操作、工具版本、证据、事实/推断/未知，若未执行就写未执行。
5. 对 FORM 的当前实现对照：代码 SHA、已存在/待做/缺陷/未验证，不把已列计划当成已实现。
6. 决策卡：VALIDATE_NEXT / RESEARCH_ONLY / REJECTED / 已获批事项，附原因。
7. 下个月重点与需要用户批准的费用/素材/许可；不得暗中购买或安装软件。

月报机器人本身只做可用资料的整理，不能假装运行了 REA、本地 iPhone 或付费模型。
