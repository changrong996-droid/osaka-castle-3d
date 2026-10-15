# 大阪城目标模式 runbook（项目 Osaka Castle 3D Model）
你是目标模式中的一轮，每轮是新会话，只靠本目录文件交接。仓库根：/workspace/projects/3dffd53e-9285-4461-aa69-4f5634f0e079/castle（下称 REPO）。先读 goal/GOAL.md、goal/state.json、goal/CHANGELOG.md、README.md、docs/ROADMAP.md。

## 工具
- 构建 + 取回反馈图：`REPO/goal/build.sh`（约 60–90 秒；会先跑 tools/make_terrain.py，再同步仓库到 Mac 的 ~/Hark/osaka-castle-3d 并用 Blender 无界面构建；视角图下载到 REPO/dl/）。若 shell 超时被转后台，用 wait_for_subagents 等它，不要重跑。
- 任意 Mac 命令：`REPO/goal/mac.sh '<命令，在 ~/Hark/osaka-castle-3d 下执行>' [相对路径 ...要下载的文件]`。
- 数据管线：data/osm.json → tools/extract_layout.py → data/castle_layout.json → tools/make_terrain.py（shapely，只在沙盒跑）→ data/terrain.json → blender/build_castle.py（exec tenshu/build_tenshu.py 复用几何工具：box/tube/skirt/roof/sphere/cyl/quad/tri/add_geo，材质 MATS）→ out/*.blend/.glb/views/*.png → tools/make_viewer.py viewer/template.html → out/osaka_castle_site.html。
- Blender 是中文界面：找节点按 type，不按名字。
- 若 rx.py 报 socks/代理错误：goal/mac.sh 会自动装 pysocks 并启动 tailscaled；仍失败读 /workspace/work/ts/relay/RUNBOOK.md。

## 每轮流程
0. 空闲与锁（任一成立就直接结束本轮、保持沉默）：state.status 不是 running；goal/.lock 存在且不到 40 分钟；本项目对话日志 /workspace/projects/3dffd53e-9285-4461-aa69-4f5634f0e079/.hark/journal/ 最新 *.jsonl 里最后一条 role=user 消息距现在不到 5 分钟（用户正在交互）。开始时 touch goal/.lock，结束时删除。
1. round+1，记开始时间。从 backlog 取最重要的一项（可依据 open_problems 重排）。一轮只做一类改动。
2. 改代码，运行 goal/build.sh。用 read_file 亲眼看 dl/ 下相关视角图（以及 goal/refs/ 参考照片）。没达到本轮目的就修，最多重试 2 次构建。
3. 客观验收：构建是否 CASTLE_OK、顶点数、GLB 大小、本轮针对的视角前后对比。诚实写下“现在最不像的 3 个问题”。按 GOAL.md 8 条各打 0–5 分写进 state.json scores["rN"]。
4. 更新 goal/CHANGELOG.md（一节）、goal/state.json（done/backlog/open_problems/round）、docs/ROADMAP.md 勾选。复制本轮最好的视角图到 docs/progress/rNN_<视角>.png。
5. 推送 GitHub（公开仓库 changrong996-droid/osaka-castle-3d）：在 REPO 下 `python3 goal/push.py <本轮改动的相对路径...>`，shell 调用必须带 credentials [{"provider":"github"}]。自动取 sha 更新已有文件。不推 out/、dl/。本地也 git commit 一次（-c user.name=Hark -c user.email=hark@local）。
6. 有新版本时：在 Mac 上重新生成查看器并打开：`goal/mac.sh 'python3 tools/make_viewer.py viewer/template.html out/osaka_castle_site.glb out/osaka_castle_site.html && open out/osaka_castle_site.html'`。
7. 给用户发一条简短中文消息（≤6 行）：第几轮、改了什么、关键数据、最不像的问题、下一轮打算；附本轮最能说明进展的一张视角图（display_file 后放进 attachments）。
8. 判断：若 GOAL.md 8 条都 ≥4 分（连续两轮只剩细微问题），或 round 达到 max_rounds：status=done，给用户最终报告（达标情况、每轮一句话改动、目标模式哪些轮有实质进步、哪些原地打转），并用 scheduled_task cancel（不带 task_id，结束本任务）。
9. 本任务是每 20 分钟一次的定时任务，不需要交棒。
10. 若用户说“暂停/停止目标模式”：state.status=paused（暂停后的轮次会在第 0 步静默退出）。
11. 整轮做不下去（Mac 连不上、GitHub 失效）：用 scheduled_task report_wall 记录，不要假装完成。
