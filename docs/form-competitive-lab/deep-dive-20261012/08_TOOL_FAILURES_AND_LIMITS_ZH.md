# 工具失败、有限修复及停止记录

本轮完成两款客户端静态研究，所有受限或缺失项按其真实影响记录。工具exit0只说明进程退出；初次unflutter无字符串/类恢复、历史doctor healthy、mock patch测试都没有被包装成完整逆向/解密成功。

## 尝试与处置

| 路线 / 可复核命令或位置 | 实际结果 | 原因、处置与停止条件 | 证据 |
|---|---|---|---|
| Go官方tar下载＋SHA；隔离go test/build | 成功；下载约551.7秒，未重复 | 原本无Go；官方工具链准备有授权，不全局安装，依赖校验后构建 | TOOL01 |
| unflutter原版 `--out …original --max-steps 10000000 App` | exit0 /15.16s；29605范围，0字符串/类/信号 | Snapshot现代ROData与PP header不匹配；保留结果，未称语义成功 | AOT03–AOT04 |
| 一组临时兼容补丁、RED→GREEN、patched go test/build | 成功；114pass/33skip、build0 | 修CID、delta、对齐/imageheader与PP显示映射；仅一次补丁组，有5新synthetic fixture；未改App | AOT03 |
| compat分析同一原App | exit0 /16.25s；业务候选/引用出现 | 范围与关键BL/bin另独立检查；未在同一路线继续补字段/THR | AOT04、INDEPENDENT_STATIC_01 |
| Dart源初次请求 cluster_snapshot.cc | 404 | 更正为官方app_snapshot.cc，一次路径修正；未换来源未知包 | AOT03 |
| Graphviz SVG | NOT_EXECUTED | 没有dot；已有HTML/DOT，不为装饰安装brew或阻断技术结论 | AOT04 |
| Hermes默认Python环境 | 未运行3.9不兼容安装 | 上游要求>=3.10，使用已安装bundled Python3.12.14；无pip/sudo | TOOL02 |
| hermes-dec上游2断言＋sample94/target96解析 | 全通过；完整disassembly exit0 /3.4s | 不执行bytecode；78MB汇编只存私有，使用函数/寄存器选择复核 | MFY01、TOOL02 |
| 自写HBC第一次分析关闭file后再seek | ValueError，1次查询失败 | 改为with文件句柄保持打开；随后静态读取成功；不是加密或版本不支持 | MFY01、MFY11–MFY12 |
| 自写edge查询假定BLR有target | KeyError，1次查询失败 | 改用可空target，保持间接调用Unknown；没有补造target | AOT20、AOT04 |
| root账本构建初次按ApiService类查imageToUrl helper | 一次ValueError | index表明helper是top-level；修正引用标签后通过，未伪造类归属 | AOT14 |
| 交付校验初次解析FORM相对源路径 | 8项SHA不符，验证FAIL | 相对路径错误指向主目录既有未提交文件；明确改为固定PR3干净副本路径＋Git路径/提交，保留失败记录后再验；原文件未改变 | FORM01–FORM04、FORM14–FORM20 |
| REA6.4.0 / Hopper历史Bridge | 旧结果provider_timeout/not_started/cleanup_incomplete | 新Hopper smoke NOT_EXECUTED；AOT/Hermes主线已完成，不重复加密Runner；doctor不是bridge就绪 | AUX04–AUX06、TOOL03 |
| MobHunt历史两个控制流修补 | 2/2 mock测试pass，exit0 | 仅离线：本地wrapper优先、非JSON--app后fallback；不执行FairPlay，未解密 | AUX01–AUX03 |
| luna_modyfy与luna_aot_verify | workspace credits耗尽，子任务未完整完成 | 留存partial日志；主线程接手只读分析，未反复派发；另一个分析者完成窄独立字节核验 | TOOL03、MFY13、INDEPENDENT_STATIC_01 |
| 两个MP4原件限定目录查找 | ORIGINAL_VIDEO_NOT_AVAILABLE | 不扫整个私人目录、不要求重录、不伪造二次看片；使用固定PR6时间线 | TOOL04、UX47 |
| Modyfy Mac运行失败 | 用户报告；本轮未启动/重装 | 静态Hermes仍可读；已有有限日志不足定根因；不改签名/平台检查/设备认证 | MFY11–MFY14 |
| Modyfy Android | 官方同身份Google Play来源可见；APK_NOT_AVAILABLE，NOT_EXECUTED | 本轮已有合法本地Hermes；未下载第三方APK/IPA或规避商店获取 | ASSET16 |

没有在同一失败路线连续重复两次后继续循环。解析补丁保留原版binary/结果、补丁、fixture、命令/exit/测试日志。所有脚本输出与原始文件权限在私有树内；已通过的工具测试没有被重复扩大成生产测试。

## 哪些结果可相信

原App四符号、load commands、SHA及选定原字节可靠；函数label来自snapshot metadata；只有选定业务的调用/数据流完成审阅。Range验证覆盖29,605范围，不能替代语义验证。Hermes范围验证覆盖29,188function ID，重复bytecode/async wrapper不代表29,188独立业务实现。[AOT01–AOT04、MFY01]

独立复核仅批准：3条raw BL、10个BIN与原App相符；ranges不重叠越界；正确的relative+0xe800坐标。未批准支付安全、worker幂等、所有模板语义或生图质量。FORM本轮只读固定PR3代码及已留存test报告，未重跑其应用测试；历史合成/CI报告不转为新的live evidence。[INDEPENDENT_STATIC_01、FORM05–FORM09]

Hopper用户报告的精确`Connection is invalid`未在可用文本中找到；保存日志能确认其他Bridge失败分类。差异保留，不补造原始报错。REA session可用不意味着Ghidra/IDA已配置或Hopper已连通。[AUX04–AUX06]

## 敏感输出与研究边界

一次本地业务汇编预览意外将内置配置值带入工具输出；随后停止原文预览，改为白名单属性/位置/长度/哈希摘要。该值未使用、未向外请求，**最终报告/Git不包含它**。发布前以本地真实配置值及私有长Prompt进行精确比对，零命中后才提交；不将“没使用”写成“安装包没有凭据”。[AOT10–AOT11、ASSET19]

未进行：App启动/重装、运行时注入、受保护dump、解密、内部API探测、私人照片上传、购买/试用、真实模型调用、部署/merge/支付接线。仅公开网页/官方源码用于来源/格式佐证，未访问内部endpoint。

## 剩余缺口与有价值的替代

1. 服务端有效Prompt、活跃remote config、生产模型/参数/workflow不在当前可信客户端证据中；不得猜。优先验证FORM自有固定profile，而不是探测竞品API。[QUALITY_UNKNOWN_MODY、QUALITY_UNKNOWN_MODYFY]
2. 没有授权照片与首次输出，保真/局部编辑/自动后处理均不能效果排名；252方案与12首图小实验仍未执行，预算0。[PLAN01–PLAN02]
3. 原始录屏缺失使视频复核停在二手资料；时间码是定位，不是生成延迟，成功付款/生图缺口保留。[UX42–UX44、TOOL04]
4. Mac故障阻断Modyfy新增runtime研究，未损害核心Hermes读取。若未来投入，正常支持的iPhone观察一次比不断修Mac更有信息价值；不绕过平台认证。[MFY11–MFY14]
5. Android可经合法商店/权利许可取得安装包后只读分析，但目前无APK、无哈希，不能从React Native跨平台结构假造Android业务结论。[ASSET16]

详尽输入/产物SHA、工具版本、命令与每条不能推断的内容见 [09账本](09_EVIDENCE_LEDGER.jsonl)；本地原日志位于 `private/logs/`、汇编与结构位于 `private/raw/`，公开Git不携带这些目录。
