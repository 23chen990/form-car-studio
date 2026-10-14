# 本轮实际验证记录

研究日期为 2026-10-14，Asia/Shanghai。本轮从 PR #8 `07ed7aefa5be96ca363edaa5883a4e51671ba2d2` 的独立工作树继续，工具修复提交为 `24fed9ee80443849ac9cd428c589e7fc23ec55ed`、`93e724826f05d79d68d7a6db5a03de884a828af9`。原目录 HEAD `3168cac1799da3d0cad00a76c6f930b546efa124` 及 31 个既有脏文件指纹在研究开始时保存；最终保护核对见 `LOCAL_TRACE_VERIFICATION.json`。

本任务是用户明确授权的研究隔离任务，范围来自 `02_CODEX_LOCAL_PROMPT_ZH.md`。`AGENTS.md`、`FORM_CODEX_START.md` 和 `docs/form-handoff/GITHUB_WORKFLOW.md` 的 F00–F38 实施流程没有被当作竞品研究实施指令；未切入 PR #3 的实施工作树。研究增量限定在本目录，未修改被冻结的 43 个文件。保留 Draft PR，无合并或部署。

## 工具修复与实际测试

宿主为 macOS 26.5.2 / arm64；本轮 Python CLI / unittest 为 3.9.6。所有下列 unittest 都是研究工具的**合成测试**。

| 实际运行 | 子进程 exit | 结果 |
|---|---:|---|
| PR #8 原始 suite | 0 | 18 项通过；不能证明真实导出格式全受支持 |
| 新增 AOT 迭代、Hermes CSV 回归后，修复前 | 1 | 20 项中 2 项按预期失败 |
| 第一组最小修复后 | 0 | 20 项通过 |
| 新增 symbolic target / ambiguity 回归，补正前 | 1 | 22 项中 2 项按预期失败 |
| 唯一精确 symbol→PC 解析补正后 | 0 | **22 项通过，0 fail / skip** |

本轮不同合成用例总数为 22；重复运行没有算作新增案例。

修复均限定在 PR #8 的研究工具：AOT slicer 原 `kind` 变量覆盖文件类型，造成后续 edges 不再处理且 hash 元数据误标；Hermes slicer 只读取 `observed_label`，而提交目录实际列名是 `ui_name`；真实 AOT `call_edges.target` 多为符号字符串，新增从同一 functions 文件按完整名称唯一解析，重复/未知符号不猜地址。没有改变原 App、原反汇编、产品代码或旧测试判定。

从本目录重现：

```sh
python3 -m unittest discover -v -s tests
python3 tools/audit_trace.py --ledger ../deep-dive-20261012/09_EVIDENCE_LEDGER.jsonl --matrix trace_matrix.json
```

第二个命令实际 exit0：历史 228 条账本、7 条链、41 次证据引用一致。它仅验证旧 `trace_matrix.json` 的引用/分级；新增本机结论由新的实际矩阵和证据/输入索引承担。

## 真正的本地输入与数据流检查

以下全部是文件、字节和静态结构检查，**不是 App、网络、服务器、iPhone 或模型运行**。原始包、HASM、BIN、长 Prompt 和工具私有输出不进入 Git。

| 检查 / 实际命令 | exit | 结果与限制 |
|---|---:|---|
| 既有 AOT/MFY 账本源逐文件 SHA 重算 | 0 | 45 个存在，0 missing / mismatch；不是重复报告 228 条结论 |
| 修复版 Hermes slicer，现有 Modyfy HASM，归档 CSV＋目标 ID | 0 | 44/44 目标定位，34/35 精确名称；归档 SUV 对应本包标题 S U V，不作缺失结论 |
| `python3 <LOCAL_TRACE_PRIVATE>/modyfy-options/build_evidence.py` | 0 | 78 个缓存记录、28/12/38 分组、7 个重点 ID、全部字段与 subtype 核对；仅静态字面结构 |
| `python3 <LOCAL_TRACE_PRIVATE>/modyfy-regen/verify_static_locations.py` | 0 | 最终 56/56 源断言及 229/229 定位；首次 52/56 的坐标转录错误与后续修正均保留 |
| 修复版 AOT slicer，现有 functions/edges/string_refs | 0 | 最终选定 5 函数、145 edges、0 白名单 refs；0 refs 是该白名单局限，不是无业务逻辑 |
| `python3 <LOCAL_TRACE_PRIVATE>/mody/verify_selected_mody.py` | 0 | 39 个选定 BIN 范围与原 App 相同，24 条原始 BL 解码匹配；不证明全程序语义 |
| 修复版 Hermes slicer，现有 Wrapr HASM / profile wrapr | 0 | 定位 #9782；索引本身不证明 UI 数据流 |
| `python3 <LOCAL_TRACE_PRIVATE>/wrapr/verify_saved_export.py` | 0 | 最终 47 个已用完整函数＋相关全局 module 声明段与当前 HBC 的指令/注释匹配；早期 43 项被扩大后的检查覆盖，不累加计数 |
| `python3 <LOCAL_TRACE_PRIVATE>/wrapr/build_safe_tables.py` | 0 | 5 category、19 参数组、92 预设值、12 色名，共 104 行；不是效果测试 |

原件 locator、版本和 SHA 在 `LOCAL_TRACE_INPUTS.json`。HASM 坐标为函数 ID、HBC file offset 与函数相对 offset；Mody 是静态 VA，导出文件名后缀相对 isolate `0xe800`，不可混成 ASLR 地址。Hermes 多个函数 ID 可共享字节码偏移，环境身份也必须保留。

## 失败、更正和停止记录

1. Mody 原 `_debug objects` 命令对 Mach-O 使用 ELF reader，exit1。私有定点 pool wrapper 初次有类型转换编译错误；修正后输出 18 个所需 PP refs，但额外 enum fill 遇 unboxed bitmap，整体仍 exit1，随后停止。仅保留已输出 refs 与旧 index 的限定交叉证据；没有将 enum fill 宣称成功。
2. Modyfy 早期局部字段读取误推广为 Color 缺少 subtype。完整字段不变量检查失败后，逐项确认 38 Color 实有 subtype；独立复核也从原对象验证 16/10/12。最终报告没有该错误“产品缺陷”。
3. 再编辑证据中手工坐标的转录错误由原源断言检出并纠正；原文件未变。相关失败日志与最终定位检查均保留在本机。
4. 独立复核的 literal parser 因混合 JSON / JS 常量格式先失败两次，经受限常量解析后成功；不执行竞品 JavaScript。
5. 冻结 manifest guard 的早期调用有错误子命令、缺 manifest 参数、错误 repo 根目录，分别 exit2。纠正为下列真实根目录命令后 exit0，43 个内容 hash 匹配；这些 CLI 参数错误不被写成规格 hash 失败。

```sh
python3 docs/form-handoff/tools/guard.py validate
python3 docs/form-handoff/tools/guard.py verify-manifest --repo . --manifest docs/form-handoff/MANIFEST.json
```

两条正确调用均实际 exit0：39 任务图有效、43 冻结文件相符。研究提交不使用 Fxx begin/check 伪造实施任务通过；最终另做研究路径、内容脱敏、引用和保护文件检查。

独立复核由同一模型团队的另一个只读任务承担，定点对照原始材料；覆盖与报告指纹见 `LOCAL_TRACE_VERIFICATION.json`。这不是人工发布批准、F12/F23 审批或任何 V2.2 高风险关口批准。

本轮实际竞品 App 执行、字节码执行、内部服务请求、模型调用、购买、私人素材上传均为 0。服务器事实和效果状态保持 UNKNOWN / NOT_RUN。
