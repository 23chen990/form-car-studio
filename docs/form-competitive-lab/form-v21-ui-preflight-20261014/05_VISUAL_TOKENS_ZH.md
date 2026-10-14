# V2.1 概念原型的可移植视觉参数（仅供 UI RFC）

源为之前完成的离线 `FORM_STUDIO_V2_1_OFFLINE.html`，`data/v21_visual_tokens.json` 记录其本地 SHA、主题变量和媒体查询。这里仅提取**设计 token**，不拷贝任何概念车图片/base64，也不把单 HTML 当成可接生产的 React 组件。

| token | 原值 | 建议作用 |
|---|---|---|
| `--bg` | `#070b0d` | 汽车工作室底色 |
| `--paper` | `#f5f8f5` | 主文字 |
| `--muted` | `#aab7b3` | 辅助说明 |
| `--quiet` | `#778985` | 低优先级 metadata，**对比度需在真实组件上验证** |
| `--accent` | `#cbf85b` | 单一高强调色，确认 CTA、选中态 |
| `--border` | `#ffffff25` | 半透明分隔边界 |
| `--panel` | `#171e21` | 底部弹层 |
| `--panel2` | `#222c2f` | 二级悬浮背景 |

原型中存在 `max-width:940px` 的“桌面展示板切至移动单屏”样式，以及 `max-width:359px` 的窄屏修正；正式 Capacitor WebView 不需要复制桌面假手机外壳。实际媒体查询、safe area、iPhone 小屏与 200% 大字号，应以 React 特性组件渲染测试决定。

**值得保留而不侵犯合同的布局：** 大面积实车照片、少量的顶部品牌信息、底部操作栏、带缩略图的 sheet、显式关闭/Apply、结果整车大图。但不能把概念图当用户车已修改的预览，不能以选择 UI 颜色代替真实生图。

**审批状态：** 若要将这些 token 或统一布局写入正式 `src/styles.css`/生产入口，必须先审批 S05 UI RFC，并确认 F13–F17 任务 allowlist 和最终 F32 接线的先后关系。未批准前，本设计只是可复用的视觉参考。
