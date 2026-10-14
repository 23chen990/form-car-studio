# FORM | 商业后端最小化与 Style+Extra+Color 请求合同（研究增量）

2026-10-14。研究分支的**只读决策资料与独立参考验证器**，不属于 Fxx 已批准生产源、不提交历史 PR3，不宣称已完成真实支付/生图/iOS/服务端接线。

- `SEC_BACKEND_MVP_STATUS_ZH.md`：说明需不需要后端、现有服务代码能复用什么、上线必须补什么、不必建什么。
- `SEC_S01_S02_API_RFC_ZH.md`：Style+Extra+Color 兼容请求合同、版本、源资产、报价、计费、审核与具体文件变更草案。
- `sec-build-intent.mjs`：纯离线研究版 `schemaVersion:3 / operation:'build'` 参数验证参考；**不验证真实 ownership/consent/provider、不计费、不生图、不注册路由**。
- `sec-build-intent.test.mjs`：31 条 Node 内置测试，覆盖旧 V2 不被悄然重解释、ID 白名单、色彩/改件、旧版本、模板版本、能力关闭、禁止自由文字/任意 URL。
- `TEST_LOG.txt`：容器 Node 22.16.0 的离线执行日志；正式项目 Node 24、完整 API/数据库/CI/设备验证尚未执行。

运行：`node --test sec-build-intent.test.mjs`

这是**替 Codex 完成部分离线研发**，不是让 Codex 重新做 31 条测试；如果下一步经 Owner 正式批准 S01/S02 变更，可复用语义和 fixture 并在 PR3 当前源码改成受 TypeScript 类型、持久化服务、权限和真实计价约束的代码。正式采用何种 schema/operation 仍以审批决策为准。
