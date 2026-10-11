# FORM 调研与开发交接包

研究日期：2026-10-11。代码基线：23chen990/form-car-studio，3df0b392f4c81364a34d5083dc75284eafbe2eb1。

## 文件用途

- FORM_research_2026-10-11.docx：主报告，可阅读、批注与转交。
- research.md：同一主报告的纯文本版本，含完整来源链接。
- Codex_handoff.md：10 个开发任务包、依赖关系与验收要求。
- User_research_protocol.md：待执行的车主研究和竞品真机对照流程。
- Experiment_decision_board.md：六项关键假设、测试变量、护栏和决策条件，避免把建议直接当作已验证答案。
- sources.json：33 个外部页面的索引，含同名 App 的 ID 与地区信息；代码证据另见主报告附录。
- summarize_eval.py、eval_runs.template.jsonl、test_summarize_eval.py：离线评测记录与汇总工具。没有联网、采购或模型调用逻辑。

## 已完成与未完成

已完成公开资料核验、固定提交的只读代码分析、方案编写及汇总工具的合成数据单元测试。竞品功能与价格来自可读取的公开页面，实际默认付费墙、图片效果和收入不能由这些页面证明。

没有安装/购买竞品，没有调用真实付费图像模型，没有招募车主，没有执行原仓库的构建、测试或 iPhone 真机验收，没有修改仓库或部署。工具的 12 个单元测试通过，只证明汇总工具在这些合成测试中的行为，不证明 FORM 或任何竞品的质量。

主报告中的 216 个输出是待批准预算的评测计划，不是实验结果。模板 status=not_run，未知数值为 null。没有补入虚构测量数据。

## 最短交接路径

先阅读主报告 01、04、07、10、12 章，再把 Codex_handoff.md 连同整个包交给开发。首轮建议从 T01/T02/T03 开始；真实模型测试另行确认费用和照片授权，不因为文档写了计划就自动花费。

## 离线汇总工具

运行要求：Python 3.10 或更新版本，只使用标准库。

```sh
python -m unittest -v test_summarize_eval.py
python summarize_eval.py eval_runs.template.jsonl --output summary.json
```

模板的输出应显示 not_run 和 executed_records=0。复制模板到独立文件后记录真实结果，再运行：

```sh
python summarize_eval.py real_runs.jsonl --output real_summary.json
```

每一行是一个唯一 run_id 的端到端测试执行，包含 case_id、pipeline_id、task、cohort、mode、currency 和 status。mode 只能是 live 或 demo；默认汇总排除 demo。若确需一起查看可加 --include-demo，但整体汇总将包含演示数据，不得拿它证明真实模型质量。

status 支持 not_run、succeeded、failed、cancelled、timeout。只对成功交付的图片填写 review；由评审者记录 reviewer_id、identity_pass、instruction_pass、untouched_pass、would_keep 四个布尔值。真实生成未人审时 review=null，不能视为自动通过。多人评审的原始记录独立保存，汇总使用一次有记录的最终裁决；不要为每位评审重复添加一次模型执行。

latency_ms 是该任务端到端观察时长，provider_cost_usd 是本条测试所有供应商尝试的总费用；币种必须 USD。费用未知填 null，不能填 0。只有确认没有供应商费用时才使用 0；输入、输出、内部修复等账单不要漏算。其他成本如存储、客服、税费、平台及获客，不在此工具的供应商成本字段里，应另表核算。

工具保留失败与取消在分母里，输出人审覆盖率、缺失人审的描述性上下界、已知与完整费用、每张合格且愿意保留作品的供应商成本，以及时延统计。上下界不是统计置信区间。重复车辆与多轮编辑有关联，工具不宣称总体置信区间。

p50 使用中位数，p95 使用 nearest-rank 描述估计。样本小、费用缺失或人审未完成时，相关结论保留未知，不能把结果空白理解为零。

## 数据安全

本包不包含车主原图、账号、API 密钥或竞品安装文件。真实研究照片和授权记录应在受控位置管理，源图哈希只用于匹配，不替代授权。不要把照片、私人提示词或购买凭据提交到公开 GitHub。

资料核验范围以报告为准，海外多个市场的完整法律审查未包含在本包中。Apple、供应商和商店信息可能更新，上线前再次核验。