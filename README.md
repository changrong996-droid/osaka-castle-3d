# 大阪城 3D 复刻（Osaka Castle 3D）

在本地 Blender（Mac mini）中程序化复刻大阪城全城，导出 GLB，用浏览器离线浏览。

- **城郭布局**：现存德川期（1620–1629 再筑）城郭，护城河、石垣、门、橹按 OpenStreetMap 实测轮廓放置。
- **天守**：采用丰臣期（1585）天守的复原想象（黑漆壁、金箔瓦、五重屋顶），与 1931 年复兴天守的思路一致：德川天守台 + 丰臣式天守。

![总平面图](docs/site_plan.png)

## 目录
| 路径 | 内容 |
|---|---|
| `data/osm.json` | OSM 原始数据（Overpass 导出，ODbL） |
| `data/castle_layout.json` | 转为本地米制坐标（原点=天守，x 东 y 北）的护城河、石垣、建筑、遗址点 |
| `tools/extract_layout.py` | osm.json → castle_layout.json |
| `tools/draw_plan.py` | 生成总平面图 `docs/site_plan.png` |
| `tenshu/build_tenshu.py` | Blender 天守建模脚本（v0，已完成） |
| `blender/build_castle.py` | 全城建模脚本（进行中） |
| `docs/REFERENCES.md` | 史料与参考资料 |
| `docs/ROADMAP.md` | 分阶段计划 |
| `web/` | 浏览器版：规则驱动生成 + 硬规则自检（见下） |

## 浏览器版（规则驱动 + 物理自检，web-r2）
在线：<https://htmlpreview.github.io/?https://github.com/changrong996-droid/osaka-castle-3d/blob/main/web/index.html>（也可直接用 GitHub Pages / 任意静态服务器打开 `web/index.html`）

不再在 Blender 里手放坐标：`web/site.js` 里是一份**声明式规格**，所有部件按引用定位，页面打开时现场生成并自检。这不是有物理引擎的世界模型，所以“物理”写成**抽象的几何不变量**（支撑、接触/闭合、石垣边、通行、不穿插），生成时按构造满足，审计时用通用算法检查（支撑采样、接触图、栅格寻路），不针对具体部件写坐标。日本城郭的惯例（1 間≈1.97 m、角橹在石垣转角、土塀止于柱/橹/门、枡形=高丽门+直角渡橹门）只用来定参数。
- **地形**：1.5 m 高度网格，按顺序执行：曲轮台地填充 → 外堀外圈分离（在土桥颈处切开、洪泛，外圈归城下 0 m）→ 石垣扇勾配（多边形边=墙脚，0.22×高、≤6 m 内收；外圈专属的边不削内侧转角）→ 建筑/墙体地基整平 → 土桥坡道。水面格只允许被土桥改动。
- **防御线 = 一条闭合链（web-r2）**：本丸、二之丸（在土桥颈处用颈切线截断）各取外边界 → 逐边内缩 B 得到**石垣顶线**，再内缩 0.9 m 得到**土塀轴线**（斜接内缩 + 自交切除 + 按距离场修正深石垣端头）。门和建筑先占位，再沿轴线做“槽位序列”：被门/橹/建筑占住的区间之外**全部**是土塀，每段土塀的端头正好顶到相邻部件的面上，转角处斜接相连——不再是“先放建筑再在墙上开口”。
- **部件规则族**：门锚在实测位置/遗址点，吸附到所在防御线的石垣顶线（门外侧面与顶线齐平，门不跨转角，主柱立在土塀轴线上）；土桥颈上的门就在颈切线上；坡道从门洞中心沿外法线射出。现存橹（千貫/六番/一番/乾）按“面贴边”规则平移到外墙面与顶线齐平；失传橹吸附到最近石垣、近转角滑到角上，非直角转角时沿主边滑开、主面保持贴边。枡形：门内方院由射线碰到的建筑/防御线或默认 24 m 围出；三边石垣矮墙斜接，遇建筑/防御线截断（端头顶齐）；里门开在侧边与外门成直角——大手门穿过实测多门橹（门洞切开石垣台座），其余新建渡橹门（紧贴防御线或顶到后角，剩余墙段 ≥1 間）；方院太浅（京桥口窄颈）就加深。
- **审计**（页面左侧面板，违规处标红）：H1 建筑贴地 · H2 不穿插（墙端斜抵到面上的那一角算抵接，不算穿插）· H3 墙底在台地顶 · H4 坡道两端同高且≤30% · H5 门有坡道/桥 · H6 不落水 · H7 曲轮高程 · H8 在曲轮内 · H9 水面只被土桥改 · H10 引用全部解析；**新增物理规则** H11 **支撑**（每个部件整个底面、墙两面、树根都在台地顶/平地上，不悬空不压石垣斜面）· H12 **闭合**（防御线 0.5 m 采样全被土塀/门/建筑覆盖，墙端都在 0.2 m 内顶到墙端/门柱/建筑面，无 <1 間碎墙，枡形方院门关上后洪泛出不去）· H13 **石垣边**（离顶线 <3 m 的建筑外墙面与顶线齐平 ≤0.3 m，或退后但前面有土塀；外挑 ≤0.3 m）· H14 **通行**（0.5 m 栅格上从门洞出发，坡≤30%、净宽≥门洞，向外走到坡道/桥另一端、向内走到 45 m 外的曲轮地面；坡道轴线穿门洞中心且垂直于门）。用同一套 H11–H14 检查 web-r1 的布局会报 194 项（171 个悬空墙端、19 个石垣边留缝/外挑、3 座门内走不通）。
- **可复现**：视角/种子/失传橹开关写在网址 `#seed=1&lost=1&view=aerial&labels=1`；视角含两个接缝特写 `otejoint`（大手门枡形内）与 `sakura`（本丸桜门枡形）。
- **测试**：`python3 tests/test_web.py`（headless Chromium：无控制台错误、审计=0（江戸盛期/现状/换种子）、同一网址签名一致、7 个视角截图到 `web/shots/`）。数据更新后先跑 `python3 tools/make_webdata.py` 重新生成 `web/data.js`。
- 文件：`web/index.html` · `web/site.js`（规格+生成+审计，纯数据，node 可跑）· `web/app.js`（three.js 渲染/界面）· `web/tenshu.js`（丰臣式天守模块）· `web/data.js`（内嵌数据）· `web/vendor/`（离线测试用 three r160）。

![鸟瞰](web/shots/aerial.png)
![大手门枡形接缝特写](web/shots/otejoint.png)

## 运行（旧 Blender 流程）
```bash
python3 tools/extract_layout.py data/osm.json data/castle_layout.json
python3 tools/draw_plan.py data/castle_layout.json docs/site_plan.png
/Applications/Blender.app/Contents/MacOS/Blender -b --python blender/build_castle.py
```

地图数据 © OpenStreetMap contributors，ODbL 1.0。
