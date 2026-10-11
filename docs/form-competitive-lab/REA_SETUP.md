# REA 的可选隔离安装路线（首轮不用安装）

目标：REA 是按需证据分析插件，不是 FORM 的依赖，也不能取代 Playwright/Xcode/用户研究。

官方源码：https://github.com/morluto/rea
官方设置说明：https://github.com/morluto/rea/blob/main/docs/installation.md
Apple 分析声明：https://github.com/morluto/rea/blob/main/docs/apple-application-analysis.md
Web 观察：https://github.com/morluto/rea/blob/main/docs/browser-observation.md

核对版本：2026-10-11 的 rea-agents 6.4.0。**不是**允许自动下载任何同名 REA ZIP。REA 迭代频繁，要保存确切版本、工具目录和安装环境以保证可复查。

## 阶段 1：不改变 Codex 的只读预检查

- 准备与 FORM 开发隔离的用户/开发机/配置目录，确认 Node 支持版本（22.19+/24.11+/26+）、npm 与系统设备。
- 选择一个公共网页行为研究的问题，写明确预期证据，确认允许该分析且不涉及私有账户内容。
- 优先查公开资料和普通浏览器；只有需要真实多层代码或静态证据时，才考虑 REA。
- 审核供应链和访问范围。仅查询官方 README、版本发布及设置文档也可以做研究。

## 阶段 2：需要时再提出安装计划

在独立研究系统用户/环境中，经授权执行下列 **dry run**。它仍会执行下载的 npm 包代码，不能视为无风险：

    npx rea-agents@6.4.0 setup --client codex --dry-run --json

核查所有配置写入路径、MCP 工具权限、目标读取权限、会安装的软件及费用，再由负责人批准后单独执行安装。不要在负责 FORM 开发的 Codex user profile 上执行；若其在云端无法访问本机 MCP，也不要让它试图修复/绕过隔离。

无需原生分析时不要安装 Hopper/Ghidra/IDA；REA 网站与 JavaScript 模块分析的前置条件不同。即使工具安装成功，不等于可以获取第三方后端指令。

## 阶段 3：一次限时样本研究

对一项许可明确的公开网页做证据实验：记录用户可见功能、脚本/DOM 线索及明确未知；完成后导出必要脱敏证据和版本号，清理研究进程与本地私有材料。禁止上传完整 HAR、Cookies、令牌、客户照片、竞品私有代码。

## 阶段 4：独立复核与撤回

若 REA 未带来比手工网页或 Playwright 更好的决策证据，撤销安装计划/不再使用。研究 Agent 只有记录研究结论的职责，没有修改产品代码的权限。
