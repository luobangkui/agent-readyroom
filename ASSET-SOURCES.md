# 人物资源与接入进度

> 许可提示：本文件记录的人物模型、贴图与概念图属第三方素材，**不在仓库根 [LICENSE](LICENSE) 的 MIT 范围内**；代码可自由复用，素材请按下方来源说明当作本地学习材料。

风格方向：用户选定「精致 Q 版／手办比例」。当前老板默认为 Q 版纲手（用户提供的新 PBR 模型），人物外观可分别选择并在浏览器保存。

## 2026-09-15：水影新增照美冥模型

来源：`1aef8e59-e49a-4bfb-9950-ffa2999a4ea9.zip` 内的 `base_basic_pbr.glb`，原始 PBR/shaded 两版保存在 `assets/imports/mizukage-20260915/`。采用完整单人物网格：398,689 顶点、500,000 三角面，保留原 UV、法线及三张内嵌 PNG；源 SHA-256 为 `49d7aeaace3a58edebbb3156f8c77be74456f7d527a50fe5160a092637282efe`。源文件没有骨骼和动画。

同一路径在 2026-09-15 晚被用户提供的更新版覆盖：三角面数不变，顶点由 406,404 降到 398,689（拓扑更干净），baseColor 贴图由 2048² 升到 4096²（normal 与 metallicRoughness 仍为 2048²）。旧版源文件按用户要求直接删除替换，回滚依靠 Git 中上一版 `mizukage_chibi_custom.glb`。

源姿势双臂不对称（左臂下垂、右臂抬起），红色长发贴近袖口。`python scripts/classify-mizukage-regions.py`（需要 Pillow）按肩-肘-腕路径划分两臂顶点，用漫反射贴图像素排除红发、按肤色框出手部，输出以源文件哈希校验的 `body-regions.json`；`node scripts/import-mizukage-model.mjs` 据此添加 18 关节蒙皮，把双臂重映射到肩、肘、腕关节，长发与发饰整体绑定头部。长袍下摆在腰部混入骨盆权重，两条裤腿独立迈步。动作包含待机、行走、入座、坐姿、起身、打字；打字为双手交替敲击（左右静息高度不同，按相位交替），脚底保持在 `.23` 高脚踏。站高约 2.24，待命室运行时缩放 1.18。临时 raw 检查副本（`mizukage_raw.glb` 与 raw 预览页）已删除。

**行走接地与步态（2026-09-15 两轮修复）**：此角色髋 `.732`、踝 `.124`、腿长仅 `.611`，静止姿势就是直腿，因此用 IK 够地面必然被截断——上一版就是这样出现脚浮空、穿地（最深 `-0.28`）和"走起来很怪"。现在改为直接驱动腿部：鞋底水平贴地前后摆动、摆动相抬脚、髋部承担起伏与重心转移，站立 68% / 摆动 32%，两脚相差半周期，保证任一帧至少一只脚着地；`reach()` 改为迭代 4 次（父骨转动后重新测量，踝误差从 `.18` 降到 `0`）；靴底接触点改为在旋转后的坐标系里取最低点（此前算错最多 `.19`）。髋部高度曲线用位移法求解：导出后用发布的蒙皮量每帧最低鞋底，把残差加回曲线重建片段，迭代到每帧最低鞋底落在 `.23`（收敛 `< .002`）。实测：鞋底最低 `.2291/.2290`（地面 `.23`），穿地 `< 1 mm`，抬脚 `.086/.088`，无双脚离地帧。速度取实测承载位移 `.45 u/s` 写进 `meta.walkSpeed`，`scene-director.js` 按模型自带速度平移。可用 `WALK_*` 环境变量覆盖调参，`scripts/walk-measure.mjs` 报告上述指标。

重建：先重跑分类脚本再运行导入脚本，同步 `src/assets/custom-cast.js` 的两个 revision 并 `npm run build`。验证：`test/mizukage-import.test.js`；浏览器证据保留在本地验收记录中（未随公开快照发布）。

## 2026-09-14：鸣人替换为 mingren 新模型

来源：`~/Downloads/mingren.zip` 的 `base_basic_pbr.glb`，原始 PBR/shaded 版本保存在 `assets/imports/naruto-mingren-20260914/`。保留原始 21,081 个顶点、UV、法线及三张内嵌 PNG；只分离手与腿侧包粘连的 64 个面，并添加 68 个封口面，避免抬手拉出三角片。最终 37,496 三角面，主网格与修补网格共用原 PBR 材质。

与小樱、纲手共用 `scripts/office-typing.mjs` 的敲击节奏和动作 UUID、`smooth-imported-arm-weights.mjs` 的接缝权重平滑，以及既有 `RiggedMotion`/工位接触流程。新增 18 关节和 6 个基础动作、4 个办公片段，运行时缩放 1；手部交替敲击，脚底保持 `.23`，腿侧包跟随大腿。旧自建 GLB 已覆盖，旧面部贴图和旧专属生成器已删除，清单保留在本地验收记录中（未随公开快照发布）。

重建：输入变化后先 `python scripts/classify-naruto-hand.py` 生成按源文件哈希校验的手部分区，再 `node scripts/import-naruto-model.mjs`；同步 catalog 的两个 revision 并 `npm run build`。验证：`test/custom-naruto.test.js` 与 本地验收记录（未随公开快照发布）。

## 2026-09-14：三代目替换为 sandaimu2 新模型

来源：`~/Downloads/sandaimu2.zip` 中的 `base_basic_pbr.glb`，原始 PBR/shaded 两版保存在 `assets/imports/hiruzen-sandaimu2-20260914/`。采用完整单人物网格，657,157 顶点、1,000,000 三角面，保留原 UV、法线及三张内嵌 PNG；源 SHA-256 为 `b2172349f3204e36930d5caf5cd4c8bf7b7ef4cf83acaa2a1f58c0c42994b2c4`。

`node scripts/import-hiruzen-model.mjs` 添加 18 关节蒙皮和待机、行走、坐下、坐姿、起身、打字动作。手腕驱动双手交替抬落，按真实手部顶点校准键盘；沿用共用的打字节奏和独立动作 UUID。坐姿针对新模型的短躯干调整椅子高度，脚底保持在 `.23` 高脚踏。运行时缩放为 1，模型站高约 2.24。

旧版发布资产已覆盖；旧三代目 GLB、Blender 文件、旧面部贴图、旧导入源和专属旧生成脚本直接删除，不留旧模型备份。删除清单保留在本地验收记录中（未随公开快照发布）。来源与版本见 `public/assets/characters/custom/hiruzen-custom-manifest.json`；测试为 `test/hiruzen-import.test.js`，浏览器证据保留在本地验收记录中（未随公开快照发布）。重建后同步 catalog 的两个 revision，并运行 `npm run build`。

## 2026-09-10：木叶人物选择与旧版清理

木叶与动漫待命室共用当前八个人物选项及办公动作适配，切换场景保留人物选择。木叶老板默认使用当前纲手，历史身份 `naruto`、`hiruzen` 解析为 `naruto-custom`、`hiruzen-custom`。

已移出发布目录的历史文件：`public/assets/characters/konoha/naruto.glb`（SHA-256 `02879bb61b2ce390059cb4d2a7910a45e98a8bb1918a35c2dca06d4ddb38df03`）、`public/assets/characters/konoha/hiruzen.glb`（SHA-256 `e724f7d89a4e24c297cbf07416764b2993b400a4270de3460546cbfe6d9aecba`）。旧资源目录与生成器不再列出或生成这两项；当前 `custom/` 模型、贴图和动作继续保留。

## 2026-09-14：纲手替换为用户提供的新 GLB

来源：`~/Downloads/gangshouglf.zip` 中的 `base_basic_pbr.glb`，原文件保存于 `assets/imports/tsunade-20260914/`。采用完整单人物网格：20,860 顶点、36,392 三角面、三张原始内嵌 PNG；没有复用旧模型网格或面部贴图。源文件无骨骼和动画，导入时添加 18 关节蒙皮和待机、行走、坐姿、入座、起身、打字片段，高度约 2.23。

新增肩、肘、腕绑定，按 UV 岛区分衣袖与衣身，并平滑接缝权重。工作时双手朝下交替敲击键盘，保留原手型，不包含独立手指关节动画；椅子与脚踏前移 `.20`，脚底保持与 `.23` 高脚踏接触。办公片段使用独立、稳定的 UUID，避免状态切换时复用错误动作。默认老板与已保存的 `tsunade-custom` 身份直接加载新模型，并更新内容哈希避免缓存旧版。

旧发布 GLB、动作和 manifest 已被替换；旧面部贴图、Blender/Three.js 源模型、专属旧生成脚本和对比截图已删除。旧纲手对比链接转到当前预览。历史测试证据保留在本地验收记录中，不随页面发布。

重建：`node scripts/import-tsunade-model.mjs`，随后更新 `src/assets/custom-cast.js` 的两个 revision 并运行 `npm run build`。来源及校验值见 `public/assets/characters/custom/tsunade-custom-manifest.json`；几何、贴图、脚底、循环和状态切换验证见 `test/tsunade-import.test.js`。

## 2026-09-14：小樱完成新 PBR 模型替换

来源：`~/Downloads/xiaoyingglf.zip` 内的 `base_basic_pbr.glb`，与 `assets/imports/sakura-20260914/base_basic_pbr.glb` 逐字节一致。源模型为单一静态人物，完整保留 19,875 顶点、34,658 三角面、UV、法线和三张内嵌 PBR PNG，新增 18 关节蒙皮与 6 个基础动作及 4 个办公片段。站高约 2.22，运行时缩放为 1。

补齐模型及办公动作的缓存版本，使已保存的 `sakura-custom` 选择直接显示新外观。手部保持原始握拳造型，以手腕交替动作表现工作，不包含独立手指动画。脚踏前移 `.05`，鞋底稳定落在 `.23` 高脚踏内；手部在键盘区域交替抬落。旧自建面部贴图、专属生成脚本和旧对比截图已清理，旧对比链接改为跳转当前预览。

重建：`node scripts/import-sakura-model.mjs`，将清单中的 modelRevision / motionRevision 同步至 `src/assets/custom-cast.js`，再运行 `npm run build`。`test/office-avatar-selection.test.js` 验证完整源几何与贴图、18 关节权重、10 个动作、模型切换、脚踏与手部接触。浏览器证据保留在本地验收记录中（未随公开快照发布）。

## 当前使用：自建木叶人物与 Styloo 可选外观

老板默认使用用户提供的新 Q 版纲手（见上节）。鸣人、三代目、纲手和小樱使用 2026-09-14 导入的用户模型，水影使用 2026-09-15 导入的用户模型。共 9 种可选外观，角色 ID 与已保存选择保持兼容。

资产、提示词、构建命令及办公动作说明见 `public/assets/characters/custom/README.md`。新人物的入座、起身、坐姿与整手敲键盘用真实蒙皮几何校准；独立预览为 `/naruto-preview.html`。

## 保留：Styloo 原作四人套装

此前使用的 Styloo Chibi Characters merchant、student、archer、ninja 四个造型仍可在「动漫待命室」中选择。

- 作者页：https://styloo.itch.io/chibi
- 实际下载：https://store.godotengine.org/asset/styloo/chibi/ ，版本 v1.0，作者标注 CC0。
- 四个 `public/assets/characters/styloo/*pr.glb` 与下载 ZIP 中对应条目逐字节一致，模型网格、原贴图、骨架和作者动画没有重做。
- SHA-256 存在同目录 SOURCE-SHA256.json；原 Read Me 与 CREDITS 一并保留。
- 按作者建议采用 unlit 材质显示贴图，避免灯光冲淡颜色。
- 保留作者的 idle/walk 动画；新增坐下、坐姿、起身来自 CC0 Quaternius 动作库，按原角色骨架烘焙为独立 JSON。
- 脚踏在起身时收回，椅子和脚踏高度针对这套角色校准。

## 历史老板外观：用户提供的露琪亚 GLB

露琪亚原文件保留在 `public/assets/characters/styloo/rukia_chibi.glb`。文件由用户从 ChatGPT 对话下载后提供，SHA-256 为 `e59769e9a90f741f58fa00b5bda851e769c33d4f78480e044df6274ca666c6cb`。模型包含一个蒙皮网格、18 根骨骼、内嵌 PNG 贴图和 `Idle`、`Walk`、`Sit` 三个动画；此前将 `Sit` 复用于坐下、起身和打字状态；该基础模型未列入本轮已校准的选择器。

人物显示名跟随所选模型：鸣人、三代目、纲手、小樱、水影，以及原作外观的可可、小满、夏禾、阿澄。按用户要求，在运行时移除 hat 和 bag 网格节点，原始 GLB 文件仍完整保留。名字是前端人物显示名；原会话 ID、任务记录和历史文字不被改写。

复现动作构建：`node scripts/build-styloo-seating.mjs`；验证：`npm test`；部署本机页面：`npm run build`。

当前任务有三个真实会话，前三个人物对应它们。第四位是未分配任务的场景同事，只有名字展示和闲置活动，不添加后端任务、消息或进度。新增真实成员时，场景同事会让出工位。

## 旧版火影同人模型（保留回归）

`public/assets/characters/konoha/` 保留七个历史 GLB：佐助、小樱、卡卡西、雏田、鹿丸、我爱罗和鼬，供旧资源回归使用。历史版三代目与鸣人已清理。当前木叶场景使用 `custom/` 与 Styloo 的人物选择及办公动作。

基础网格和骨架来自 Kay Lousberg 的 CC0 KayKit Adventurers 1.0。项目内重新制作了发型、护额、火影笠、面罩、服装细节和顶点配色，导出为真正带骨骼的 GLB。它们是同人改造，不是下载的官方火影模型，也不是官方授权商品。

- 生成脚本：`scripts/build-konoha-models.mjs`。
- 原网格和原作者许可：`public/assets/characters/kaykit/`。
- 原始来源：https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
- 当前模型声明：`public/assets/characters/konoha/CREDITS.txt`。
- 模型文件更新时生成内容哈希，避免同一路径被旧浏览器缓存覆盖。

旧版待命室使用这些火影外观，角色的真实会话身份通过 avatarId 选择模型。有工位时工作/待机使用坐姿，交流离席先起身，返回后入座。专门的打字、阅读和喝咖啡骨骼动画尚未制作，这些状态目前使用基础坐姿或站立待机。

## 原始素材与调研记录


### KayKit Adventurers 1.0 — 基础网格和骨架

- 作者：Kay Lousberg。
- 原始仓库：https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
- 从作者公开仓库下载；模型、PNG 和原始 LICENSE.txt 保存在 `public/assets/characters/kaykit/`。
- 原许可 CC0，适用于基础网格和原始动画。Naruto 角色本身的权利属于相应权利人。
- 原文件每个有 75 个动画；火影改造版导出十个相关动画，不包含原冒险者武器外观。

### Quaternius — 后续动画重定向参考

- 作者页：https://quaternius.com/packs/universalanimationlibrary.html
- 已下载免费 Standard 的公开 glTF 转换版本：https://github.com/J-Ponzo/gltf-universal-animation-library
- 文件：`public/assets/animations/quaternius/`，许可证同目录。
- 实际文件有 46 个动画，包括 Sitting_Enter、Sitting_Exit、Sitting_Idle_Loop、Sitting_Talking_Loop。
- 与 KayKit 骨架不一致，当前预览没有进行重定向，不能把它当成已经兼容所有角色的动画包。

## 火影资源候选，尚未接入

| 角色资源 | 来源 | 已确认 | 未完成 |
| --- | --- | --- | --- |
| Q 版鸣人，Prince-Malik | https://www.cgtrader.com/3d-models/character/fantasy-character/anime-toon-mini-naruto-uzumaki-kid-ninja-character | 商品页 2026-09-08 标价 $5，作者标注带骨骼，有 glTF/FBX/Blend 格式 | 未购买；尚未验证骨架、权重、动画与实际质量 |
| Chibi Ninja Character Naruto，3d Eye Catcher | https://sketchfab.com/3d-models/chibi-ninja-character-naruto-b6d50b2196b84bc7b9cfb0ec6aabd272 | 21.4k 三角面，页面标注 CC BY；公开 API 标记可下载、动画数量 0 | 下载接口需要登录（401）；未取得文件，不知道是否有骨骼 |
| Hiruzen Hokage Clothes，LorisC93 | https://sketchfab.com/3d-models/hiruzen-hokage-clothes-753cebea37d942d78ebc0efa180aafda | 17.1k 三角面，页面标注 CC BY-NC；公开 API 动画数量 0 | 下载需要登录；比例与 Q 版鸣人未必匹配；未取得文件 |

不要绕过下载认证，也不要把未下载模型称为已经接入。独立上传者的许可声明不等于 Naruto 官方授权。

## 接口

`src/assets/rigged-model.js` 隔离模型来源、骨架克隆、动画名称与状态过渡。坐下和起身为一次性动画，起身结束后才能移动；循环动画负责待机和行走。实例销毁时释放 mixer 的骨骼绑定，缓存的源纹理/几何体继续复用。

主题选择器只保留暖木和木叶，不显示冒险者主题。人物预览页同样只展示火影角色。

### 小樱打字动作复用（2026-09-14）

小樱与纲手共用 `scripts/office-typing.mjs` 的左右交替敲击节奏和办公片段 UUID 生成。小樱保留已有的 18 关节骨架，双手朝下，以手腕驱动约 `.027` 的抬落幅度，并按原蒙皮手部顶点校准键盘接触。独立 UUID 修复了状态已切到打字、实际仍播放坐姿的问题；坐姿、打字、收手起身、行走可以正常切换。原网格与 PBR 贴图保留。测试覆盖坐姿进入打字、双手交替、脚部稳定和往返行走，浏览器证据保留在本地验收记录中（未随公开快照发布）。
