# CHANGELOG
## 第 0 轮（2026-10-15）
- 建立反馈闭环：goal/build.sh 一键在 Mac 构建并下载 5 个固定视角（aerial/top/otemon/tenshu/eastwall）。
- 首次全流程测试通过（构建约 3 分钟含同步）。eastwall 相机原在陆地内部，已移到内堀东侧水面上（第 1 轮需确认）。build.sh 每次先 pip install shapely 等（沙盒重置后会丢包）。
