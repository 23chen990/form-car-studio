# 开源复用记录

2026-10-09 核查公开仓库元信息、已安装包和许可证。下面区分已经接入的代码与下一步可评测的生成方案。

## 已经使用

| 项目                                                                     | 锁定安装版本         | 许可证     | 在 FORM 中的用途                                                            |
| ------------------------------------------------------------------------ | -------------------- | ---------- | --------------------------------------------------------------------------- |
| [react-compare-slider](https://github.com/nerdyman/react-compare-slider) | 4.0.0                | MIT        | `src/components/Comparison.tsx`：拖动分割线、触摸和键盘比较；适配全车显示。 |
| [React / React DOM](https://github.com/facebook/react)                   | 19.3.0               | MIT        | 页面、草稿、版本和任务状态。                                                |
| [Express](https://github.com/expressjs/express)                          | 5.2.1                | MIT        | API、私有图片和本机构建服务。                                               |
| [sharp](https://github.com/lovell/sharp)                                 | 0.34.5               | Apache-2.0 | 图像解码、方向校正、尺寸限制、元数据清理和示例车配色。                      |
| [Lucide](https://github.com/lucide-icons/lucide)                         | lucide-react 0.468.0 | ISC        | 界面图标。                                                                  |

比较组件已实际接入并通过拖动、方向键和浏览器流程验证。组件本身不生成新图片；它使用私有的原图和已保存版本。

前端构建所包含的 React、React DOM、Scheduler、Lucide 和比较组件声明在 `public/third-party-notices.txt`；项目根目录另含直接使用的服务端库声明。npm 提供的运行依赖保留各自包中的许可证与声明。

## 图像编辑候选

| 项目                                                               | 仓库代码许可 | 可复用部分                                                    | 接入前需要完成                                                               |
| ------------------------------------------------------------------ | ------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Hugging Face Diffusers](https://github.com/huggingface/diffusers) | Apache-2.0   | 图片编辑、inpainting、ControlNet 等管线，适合后续自托管推理。 | 选定模型与管线，验证车辆身份保持、车轮结构和背景稳定，测量耗时、显存和成本。 |
| [Qwen Image](https://github.com/QwenLM/Qwen-Image)                 | Apache-2.0   | 图像编辑推理示例，适合评测整体风格及局部颜色修改。            | 针对具体 checkpoint 核查权重条款与资源要求；用多车型、多角度真实照片测试。   |

这两个项目未安装模型、下载权重或启动 GPU 服务。仓库代码许可与具体模型权重条款需要分别核查；不能将本轮 mock 接口测试视为模型质量验证。

FORM 的 `GenerationProvider` 接收基础 PNG、风格、修改意图、颜色目标和 AbortSignal，返回图像 Buffer。可将候选管线包装成服务后接到此接口，同时复用已有任务、取消、版本和额度逻辑。当前已接通的是兼容 multipart `/images/edits` 的适配器。

## 同类项目与素材

对 `AI car modification` 的公开仓库搜索中，部分结果属于性能预测、发动机诊断或配件交易，与 FORM 的视觉编辑流程不同；也有未声明许可证的示例。没有复制这些项目代码。

当前演示原图是工作区原有的 `public/images/street-sport.jpg`，来源于前期原型材料；本轮没有独立核实其对外发布授权。八种配色图沿用该素材，不作为新生成的独立改装案例。公开发布时应使用授权记录明确的素材，并保留 Demo 标注。
