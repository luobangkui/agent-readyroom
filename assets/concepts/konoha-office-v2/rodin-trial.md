# Rodin 资产试生成

输入：`concept-empty.png`，SHA-256 `e96ac4307be4eecf07b85564de9f055e27a3f40e75258c3404000db4d1e29ab2`。

操作路径：用户指定的 Hyper3D Rodin 网页，通过已登录会话上传，无 API Key 配置。

任务：https://hyper3d.ai/workspace/rodin/b206d3e0-30e0-420f-bc6b-e8e7e513ba3b?lang=zh

设置：Image to 3D；Gen-2.5 (0913)；High；单结果；保持私有。网页自动生成的描述为 `Stylized open-plan Japanese-inspired gaming office interior.`。模型确认时选择不对称，保留参考布局。

首版观察：网页预处理后的材质参考与几何预览仅包含中央办公桌椅组合；墙、屋檐、花园、拉面角没有进入本次结果。这次应作为工位组合资产评估，不能标记为完整待命室重建。

官方资料：

- [Gen-2.5：模型、面数、材质、导出格式](https://docs.hyper3d.ai/en/api-specification/rodin-gen2-5)
- [图片转 3D](https://hyper3d.ai/features/image-to-3d)
- [BANG：已有模型拆分部件](https://docs.hyper3d.ai/en/api-specification/bang)

核对结论：GLB 与 PBR 可用于后续 Three.js 集成；生成后仍需检查网格结构、面数、材质与贴图，独立桌椅、碰撞范围、人物工位定位并不由概念图自动保证。BANG 拆分是后续可选步骤，本次暂未执行。

最终结果：网页模型和材质已确认，原始网格与四张实际 4K 贴图已保存至 `../../imports/konoha-workstations-rodin-20260916/`。实测为 27,396 顶点、44,222 三角面、1 个整体网格，尚未拆件。已本地组装 `workstations-shaded.glb` 并通过 Three.js 加载与几何一致性验证。

限制：网站整包下载未回传，因此保存的是网页实际模型资源与贴图；本地 Shaded 版不应描述成网站官方 PBR 导出包，PBR 通道配置留待核实。详情见该目录 README.md。

另已打开 WorldGen 并上传原图，保存为手动场景工作台 `https://hyper3d.ai/workspace/rodin/worldgen/5f29ae67-e607-401d-9199-ace95e59ec4d`；仅检查界面，尚未运行自动分割、额外物体生成或 3D Gaussian 环境生成。
