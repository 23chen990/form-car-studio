# FORM 双竞品深度研究交付

研究日期：2026-10-12 至 2026-10-13，Asia/Shanghai。状态：**研究完成；真实生图质量、付款和真人验收均未执行。**

本轮取得了两款竞品可复核的客户端业务证据。Mody 的未加密 Dart AOT 恢复了模板读取、Prompt 拼装、可选文字重写、图片准备、请求与购买回调链；Modyfy 的未加密 Hermes bundle 恢复了选项 ID 请求、图片缩放、结果处理、权益同步及初始化错误路径。**两者实际生产生图模型及效果仍为 Unknown，不能据反编译输出量排名。** [AOT05–AOT22、MFY02–MFY12、QUALITY_UNKNOWN_MODY、QUALITY_UNKNOWN_MODYFY]

静态调用不等于本次运行；路由别名不等于模型；相机角度约束不等于保真成功。两段原始录屏未在限定位置找到，UX 使用 PR #6 固定提交的二手时间线，明确标记 `ORIGINAL_VIDEO_NOT_AVAILABLE`。[TOOL04、UX01、UX47]

## 阅读顺序与索引

| 文件 | 用途 |
|---|---|
| [01_OWNER_SUMMARY_ZH.md](01_OWNER_SUMMARY_ZH.md) | 产品负责人一页结论与三件优先事项 |
| [IMAGE_QUALITY_REVERSE_ENGINEERING_ZH.md](IMAGE_QUALITY_REVERSE_ENGINEERING_ZH.md) | 真实 Prompt、模型信息、五项质量证据与下一实验 |
| [MODY_VS_MODYFY_TECHNICAL_COMPARISON_ZH.md](MODY_VS_MODYFY_TECHNICAL_COMPARISON_ZH.md) | 双技术栈、可读代码、工作流及 Modyfy 启动问题 |
| [02_MODY_AOT_TECHNICAL_ZH.md](02_MODY_AOT_TECHNICAL_ZH.md) | 工具、哈希、地址、引用、调用关系及解析限制 |
| [03_MODY_MODYFY_UX_ZH.md](03_MODY_MODYFY_UX_ZH.md) | 分阶段二手录屏观察与原研究纠错 |
| [04_BUSINESS_FLOW_EVIDENCE_ZH.md](04_BUSINESS_FLOW_EVIDENCE_ZH.md) | 实线代码与虚线未知的流程图、UI 对照 |
| [05_FORM_GAP_AND_PRIORITY_ZH.md](05_FORM_GAP_AND_PRIORITY_ZH.md) | 实际 PR #3 代码差距、五项建议、F 任务与验收 |
| [06_ORIGINAL_ARCHITECTURE_ZH.md](06_ORIGINAL_ARCHITECTURE_ZH.md) | 现有栈上的原创 Prompt、任务、图片与版本方案 |
| [07_QUALITY_AND_RESEARCH_PLAN_ZH.md](07_QUALITY_AND_RESEARCH_PLAN_ZH.md) | 30 个空照片槽位、252 次未执行计划与质量闸门 |
| [08_TOOL_FAILURES_AND_LIMITS_ZH.md](08_TOOL_FAILURES_AND_LIMITS_ZH.md) | 有限修复、失败、停止条件与未执行项 |
| [09_EVIDENCE_LEDGER.jsonl](09_EVIDENCE_LEDGER.jsonl) | 逐条证据/计划索引；保留 PR #4 原字段并增补分级 |
| [10_NEXT_ACTIONS_ZH.md](10_NEXT_ACTIONS_ZH.md) | 少量可分工的下一步与单独授权边界 |

每条重要结论以 Evidence ID 对应账本。`OBSERVED_UI` 中的录像记录标明 `SECONDARY_DOCUMENT_REVIEW`，不冒充本轮直接观察；唯一 `RUNTIME_OBSERVED` 是有限系统诊断日志，不是模型执行。`VERIFIED_EFFECT` 为 0。账本同时记录观察、推断、不能推断、原始来源、SHA、工具、位置和脱敏要求。

## 固定研究基线

| 对象 | 固定提交 / 安装版本 |
|---|---|
| [PR #6](https://github.com/23chen990/form-car-studio/pull/6) | `5b1b203364cbf117a49f1506af3b449b5fd5f303`，21 份资料完整阅读；设计未批准 |
| [PR #4](https://github.com/23chen990/form-car-studio/pull/4) | `ae3d0e2b4e9e382855d9bc7495c5a4e81fe1c01d`，沿用证据字段与研究边界 |
| [PR #3](https://github.com/23chen990/form-car-studio/pull/3) | `467e20758414216f215fb4106d098dedc0b18c3a`，实际代码只读；F03 已有 CODE_READY 报告 |
| [PR #5](https://github.com/23chen990/form-car-studio/pull/5) | `2e64d51933ca428120c38ce9a0eff9e3136a08a5`；VISUAL_APPEAL_REJECTED 保持 |
| Mody AI | 本机 `com.cartuning.appitech`，3.1.440 build2 |
| Modyfy | 本机 `com.ai.car.app`，1.2.0 build71；不等于录屏或当时商店版本 |

研究分支：`codex/form-mody-modyfy-deep-dive-20261012`，基于 PR #6，发布位置为新文档子树 `docs/form-competitive-lab/deep-dive-20261012/`。研究 Draft PR 在交付发布记录中登记。该分支不修改 PR #3、冻结规格、任务图、生产配置或已有私人数据。

## 本地原件与验证

完整私有目录为 `/Users/kker/Desktop/FORM_MODY_MODYFY_DEEP_DIVE_20261012/private/`，权限 700；含原/兼容 AOT 输出、Hermes 汇编、补丁、命令日志和独立字节核查。第三方 App 保留原位；没有解密、修改签名、上传素材或请求内部生成接口。Git 仅收录脱敏报告与账本，原始代码、端点、Prompt、配置值及竞品素材保留本地。

工具验证：原版 unflutter 109 pass / 33 skip；一组兼容补丁后 114 pass / 33 skip；Hermes 2 个上游断言通过；MobHunt 2 个离线 mock 回归通过；独立核对 3 条 BL、10 个 `.bin` 及 29,605 个范围通过。**这些不是模型、StoreKit、iPhone 或安全发布验收。** [AOT03–AOT04、TOOL02、AUX02、INDEPENDENT_STATIC_01]

照片、供应商配置、预算与真人研究仍缺。252 次仅为计划，授权支出 0；最值得执行的下一实验是固定模型与图片管线的 12 首图 Prompt A/B，需另获明确授权。[PLAN01–PLAN03]
