# FORM｜客户端深度逆向增量：负责人结论（2026-10-14）

**研究性质：RESEARCH_ONLY / READ_ONLY / NO_LIVE_MODEL.** 本文件基于 PR #7（固定 SHA `2b25588cfea868d0f27626d68565bd6f94827061`）已有的 228 条公开脱敏证据重新核对，不是新的真实竞品运行记录，也没有在本机私有二进制上再次执行反汇编。

## 现在已经真正知道了什么

1. **Mody 整车编辑：**客户端确实从远程 Firestore `generatePrompts` 取得 `type/prompt` 模板，选择模板并处理颜色占位、合并修改描述、附加视角约束，向标准生成请求发送 `prompt/imageUrl/aspectRatio`。这是可关联的客户端代码路径，不是恢复全部模板正文（AOT05–AOT09、AOT13）。
2. **Mody 特定编辑：** Custom 可在远程开关控制下辅助重写文字；Detail 有独立的目标描述和轮胎等工具/工作流分支；已经说明 **“不同 UI 入口的客户端业务逻辑不完全相同”**，但还不能说它们使用不同生产模型（AOT10–AOT11、AOT18、AOT20）。
3. **Modyfy 整车：**客户端从 style、extra、color 选择构造 `itemIds`，联合 `imageData/collection` 发往服务端；CarMods 也有独立选择业务入口，并复用类似的请求结构（MFY02–MFY04）。标准整车私有 Prompt 尚未出现在此客户端请求里。
4. **Modyfy 连续编辑：**结果 `inputs` 可以用于恢复选择过的 IDs 等内容（MFY06），但“下一次真正发的是原图还是本次结果图”仍然没有形成完整证据闭环。
5. **UI 与真实生成：**用户录屏归档了多个选择页面，部分图片转圈；两款均没有当次成功生成的可核验输入→输出。已发现的 `flux2edit`、`pimageedit`、`workFlowId`、`topazupscale` 是客户端请求/路由别名，不等于真正使用这些名字所暗示的模型或自动增强（AOT16–AOT19）。

## 与上轮相比，这次新增的实质交付

- 将 PR #7 **228 条证据**重新核对并按实际状态清点：68 `CODE_LINKED`、32 `OBSERVED_UI`、88 `STATIC_PRESENT`、35 `NOT_EXECUTED`、2 `BLOCKED`、2 `UNKNOWN`、1 `RUNTIME_OBSERVED`。注意 `RUNTIME_OBSERVED` 是 Mac 诊断，不是生成成功。
- 从散落文档提炼出机器可检查的 `trace_matrix.json`，把**客户端关联**、**跨录像和客户端版本的推论**、**未知服务端**分开记录。不能把不同版本的 UI 和代码拼成“已运行通路”。
- 提供只读 `audit_trace.py` 与合成单测：可以防止错误地将归档界面、尚未执行的计划或跨来源推论标成已验证代码执行。
- 提供 Modyfy 24 个 Style／10 个 Extra 的归档名称，以及另一第三方记录中单独出现的 `Golden Accents 1`：总计 35 行**跨来源名称记录**，并非 35 个已验证风格或内部 ID；名称来自不同来源和未核对的版本。

## 下一轮只值得 Codex 定点研究的四个问题

| 优先级 | 问题 | 成功标准 | 止损条件 |
|---|---|---|---|
| P0 | Modyfy 标签如何对应真实 ID、是否多选/互斥？ | 至少若干个 UI label → 同版本静态配置或 state → `itemIds` 元素的可复核字段和调用链；其余明确 Unknown | UI 资源或 ID 映射在远程且本地不可读则停止，不猜 ID |
| P0 | Modyfy 再编辑到底用了哪张图？ | `result.inputs.urls`/`outputs.url` 到下一次 `imageData` 的实际变量/分支闭环 | 只找到 `result.inputs` 说明“恢复选项”，不等于确认底图 |
| P1 | Mody 的 Style/Extra 组合顺序与 Detail 操作如何传递？ | 几个明确控件的本地数据流、优先级和请求字段；有代码位置 | 遇到动态 dispatch 或仅服务端模板，不制造最终 Prompt |
| P1 | Wrapr 哪个 UI 选项映射哪个 `modificationType/parameters`？ | 有同版本本地 Hermes 控件→请求数据流 | 原始本机报告之外找不到可读取导出时标记阻断 |

## 对 FORM 的产品决策

可借鉴的是**灵感风格与定点编辑的入口分离**、**用户选择的结构化记录**和**保存作品后恢复选择**。现在**不要**直接增加 Body Kit、低趴、换视角、任意 Extra 到 FORM 生产生成能力；这些超出或尚未达到 V2.2 的能力证明条件。前端创意展示仍须严格区分示例与真实结果。

> 这批研究不触碰 PR #3、F12/F23 行数审批、S05 UI RFC、Provider Prompt、模型预算或产品收费。30 个照片槽位／252 次研究仍为计划，0 真实调用、0 支出授权。

**来源入口**：[PR #7 研究](https://github.com/23chen990/form-car-studio/pull/7)，[客户端业务链](https://github.com/23chen990/form-car-studio/blob/2b25588cfea868d0f27626d68565bd6f94827061/docs/form-competitive-lab/deep-dive-20261012/04_BUSINESS_FLOW_EVIDENCE_ZH.md)，[原始证据账本](https://github.com/23chen990/form-car-studio/blob/2b25588cfea868d0f27626d68565bd6f94827061/docs/form-competitive-lab/deep-dive-20261012/09_EVIDENCE_LEDGER.jsonl)。
