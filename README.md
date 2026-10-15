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

## 运行
```bash
python3 tools/extract_layout.py data/osm.json data/castle_layout.json
python3 tools/draw_plan.py data/castle_layout.json docs/site_plan.png
/Applications/Blender.app/Contents/MacOS/Blender -b --python blender/build_castle.py
```

地图数据 © OpenStreetMap contributors，ODbL 1.0。
