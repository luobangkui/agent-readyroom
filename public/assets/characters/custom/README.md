# 木叶 Q 版人物资产与待命室适配

## 自然休息坐姿（2026-09-16）

鸣人、三代目、纲手和小樱在待命室与角色工作室的「坐姿」中共用 `src/assets/seated-life.js`：在原坐姿基础上编排 36 秒的呼吸、左右张望、低头思考和肩部放松。鸣人幅度稍大，三代目更沉稳；待命室按成员身份错开播放时间。骨盆与腿脚轨迹保持原接触校准，工作、起身和行走继续使用原动作，暂停会冻结休息动作。水影直接使用新 GLB 内置的坐姿动画。

该效果在加载时生成关键帧，不改源 GLB、贴图或下载文件；刷新页面即可加载更新。`test/seated-life.test.js` 覆盖前四人的动作幅度、循环接缝、手脚接触、独立时间、暂停和恢复工作。

当前完整人物：鸣人、三代目（猿飞日斩）、纲手、小樱、水影（照美冥）。前四人使用 18 关节办公骨架；水影使用新资产自带的 41 骨骼，以及行走、坐姿、同意三组原生动画。

| 人物 | GLB | 构建入口 | 面部贴图及原始 ImageGen 提示词 |
| --- | --- | --- | --- |
| 鸣人 | naruto_chibi_custom.glb | scripts/import-naruto-model.mjs | mingren GLB 内嵌的原始 PBR 贴图 |
| 三代目 | hiruzen_chibi_custom.glb | scripts/import-hiruzen-model.mjs | sandaimu2 GLB 内嵌的原始 PBR 贴图 |
| 纲手 | tsunade_chibi_custom.glb | scripts/import-tsunade-model.mjs | 用户 GLB 内嵌的原始 PBR 贴图 |
| 小樱 | sakura_chibi_custom.glb | scripts/import-sakura-model.mjs | 用户 GLB 内嵌的原始 PBR 贴图 |
| 水影 | mizukage_chibi_custom.glb | 直接使用用户提供的动画 GLB | 用户 GLB 内嵌的原始 PBR 贴图 |

预览页 `/naruto-preview.html?character=hiruzen` 支持通过「选择人物」切换五个模型，旋转、选动作、下载。动漫与木叶待命室顶部「换人物」均支持五个新模型及原四个 Styloo 模型；按成员保存浏览器本地选择，可恢复默认。默认老板是纲手；切换动漫与木叶场景保留人物选择，显示姓名随外观同步切换，底层会话 ID、职责和历史消息正文不改写。历史版鸣人和三代目 GLB 已清理，旧身份使用本目录的当前模型。

鸣人采用 `mingren.zip` 的新模型，复用小樱、纲手的办公动作流程。原始手与腿侧包存在粘连，导入时分离接触面并封口，保留原 UV、法线和 PBR 图片。运行时缩放 1，双手交替敲键盘；坐下、收手、起身与行走分别使用独立片段。

三代目采用 `sandaimu2.zip` 的完整 PBR 模型，源文件保存在 `assets/imports/hiruzen-sandaimu2-20260914/`。保留 657,157 个顶点、1,000,000 三角面、UV、法线和原始 PNG，新增 18 关节骨架及 6 个基础动作、4 个办公片段。双手通过手腕交替敲击键盘，起身前收手；新坐姿使用专属椅高，脚底保持 `.23` 高度。旧 GLB、Blender 文件、面部贴图、旧导入文件与专属旧生成器已直接删除。

重建：`node scripts/import-hiruzen-model.mjs`，同步 `src/assets/custom-cast.js` 中的 modelRevision / motionRevision 后运行 `npm run build`。验证：`node --test test/hiruzen-import.test.js`；浏览器证据及删除记录见 本地验收记录（未随公开快照发布）。

验证：`npm test`，`npm run build`。浏览器证据（四视角、办公替换与持久化截图）保留在本地验收记录中；`test/office-avatar-selection.test.js` 覆盖真实资产、快速替换竞态、活动保持、骨骼隔离和接触范围。

## 鸣人 mingren 导入版（2026-09-14）

源文件为 `assets/imports/naruto-mingren-20260914/base_basic_pbr.glb`。保留 21,081 个原顶点和三张原图，仅将 64 个手包粘连面替换为 68 个封口面，最终 37,496 三角面。主网格和修补网格共同跟随 18 关节，包含 6 个基础动画和 4 个办公片段。

原始 GLB 变化后运行 `python scripts/classify-naruto-hand.py`（需要 Pillow），随后 `node scripts/import-naruto-model.mjs`，同步 `src/assets/custom-cast.js` 的 modelRevision / motionRevision 并构建。源文件和手部分区缓存通过 SHA-256 对应，原图片字节不重绘。旧鸣人模型已覆盖，旧面部贴图与生成器已直接删除。

验证：`node --test test/custom-naruto.test.js`；预览 `/naruto-preview.html?character=naruto`；浏览器证据及删除记录在 本地验收记录（未随公开快照发布）。

## 纲手 PBR 导入版（2026-09-14，当前老板默认）

`gangshouglf.zip` → `assets/imports/tsunade-20260914/base_basic_pbr.glb` → `scripts/import-tsunade-model.mjs`。保留完整 36,392 三角面和三张原始内嵌 PNG，添加 18 关节办公骨架，站高约 2.23，运行时缩放 1。模型源文件没有骨骼或动画。以肩、肘、腕骨骼和接缝平滑权重适配宽袖；工作时双手交替敲击键盘，保留原手型，没有独立手指关节动画。办公动作保留独立 UUID，支持入座、打字、收手、起身的正确切换。

旧模型、独立面部贴图与旧专属生成器已清理；不要使用旧办公动作生成器覆盖导入版。构建输出 modelRevision / motionRevision 需同步到 `src/assets/custom-cast.js`。验证：`node --test test/tsunade-import.test.js`；浏览器截图保留在本地验收记录中。

## 小樱 PBR 导入版（2026-09-14）

`xiaoyingglf.zip` → `assets/imports/sakura-20260914/base_basic_pbr.glb` → `scripts/import-sakura-model.mjs`。原文件没有骨骼与动画；保留完整 19,875 顶点、34,658 三角面、UV、法线和三张原始 PNG，添加 18 关节骨架和办公动作，站高约 2.22，运行时缩放 1。

保留原握拳造型，工作状态为手腕交替动作，不包含独立手指动画。脚踏前移 `.05`，鞋底位于 `.23` 高度。旧自建贴图与专属生成器已清理；构建输出的 modelRevision / motionRevision 要同步至 `src/assets/custom-cast.js`。

验证：`node --test test/office-avatar-selection.test.js`，检查几何与贴图保真、动作、切换以及手脚接触。浏览器截图保留在本地验收记录中。

### 小樱打字动作复用（2026-09-14）

小樱与纲手共用 `scripts/office-typing.mjs` 的左右交替敲击节奏和办公片段 UUID 生成。小樱保留已有的 18 关节骨架，双手朝下，以手腕驱动约 `.027` 的抬落幅度，并按原蒙皮手部顶点校准键盘接触。独立 UUID 修复了状态已切到打字、实际仍播放坐姿的问题；坐姿、打字、收手起身、行走可以正常切换。原网格与 PBR 贴图保留。测试覆盖坐姿进入打字、双手交替、脚部稳定和往返行走，浏览器证据保留在本地验收记录中（未随公开快照发布）。

## 水影自带骨骼动画版（2026-09-16）

`anime+character+3d+model.glb` 直接替换为 `mizukage_chibi_custom.glb`。模型由 Tripo 导出，包含 987,634 个顶点、1,880,236 个三角面、41 个骨骼和三张内嵌 PBR 贴图；原生动画为 `preset:biped:walk`、`preset:biped:sit`、`preset:biped:agree`。

待命室运行时将模型缩放到 3，以坐姿在等距待命室里的可见体量对齐现有 Q 版角色；水影专属椅子纵向放大到 1.55，模型向椅背移动 `.67`，使髋部落在椅面而不是悬在桌前。行走片段的前进根位移会转成原地步态，交由场景寻路控制实际位移。坐姿直接使用模型自带片段；交流、倾听和任务完成反馈使用同意动作。模型没有映射敲键盘动作，工作状态保持坐姿。旧水影源 GLB 和外置办公动作 JSON 已删除。

替换模型时同步 `src/assets/custom-cast.js` 的 `modelRevision` 和 `public/assets/characters/custom/mizukage-custom-manifest.json`。验证：`node --test test/mizukage-import.test.js`；预览 `/naruto-preview.html?character=mizukage`。
