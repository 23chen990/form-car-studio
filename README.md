# FORM — Your car, reimagined.

面向普通车主的汽车外观创作应用。本地可运行的 React / TypeScript / Vite 前端、Express API 和 SQLite 持久化已接通，界面采用英文，支持桌面和手机浏览器。

## 当前体验

Discover → 风格详情 → 上传、相机或示例车 → 确认生成一张 → 保存、微调、比较与导出。

- 八种方向：Street Sport、Clean Upgrade、Dark & Refined、Modern Classic、Track Inspired、Retro Rally、Grand Touring、Color Forward。支持 Subtle / Sporty / Expressive 筛选及收藏风格。
- 微调支持车身与轮毂颜色，包含 Keep current、撤销、重置、变更清单、草稿恢复与离开确认。选择参考色不会改动主图或创建生成任务。
- 成功图片进入版本历史；基于旧版本微调会保留真实父版本。可收藏、重命名、返回历史、确认删除车辆。
- 前后对比可拖动，也支持键盘方向键；导出 PNG 原图、1080 × 1920 壁纸、前后对比图，保持完整车身。
- 服务端处理重复确认、单活跃任务、额度预留/结算/返还、取消以及中断恢复。弹窗内显示失败原因；草稿保存失败可直接重试，任务失败可重新确认同一请求并记录来源关联。

## 启动

需要 Node.js 24 或更新版本。本项目使用 Node 内置 `node:sqlite`；当前 Node 可能显示 experimental 提示。

```sh
npm ci
npm run dev
```

打开 <http://127.0.0.1:5173/>。API 在 <http://127.0.0.1:3001/>，Vite 代理 `/api`。

默认使用 demo 模式，不需要密钥。可选配置：将 `.env.example` 复制为 `.env`；服务端启动时读取它。修改 `.env` 后重启服务。

要运行构建后的版本：

```sh
npm run build
npm start
```

此时访问 <http://127.0.0.1:3001/>。监听仅绑定本机，适合本地体验。

## Demo 与真实生成

demo 使用项目原有的 Golf 照片，服务端仅对该示例车的车身和轮毂做确定性的颜色研究。八张封面来自同一张照片的不同配色，界面标为 **Demo color study**；它们用于体验流程，不能代表八套经过验证的配件改装案例。

用户照片可以上传、验证并保存，demo 模式下不会对上传照片伪造 AI 生成效果。首次会话得到 12 个演示额度；收藏、看参考色、比较与导出不消耗它们。

live 模式已实现兼容 `/images/edits` 的服务器适配器。使用明确支持上传图片编辑、返回 `data[0].b64_json` 的模型，设置例如：

```dotenv
FORM_MODE=live
FORM_DATA_DIR=data-live
FORM_INITIAL_CREDITS=5
IMAGE_API_KEY=your-server-side-key
IMAGE_MODEL=your-image-edit-model
```

`IMAGE_BASE_URL` 可指向兼容服务，默认为 `https://api.openai.com/v1`。模型名由运营方明确配置，不写死。八种方向各有独立提示词；首次探索使用原始照片，微调使用用户选中的已保存图片。密钥不会发往浏览器。

live 默认给新会话 0 个额度，`FORM_INITIAL_CREDITS` 只影响新会话。切换模式时使用独立数据目录，避免混用演示数据和余额。这里的额度是内部记账，尚未接入付款或购买功能。真实供应商生成可能收费，取消已开始的请求并不保证撤销供应商费用。

真实服务接口通过替身测试验证；本轮没有调用付费模型，实际车辆身份保持、改装效果和成功率仍需用真实照片评测。

## 数据与边界

- 数据保存在 `FORM_DATA_DIR/form.sqlite`，包括图片、草稿、版本、任务、额度流水和问题反馈。
- httpOnly、SameSite=Strict cookie 对应私有浏览器会话。相同浏览器会话可在刷新或服务重启后恢复；清除 cookie 不会自动迁移、删除或恢复旧会话数据。尚无账号登录和跨设备同步。
- 仅接受单张 JPEG / PNG / WebP，文件不超过 10 MB、解码不超过 4000 万像素；校正方向、移除元数据，保存最长边不超过 2400 px 的 PNG。
- 取消后不收录迟到结果；失败或取消只返还一次内部额度。live 处理中断重启会进入 uncertain，随后在有限等待后失败返还，不自动重发上游请求。
- 目前提供拍照建议和文件检查，未实现车型识别、自动照片质量判断、配件适配、购买支付或生产账号体系。

## 验证与素材

```sh
npm test
npm run test:e2e
npm run build
```

浏览器测试使用临时 SQLite 数据和独立端口 3002 / 5174。首次安装 Playwright 浏览器可运行 `npx playwright install chromium`；也可通过 `FORM_TEST_CHROMIUM` 指向已有 Chromium。

测试覆盖重复提交、私有资源、草稿/版本恢复、真实基础图传递、失败返还、取消后迟到输出、比较拖动与键盘操作、手机布局和无生成导出。

`npm run assets:demo` 从原示例图重建八张配色封面。服务运行时，`node tools/capture.mjs` 生成桌面、手机、微调和比较截图到 `artifacts/`。该脚本会在自己的浏览器会话创建演示数据。

## 代码与开源复用

`src/` 是页面及交互，`shared/` 定义类型与风格，`server/` 负责持久化和生成，`tests/` 包含服务及浏览器验证。

- [开源选型与适用范围](docs/OPEN_SOURCE.md)
- [API 契约](docs/API.md)
- [原产品需求文档](docs/PRD.md)：保留原始基线；本轮的八种方向扩充以 `shared/catalog.ts` 为准。
- [第三方声明](THIRD_PARTY_NOTICES.md)：包含已使用库的原始许可证；前端声明随构建保存在 `/third-party-notices.txt`。
