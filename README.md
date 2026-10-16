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

## 浏览器版（规则驱动 + 自检，web-r1）
在线：<https://htmlpreview.github.io/?https://github.com/changrong996-droid/osaka-castle-3d/blob/main/web/index.html>（也可直接用 GitHub Pages / 任意静态服务器打开 `web/index.html`）

不再在 Blender 里手放坐标：`web/site.js` 里是一份**声明式规格**，所有部件按引用定位，页面打开时现场生成并自检。
- **地形**：一张 1.5 m 高度网格，按顺序执行操作：曲轮台地填充 → 外堀外圈分离（在土桥颈处切开、洪泛，外圈归城下 0 m）→ 石垣扇勾配（多边形边=墙脚，按 0.22×高、≤6 m 内收）→ 建筑/墙体地基整平 → 土桥坡道（路面锁定，两侧石垣面）。水面格只允许被土桥改动。顶点色区分水底/石垣/碎石/草地/土色空堀/城下，陡坡在着色器里画错缝砌石。
- **部件规则族**：门挂在曲轮边上（建筑名/遗址点/方向 → 最近边，或二之丸外门 → 土桥最窄横截线）；坡道=“从门 X 到曲轮 Y”沿外法线射线求终点；枡形=门内侧方院+三面矮墙+二之门；土塀=沿本丸/二之丸每条石垣顶边内缩 1.5 m，遇门/坡道/橹/建筑留口；失传橹=遗址点吸附到最近石垣（近转角滑到角上，再推进到石垣顶内）；树按噪声成簇，西之丸庭园留草坪。所有部件用 `surfaceAt()` 落在表面上。
- **硬规则审计**（页面左侧面板，违规处标红）：H1 建筑贴地 |Δz|<0.1 m · H2 不重叠 · H3 墙底在台地顶 · H4 坡道两端同高且坡度≤30% · H5 每座门都有坡道/桥通到下一层、门洞通畅 · H6 不落水 · H7 曲轮高程符合规格 · H8 部件在所属曲轮内 · H9 水面只被土桥改 · H10 规格引用全部解析。
- **可复现**：视角/种子/失传橹开关写在网址 `#seed=1&lost=1&view=aerial&labels=1`。
- **测试**：`python3 tests/test_web.py`（headless Chromium：无控制台错误、审计=0、同一网址签名一致、5 个视角截图到 `web/shots/`）。数据更新后先跑 `python3 tools/make_webdata.py` 重新生成 `web/data.js`。
- 文件：`web/index.html` · `web/site.js`（规格+生成+审计，纯数据，node 可跑）· `web/app.js`（three.js 渲染/界面）· `web/tenshu.js`（丰臣式天守模块）· `web/data.js`（内嵌数据）· `web/vendor/`（离线测试用 three r160）。

![鸟瞰](web/shots/aerial.png)

## 运行（旧 Blender 流程）
```bash
python3 tools/extract_layout.py data/osm.json data/castle_layout.json
python3 tools/draw_plan.py data/castle_layout.json docs/site_plan.png
/Applications/Blender.app/Contents/MacOS/Blender -b --python blender/build_castle.py
```

地图数据 © OpenStreetMap contributors，ODbL 1.0。
