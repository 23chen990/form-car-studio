# FORM AFTERHOURS｜新版 HTML 原型浏览器 QA 与 UX 自审报告

> 对象：`11_INTERACTIVE_PROTOTYPE.html`；SHA-256 `54b9315259f76c70158a1ddc66c3b416a7ddc56019917c70b1f9509b01071542`。
> 本次报告是**2026-10-15 当前新原型的实测**，与 PR #10 旧版的 34/34、12/12 及用户提供的旧版 11/11 都独立。未执行事项写 NOT RUN。

## 1. 测试环境与可复制执行

- Ubuntu/Debian 沙箱中 `Chromium 144.0.7559.96`、Python Playwright（系统 Chromium `executable_path=/usr/bin/chromium`）、Pillow。
- 驱动：`qa/qa_revised.py`；结果：`qa/qa_revised_result.json`；图像 fixture 用 `qa/create_fixture.py` 离线绘制。两张 `fixture_*.png` 是人工合成的**本地文件选择测试图片**，不是照片、不是授权的真实车辆案例、不是 AI 生成结果。
- 浏览器规格：外部 1400×1100；内部模拟机身 390×844，另外 320/375/430。`#phone` 截图为原设计尺寸 **2×**，例如 390→780×1688；375 截图去除了截图器出现的 1px 取整误差（不拉伸画面）。
- **环境限制**：本执行环境 Chromium 访问 `file://` 或 `http://127.0.0.1` 直接报 `ERR_BLOCKED_BY_ADMINISTRATOR`。测试使用真实 Chromium + `page.set_content(相同 HTML)` 注入至 `about:blank`，并仅为本地浏览器状态 API 添加 localStorage 测试 shim。鼠标点击、Sheet、键盘事件、文件选择、DOM 样式和图片解码是实际运行的浏览器交互；但不能声称已测 `file://` 正常打开或真来源 IndexedDB 重新加载。这个测试边界由报告明确保留。
- 复现建议：在有图形浏览器的普通电脑上打开 HTML 手动检验。若要跑自动化：`python -m pip install playwright pillow`，使用已安装的 Chromium 修改脚本路径，再运行 `python qa/qa_revised.py`；也可以修改驱动用普通 localhost origin 做真实存储复测。

## 2. 实际执行总结果

| 项目 | 结果 |
|---|---|
| 新版 Playwright 浏览器断言 | **142/142 PASS** |
| JavaScript 页面错误 / console.error | **0** |
| 真实本地文件 picker + PNG 解码 + Blob URL 图片展示 | PASS（合成测试图，不是汽车实拍质量研究） |
| Explore→Photo→Studio→Review→Task→Result→Compare | PASS（全部 demo，无 paid model） |
| Garage 选旧 V1 后再细化，生成 V2、V1 不覆盖 | PASS |
| Style/Detail 互斥 + Undo、Reset/Undo | PASS |
| 颜色改变只更新草稿、不修改本地图片 URL | PASS |
| 独立的两辆车、各自的草稿保存和恢复 | PASS |
| 数据失效时显示“Photo unavailable”，不替换成 generic 车型图 | PASS |
| queued 取消、失败返还一次、terminal 幂等 | PASS（demo credit only） |
| no-credit、offline、quoteFail、draftFail、activeTask 阻断 | PASS（demo quote only） |
| uncertain 在模拟 reload 后保持原 request ID、不自动判成功 | PASS（about:blank + storage shim） |
| 320 / 375 / 390 / 430 水平溢出与固定确认 CTA | 4/4 PASS，均 0px 水平溢出 |
| 真实 iPhone / Mac Xcode / WebKit / StoreKit / service / paid model / 8–12 人研究 | **NOT RUN** |

完整版机器可读清单见 `qa/qa_revised_result.json`（142 条明细），运行时出现过的测试脚本顺序/截图归一化问题均已修正，最终运行无 FAIL。

## 3. 42 张实际手机画面截图

位于 `screenshots/revision/`。共 26 张主路径/异常/跨车图片，以及 16 张四尺寸比较：

| 文件 | 内容 |
|---|---|
| `01_explore.png` | Explore 首屏、方向选择与安全的概念车辆插画 |
| `02_photo_guide.png`、`03_photo_selected.png` | 导入前指引；导入后真实本地文件预览 |
| `04_studio_own_photo.png` | 自己选的本地图片在工作台大画面出现 |
| `05_paint_sheet.png`、`06_studio_paint_selected.png` | 选择颜色；源照片像素不变，只改变草稿 |
| `07_review_own_photo.png` | Review Sheet 准确底图、报价模拟声明 |
| `08_task_queued.png`、`09_garage_task_active.png`、`10_task_completed.png` | 排队、离开后入口、完成演示 |
| `11_result_simulated_own_photo.png`、`12_save_disabled_explained.png`、`13_compare_simulated.png` | 不冒充模型输出、禁止伪保存、对比机制 |
| `14_refine_old_version.png`、`15_review_version_1.png`、`16_garage_versions.png` | V1 编辑、V1 作为来源、原图和两个版本并存 |
| `17_returning_car_picker.png` | 返回用户不需重复上传 |
| `18_no_credits.png`、`19_quote_unavailable.png`、`20_draft_error.png` | 额度/报价/草稿保存失败模拟 |
| `21_cancel_queued.png`、`22_task_failed.png`、`23_task_uncertain.png`、`24_task_uncertain_reloaded.png` | queued-only 取消、失败、未知状态与模拟重载 |
| `25_explore_{320,375,390,430}.png` | 四尺寸首页 |
| `26_studio_{320,375,390,430}.png` | 四尺寸 Studio |
| `27_sheet_{320,375,390,430}.png` | 四尺寸 Paint Sheet |
| `28_review_{320,375,390,430}.png` | 四尺寸 Review Sheet |
| `29_second_car_restored.png`、`30_missing_local_photo.png` | 第二辆车独立草稿与缺失源图的诚实恢复 |

以上来自 Playwright 真实 Chromium 截屏，并非静态 Figma 板式排版。图片大小由测试自动检查。

## 4. 实际 UX 复查与修复过程

- **已修复：320px 颜色抽屉遮盖整辆汽车**。在人工检查手机尺寸截图后，将 Paint Sheet 限到屏高约 51%，内容内滚动；车图在抽屉之上仍能看到主要轮廓。**剩余取舍**：320px 屏幕里颜色列表第二行需要手指向上滚动，这是小屏空间与图片可见性的平衡，需要真机车主测试。
- **已修复：跨汽车源图/草稿串台风险**。从 Garage 的源图入口进入 Studio + Source Sheet；切换车辆后恢复独立草稿，旧版本以精确 ID 关联。
- **已修复：会话丢失用户上传照片时的假象**。缺失本地 Blob 不再悄悄用设计样车覆盖，明示照片不可用，并允许重新添加。
- **已有保护继续保留**：任务单次结算、未知状态不自动重报、非 queued 不支持免费取消、确认阻断模拟失败。
- **待验证的主观项**：夜间工作室视觉是否高级而不阴暗？Style/Paint/Wheels 是否比 Change List 更自然？模拟结果没有真实改造像素，无法建立“持续付费值得”的真实心理证据。以上不可用 142/142 机械断言替代。

## 5. 明确的 NOT RUN 与不可宣称完成事项

1. 直接打开 `file://` 和真实 origin `IndexedDB` / 实际重启后的 Blob 恢复：**NOT RUN**（测试机导航受限；代码设计为尝试 IndexedDB，需在普通 Safari/Chromium 原生文件环境验证）。
2. HEIC、相机权限、iCloud 下载、内存压力、iOS Photos 保存、原生弹窗/安全区、VoiceOver、Dynamic Type、Switch Control：**NOT RUN**；Playwright 的 CSS 与点击不替代 iPhone。
3. 真实所有者/资源权限、CAS 草稿、真实 API 网络弱/断/重连、immutable quote 过期、真实钱包扣退、真实支付、模型供应商生成：**NOT RUN**，调用次数 0。
4. 真实牌照、驾驶人隐私、车身被裁、车色可信度、同车保真、首屏授权案例和对比成片吸引力：**NOT RUN**（不具备授权真实车辆生成素材）。
5. 8–12 名欧美目标车主任务测试/付费意愿研究：**NOT RUN**；不能说设计已经证实有效。
6. Safari iOS 真实软键盘、浏览器 `file://` 安全限制、长期离线草稿、真实多车图大量历史下性能：**NOT RUN**。

## 6. 进入生产的放行建议

本次结论只能是**原型可以进入目标用户和真机验证**，不是可以发布。下一轮需要 Owner 对交互契约和正式发布的 Style/Color 列表作决定、获授权真实同车案例、接现有 F12–F17 组件与真实服务端 quote/任务/图片/额度，另做工程与安全审查。禁止依照该报告直接合并 PR #10。