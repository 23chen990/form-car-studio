# FORM：做赚钱的 AI 汽车 App，需要多大的后端？

**Owner 决策建议：保留现有 Node 24＋Express 5＋SQLite 后端，部署一套能持久运行的服务；不要从零重写，更不要引入新微服务／自托管 GPU／每次先调用 LLM。**

**证据快照：** GitHub PR #3 HEAD `758477e0d1b6a358006357b586ec7917a5dd4e26`，2026-10-14。`29/39 CODE_READY_OFFLINE` 是离线模块代码就绪，而非生产接线、上线、模型付费调用或真实 StoreKit 验证。V2 仍保持未挂主入口直到 F32；`server/app.ts` 旧版入口与新 V2 模块不能混称已生产启用。

## 1. App、后台、外部服务的职责

| 层 | 做什么 | 为何要这样分 |
|---|---|---|
| iOS React/Capacitor | 照片本地预览、风格/改件/颜色选择、报价展示、作品浏览、系统购买 UI | 负责体验，不可作为支付与模型密钥的权威来源 |
| 单体 Express 后端 | 用户权限/私有资产、Style+Extra+Color 白名单、服务器端 Prompt、冻结报价、积分账本、任务幂等、失败补偿、Apple 交易校验 | 防止客户端伪造价格、积分、模型配置或读取其他用户照片 |
| SQLite＋持久化文件/对象存储 | 用户/项目/版本/任务/积分/购买元数据和私有原图/输出 master；定期备份/恢复 | App 重启和用户换设备也要能恢复自己真实的权益与作品 |
| 第三方生成供应商 | 按已经确认的一个任务编辑汽车图 | 不需要自己部署图像模型、训练 GPU |
| StoreKit / Apple 服务端 API | 设备上支付、服务端确认交易与退款/撤销信息 | Apple 确认付款不应直接让 iPhone 修改服务器积分 |

**平台细节：** iOS 本地 StoreKit 可以校验 Apple 签名交易，但 FORM 使用**跨会话的积分余额＋云端生图**，服务端必须记录并约束一次性消费。Apple 官方 App Store Server API 支持交易查询、退款和通知（https://developer.apple.com/documentation/appstoreserverapi）；StoreKit 商品/沙盒可离线/测试环境验证（https://developer.apple.com/documentation/storekit/in-app-purchase）。不要把“Apple 技术上强制所有 App 自建交易服务器”作为断言；这是 FORM 业务需要。

## 2. 已有真实代码：不重写

| 已有代码/计划 | 已经是什么 | 还不是什么 |
|---|---|---|
| `server/v2/provider.ts` | 结构化 Provider 适配器、禁用/模拟/明确开启 live 的路径 | 没有真实模型质量证据；不应把 mock 当真钱调用 |
| `server/v2/plans.ts`、`server/v2/routes-plans.ts` | 当前 V2 接受 original/version、冻结计划、报价；`explore` preset 展开 | **不支持**完整 Style＋Extra＋Color 的 `build` 合同；`explore` 的任意 overrides 报错 |
| `server/v2/worker.ts`、`server/v2/routes-tasks.ts` | 后台任务/结果与提交、恢复接口的离线实现 | 当前尚未正式挂在 App 主入口，真实服务部署/成本边界未验收 |
| `server/v2/purchases.ts`、`server/v2/routes-purchases.ts` | Apple 签名交易、catalog/验证、账本离线实现 | 还需 Apple 实际配置、StoreKit 与 F32 真实绑定/退款端点审核 |
| `server/v2/schema.ts`、`wallet-repo.ts` 等 | V2 存储、ledger 规则、用户与版本模型 | 有表不等于所有项目、草稿、车库路由已存在或已部署 |
| `src/features/discover`、`editor`、`result`、`garage` | F13/F14/F16/F17 组件与合成浏览器测试 | 不是真实客户从生产入口走通的持久化流程 |

**已知薄弱环节：** S02 规定的 `GET /bootstrap`、`GET project/versions`、`PUT draft`、`PATCH version favorite/name`、`PATCH project cover/name`、`GET wallet` 等绑定曾在 PR #9 完成只读预检，缺失范围和变更归属仍需正式审批。避免 Codex 在 F32 “薄接线”阶段临时写大段 SQL／服务仓储代码。

## 3. 真正需要上线时支付的一些基础设施，不必早期过度开发

第一阶段只需：一个稳定的 Node 24 HTTPS 进程（含受控任务执行）、一个可靠单写者的 SQLite 持久化卷与完整备份恢复、独立私有图片存储、环境密钥及轮换、有限成本/请求速率、任务与退款日志。按 S02 严禁未经测试的多写者复制，SQLite WAL 备份要包括一致性，不可仅复制运行中的单个 .sqlite 文件。

不需要：自己训练/部署 AI 图像模型；Kubernetes；多地微服务；自研消息队列替代现有持久化任务；每个用户请求增加一次额外 LLM；首发同时支持订阅、无限自由文本和复杂多选。

**不要混淆：“有后端代码”与“后端已经能营业”。** 正式开放收费还依赖实时模型能力与真实成功率、Apple 交易验证/退款、密钥、实际部署、审计/隐私/许可、设备和生产接线审批。

## 4. 让 Codex 专注在哪里？

- **优先 Codex/Mac：** F18 Capacitor/Xcode 项目、最小 iOS plugin 注册和真实模拟器 build；F19 HEIC/iCloud/photos 保存共享、F21 Keychain/Apple 登录、F24 StoreKit/Sandbox、证书/签名/真机测试。这些需要 Mac/Xcode/iOS SDK 与用户 Apple 账号实际权限，难以由没有该环境的研究容器完成验证。
- **我可独立先承担：** S01/S02 最小兼容 RFC、请求白名单、冲突与色彩优先规则、版本化 Prompt 组合、Node 测试、接口缺口审计、纯代码覆盖、商业成本表、质量评测方案。研究代码先留 Draft，不抢占 Codex 正在写的 F18，也不把未经批准的代码塞进 PR3。
- **授权后任何一方均可编码：** Express/SQLite 的缺失读写路由、Profile/plan/request 新模式、CI Node 集成测试。**这类工作不是 Codex/Mac 专属，我前面整体交给 Codex 并不精确。**

## 5. 快速赚钱的路线，不是继续逆向

1. 合同确定：1 Style＋0/1 Extra＋1 Color，零自由文本；唯一报价/一次生成；已发布能力与实际质量一致。
2. 通过极少量授权照片受控验证至少一个真实有购买吸引力的改装组合；输出严重换车、几何/轮胎错误就不开售。
3. 用现有 V2 单体后端完成私有上传→报价→签名购买→一次任务→真实作品→积分流水与失败补偿；下沉到 F32 的接口缺口必须有明确任务归属。
4. Apple 沙盒、真机、版权/隐私及独立审核完成后再收费；准确追踪供应商调用成本＋失败重试＋购买费用与退款成本。

**资料状态：** 该文档和同目录 parser 是设计/离线实验，不是修改冻结规范、部署或真实 Apple API 调用的授权。
