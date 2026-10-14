# 本轮剩余问题与证据边界

状态含义：`UNKNOWN` 是现有可信材料不足；`NOT_RUN` 是本轮未运行；`PARTIAL_UI_CALLBACK_LINK` 是分段代码已有关联、具体回调身份尚缺。下列关口不因工具测试通过而获批准。定位和版本见 `LOCAL_TRACE_EVIDENCE.json` / `LOCAL_TRACE_INPUTS.json`。

| 问题 | 状态 | 已证明的边界 / 尚缺证据 |
|---|---|---|
| Modyfy 当前在线目录与名称/ID变化 | UNKNOWN | 本轮定出 1.2.0 build71 的内置 iOS 回退目录；成功 response.data.data 会替换。没有访问内部目录接口。 |
| Modyfy 空 ID、Style/Extra/Color 兼容与服务器优先 | UNKNOWN | 本地每类标量替换、固定三个请求位置成立；服务器是否接受、补默认或重排未知。 |
| Modyfy 真实启动默认值 | NOT_RUN | 代码初态三 ID=''、Color tab=Matte；没有运行真实持久化/恢复。 |
| Regenerate 的输入与相机母版是否相同 | UNKNOWN | inputs[0].urls[0] 到下一次 imageData 已闭合；该 metadata URL 的服务器来源、预处理与字节未观察。 |
| Effects 历史第二张输入 | UNKNOWN | #22481 只恢复首 URL；下一次双输入读取当前 selectedImageDouble，不知道该状态实际值。 |
| Modyfy 其他“把输出设为底图”入口 | BOUNDED_NEGATIVE_ONLY | 所查普通 ResultBottom 仅 Regenerate/Download/Share，没有该按钮；不声称全 App 没有其他入口。 |
| Mody 新 Change Tires / Change Tire Colors 完整 UI 绑定 | PARTIAL_UI_CALLBACK_LINK | 同版本标签、widget build、事件 setter 和请求分支已定；PP23455/23456/23461 的具体匿名 callback 身份仍缺。 |
| Mody Detail Angle / Spoiler / Exhaust | UNKNOWN；跨版本 UI 为 HYPOTHESIS | 有关第三方 UI 没有统一版本；Style Builder 的 Angle 是另一条路径，不能补证。有限 exact-label 搜索未命中不等于功能不存在。 |
| Mody PromptTypes 源码枚举名 / fallback 原文 | UNKNOWN | 保留 PP slot 与消费者；enum fill 遇解析限制后停止，不编造 enum 名称或最终文本样例。 |
| Mody 当前 flags、远程选项与模板正文 | UNKNOWN | 分支与字段已定；没有读取内部 Firestore、私有 Callable 或活跃远程配置。 |
| 三款服务器 Prompt / workflow / 模型 / 后处理 | UNKNOWN | 客户端路由名、请求字段和函数相同/不同均不能确定服务器实际执行。 |
| Wrapr 组合兼容、quality=high 含义与收费 | UNKNOWN | 所查屏幕有本地必选组与单键替换；high 只在特定调用路径为默认值。实际收费/分辨率未知。 |
| 实际上传字节、生成结果、连续编辑保真 | NOT_RUN | 没有竞品启动、字节码执行、请求捕获、私人照片处理、购买或模型调用。 |

源材料已找到并核实，四项研究没有剩余“找不到安装包/导出”的阻断。剩余不确定性来自远程黑箱、运行证据缺失及明确的 AOT 回调解析限制；继续扩大关键词扫描不会把它们变成已证明事实。

安全离线补证仅限已有同版本材料的必要回调/enum 元数据解析；本轮已经按失败边界止损。任何新的竞品运行、内部服务访问、照片传输、付费实验、产品能力或冻结规格变化均不在本次执行范围。
