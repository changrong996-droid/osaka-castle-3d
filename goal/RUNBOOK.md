# 大阪城目标模式 runbook（项目 Osaka Castle 3D Model）
你是目标模式中的一轮，每轮是新会话，只靠本目录文件交接。仓库根：/workspace/projects/3dffd53e-9285-4461-aa69-4f5634f0e079/castle（下称 REPO）。先读 goal/GOAL.md、goal/state.json、goal/CHANGELOG.md、README.md、docs/ROADMAP.md。

## 工具
- 构建 + 取回反馈图：`REPO/goal/build.sh`（约 60–90 秒；会先跑 tools/make_terrain.py，再同步仓库到 Mac 的 ~/Hark/osaka-castle-3d 并用 Blender 无界面构建；视角图下载到 REPO/dl/）。若 shell 超时被转后台，用 wait_for_subagents 等它，不要重跑。
- 任意 Mac 命令：`REPO/goal/mac.sh '<命令，在 ~/Hark/osaka-castle-3d 下执行>' [相对路径 ...要下载的文件]`。
- 数据管线：data/osm.json → tools/extract_layout.py → data/castle_layout.json → tools/make_terrain.py（shapely，只在沙盒跑）→ data/terrain.json → blender/build_castle.py（exec tenshu/build_tenshu.py 复用几何工具：box/tube/skirt/roof/sphere/cyl/quad/tri/add_geo，材质 MATS）→ out/*.blend/.glb/views/*.png → tools/make_viewer.py viewer/template.html → out/osaka_castle_site.html。
- Blender 是中文界面：找节点按 type，不按名字。
- 若 rx.py 报 socks/代理错误：goal/mac.sh 会自动装 pysocks 并启动 tailscaled；仍失败读 /workspace/work/ts/relay/RUNBOOK.md。

## 每轮流程
1. round+1，记开始时间。从 backlog 取最重要的一项（可依据 open_problems 重排）。一轮只做一类改动。
2. 改代码，运行 goal/build.sh。用 read_file 亲眼看 dl/ 下相关视角图（以及 goal/refs/ 参考照片）。没达到本轮目的就修，最多重试 2 次构建。
3. 客观验收：构建是否 CASTLE_OK、顶点数、GLB 大小、本轮针对的视角前后对比。诚实写下“现在最不像的 3 个问题”。按 GOAL.md 8 条各打 0–5 分写进 state.json scores["rN"]。
4. 更新 goal/CHANGELOG.md（一节）、goal/state.json（done/backlog/open_problems/round）、docs/ROADMAP.md 勾选。复制本轮最好的视角图到 docs/progress/rNN_<视角>.png。
5. 推送 GitHub（公开仓库 changrong996-droid/osaka-castle-3d）：只推本轮改动的文件。用 apicall 在进程内调用（argv 有长度限制）：python 里 runpy.run_path('/usr/local/bin/apicall', run_name='__main__')，sys.argv=['apicall','github','contents_put','owner=changrong996-droid','repo=osaka-castle-3d','path=..','message=rN: ..','content=<base64>','sha=<已有文件需先 contents_get 取 sha>']，shell 调用带 credentials github。不推 out/、dl/。
6. 有新版本时：在 Mac 上重新生成查看器并打开：`goal/mac.sh 'python3 tools/make_viewer.py viewer/template.html out/osaka_castle_site.glb out/osaka_castle_site.html && open out/osaka_castle_site.html'`。
7. 给用户发一条简短中文消息（≤6 行）：第几轮、改了什么、关键数据、最不像的问题、下一轮打算；附本轮最能说明进展的一张视角图（display_file 后放进 attachments）。
8. 判断：若 GOAL.md 8 条都 ≥4 分（连续两轮只剩细微问题），或 round 达到 max_rounds：status=done，给用户最终报告（达标情况、每轮一句话改动、目标模式哪些轮有实质进步、哪些原地打转），不再交棒。
9. 否则交棒：先 scheduled_task list，确认没有同名待执行任务；再 scheduled_task create，schedule_type=once，at=当前时间+3 分钟（带 +08:00 偏移），name="大阪城目标模式 第N轮"（N=下一轮），requested_by=agent，prompt="读 /workspace/projects/3dffd53e-9285-4461-aa69-4f5634f0e079/castle/goal/RUNBOOK.md 并执行大阪城目标模式的下一轮。"
10. 若用户在对话里说“暂停/停止目标模式”：state.status=paused，取消待执行的同名任务，不再交棒。
