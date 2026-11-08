# 杭州西站施工推演 · 盘点报告（五部分结构）

范围：`web/hzview.js`（733 行）、`web/hzsheet.js`（303 行）、`web/hzwest.html`（172 行）、`web/hzseq.js`（574 行）、`web/core/seq.js`（626 行）。
方法：静态阅读 + 在 Node 中执行 `HZ.make()` 与 `HZ.audit()` 取得计数（临时脚本位于 `/tmp`，未入库，未修改任何现有代码）。
所有行号指当前分支 `hoplite/mylasa-8066bb48` 的文件。找不到的写“未找到”。

---

## 第一部分 图纸清单

### 1.1 图册编号 S-xxx

| 图号 | 图名 | 当前状态 | 绘制函数 | 定义位置 | 页面画布 id |
|---|---|---|---|---|---|
| S-000 | 总图 | 可用（3D 总图视图，无 2D 图纸） | 无 | 图号声明 `hzview.js:9`；进入逻辑 `hzview.js:10`；总图文字 `hzview.js:493–499` | 无（3D 主画布 `gl`，`hzwest.html:121`） |
| S-101 | 地下 | 仅标签待出图（不可点） | 无 | `hzview.js:9`（标记 0）；标签 `hzview.js:522` | 无 |
| S-201 | 承轨层 | 仅标签待出图（不可点） | 无 | `hzview.js:9`；`hzview.js:522` | 无 |
| S-301 | 整体提升 | 可用（3D 详图 + 右栏千斤顶图） | `jack` | 函数 `hzsheet.js:223`；注册 `hzview.js:591`；导出 `hzsheet.js:300` | `sh-jack`（`hzwest.html:141`） |
| S-401 | 屋面 | 仅标签待出图（不可点） | 无 | `hzview.js:9` | 无 |
| S-501 | 开通 | 仅标签待出图（不可点）。注：`hzwest.html:134` 的“推演完成 · 2022-09-22 开通”浮层不是 S-501 图纸 | 无 | `hzview.js:9` | 无 |

S-000 以外的所有编号都经 `sheetOf()`（`hzview.js:10`）回落到 S-000 或 S-301；只有 `v === 'S-301'` 才进入 S-301，其余一律回落 S-000。

### 1.2 有绘制函数但未被调用的三张 A 系列图

| 图号 | 图名 | 绘制函数 | 函数定义 | 调用方 | 页面画布 id |
|---|---|---|---|---|---|
| HZW-A-301 | 横剖面 B–B（x = 39 m） | `section` | `hzsheet.js:57`（标题 `:58`） | 未找到（`hzview.js` 只注册 `jack`，`:591`；`hzsheet.js:300` 仅导出） | 无 |
| HZW-A-101 | 屋盖网架平面 | `plan` | `hzsheet.js:109`（标题 `:110`） | 未找到（同上） | 无 |
| HZW-A-501 | 屋盖提升图 | `lift` | `hzsheet.js:152`（标题 `:153`） | 未找到（同上） | 无 |

`hzsheet.js:3` 的文件头注释把这三张称为“实时图纸”，这只是注释，代码中未接线。

---

## 第二部分 构件与施工时序数据

### 2.1 数据定义位置

- 构件与活动生成：`web/hzseq.js:125` `build()`，由 `HZ.make` 在 `:445` 调用。分段（段标题行）如下：

| 段 | 标题行 | 活动键（行号） |
|---|---|---|
| 1 地下结构 + 地铁层 | `:129` | `found`（`:134`） |
| 2 线下框架柱 / 夹层 / 引桥墩 | `:136` | `frame`（`:140`）、`mezz`（`:143`）、`pier`（`:146`） |
| 3 承轨层 | `:148` | `deck`（`:153`）、`deckap`（`:154`） |
| 4 站台与轨道 | `:156` | `plat`（`:159`）、`track`（`:161`） |
| 5 候车层 | `:163` | `col24`（`:171`）、`ccol`（`:172`）、`floor`（`:176`）、`canopy`（`:178`） |
| 6 梭形钢管柱 | `:180` | `mast`（`:185`） |
| 7 屋盖网架 | `:188` | `jig`（`:256`）、`asm`（`:257`）、`rig`（`:258`）、`lift`（`:259`）、`merge`（`:261`）、`wlift`（`:262`）、`head`（`:263`）、`holes`（`:264`） |
| 8 屋面 | `:266` | `sky`（`:287`）、`clad`（`:288`）、`pv`（`:289`） |
| 9 5F 空中连廊 | `:291` | `ring`（`:295`） |
| 10 上盖开发 | `:296` | `tod`（`:302`） |
| 11 云门 | `:303` | `ymf`（`:310`）、`ym`（`:311`）、`ymc`（`:312`） |
| 12 塔吊 | `:313` | `crane`（`:319`）、`ycrane`（`:321`） |
| 13 开通 | `:322` | `open`（`:323`） |

- 活动对象：`SEQ.act` `web/core/seq.js:449–456`。
- 构件 `part()` 工厂：`web/hzseq.js:124`。几何类 `GB`：`hzseq.js:104–120`（`HZ.GB = GB` 在 `:120`）。
- 时刻赋值（`st` / `du` / `rm` / `c` / `top`）：`web/hzseq.js:475–479` `HZ.times`。
- 吊装分派与履带站位：`web/hzseq.js:481–496` `HZ.assignCranes`。
- 依赖规则：`web/hzseq.js:341–384`（`supRule`、`roofRule`、`sweepRule`）；规则引擎 `SEQ.derive` `web/core/seq.js:502`，排程 `SEQ.schedule` `:511`。
- 参数：`web/hzseq.js:48–57`（`P`）；提升行程与同步常量 `hzseq.js:386`（`STROKE 0.25`、`SYNC amp 3 / limit 10`）。

### 2.2 构件记录字段

| 字段 | 含义 | 赋值位置 |
|---|---|---|
| `geo` | 几何：`boxes`、顶点 `P/N/C/L`、`min` / `max` | `part()` `hzseq.js:124`；`GB` `:104–120` |
| `mat` | 材质键 | `part()` `:124` |
| `grp` | 移动分区：0 静止、1 南区、2 中区、3 北区、4 嵌补；列车为 5 | 格分区 `hzseq.js:195`；列车 `hzview.js:137–138` |
| `sweep` | 施工排序键 | `part()` `:124` |
| `act` | 所属活动 | `HZ.times` `:477` |
| `st` | 开始时刻（天） | `:477` |
| `du` | 作业时长（天，最小 0.6） | `:477` |
| `rm` | 拆除 `[开始, 时长]`；无拆除时为 `[-1, 0]` | `:478` |
| `c` / `top` | 盒心均值 / 顶面高 | `:479` |
| `cells` / `rods` | 网架行的格列表；杆件 `[端点 a, 端点 b, 半径]` | 格 `hzseq.js:191–197`；`cellGeo` `:201–213`（杆件入列 `:203`）；行聚合 `:214–215` |
| `sup` | 支承者集合（活动键、`ground` 或 `self`） | `supRule` `:349` |
| `crane` / `crawl` / `crawlY` | 塔吊编号（-1 为履带）、履带站位、站位高 | `:485`、`:494` |
| `lift` | 提升器 `{x, z, top, zone}` | `:245`（塔）、`:249`（提升塔） |
| `jigOf` | 胎架对应格 | `:238` |
| `headOf` / `host` | 柱头所属柱 / 宿主构件 | `headOf` `:217`；`host` `:245` |
| `tons` / `t` | 柱吨位（`tons`）；网架行吨位（`t`，按格数分摊） | `tons` `:185–186`；`t` 的分摊代码位于 `build()` 末段，未逐行核对 |

### 2.3 状态判定函数 `stOf`（完整逻辑）

唯一定义：`web/hzsheet.js:15`，单行函数，逐分支为：

1. `if (p.st == null || t < p.st) return -1;`
2. `if (p.rm && p.rm[0] >= 0 && t >= p.rm[0]) return t >= p.rm[0] + p.rm[1] ? 3 : 2;`
3. `return t < p.st + p.du ? (t - p.st) / p.du : 2;`

四态判定：

| 状态 | 返回值 | 判定条件 | 行 |
|---|---|---|---|
| 未建 | `-1` | `st` 为空，或 `t < st` | `:15` 分支 1 |
| 在建 | `0 ≤ 值 < 1`（进度比） | 不满足拆除分支，且 `t < st + du` | `:15` 分支 3 |
| 已建 | `2` | 不满足拆除分支，且 `t ≥ st + du`；另外拆除进行中（`rm[0] ≤ t < rm[0] + rm[1]`）也返回 `2` | `:15` 分支 2 与分支 3 |
| 已拆 | `3` | `rm[0] ≥ 0` 且 `t ≥ rm[0] + rm[1]` | `:15` 分支 2 |

逻辑注意（由代码直接读出）：拆除分支（分支 2）先于在建分支（分支 3）判断，因此 `t ≥ rm[0]` 之后在建进度被覆盖；`rm = [-1, 0]` 永不进入拆除分支。

调用方：`hzsheet.js:67`（剖面静止盒）、`:73`（屋面行）、`:78`（网架切片）、`:118`（平面格）；`hzview.js:359`（镜头遮挡，经 `SH.stOf`）。

3D 侧的同一语义由 GPU 着色器实现，不调用 `stOf`：`hzview.js:86–90` `hzCalc`（`p` 为进度，`r = 1 − clamp((uT − aR.x)/aR.y)` 为拆除收缩，`k = p·r` 平滑）；`hzview.js:120` 把 `uT < s` 记为 `vS = -1`（未建幽灵），`:120` 的 `vS = 0.5` 为在建或刚建，`vS = 2` 为已建，`k < 1e-4` 记 `vS = -3`（隐藏，即已拆）；`hzview.js:123` 对 `vS < -2` 丢弃片元。

### 2.4 状态机实际覆盖的构件数量（Node 执行结果）

| 项目 | 数量 | 说明 |
|---|---|---|
| 活动 | 55 | 其中 `build` 42、`temp` 6、`untemp` 6、`milestone` 1 |
| 构件引用（遍历所有活动） | 2424 | 含重复引用 |
| 唯一构件记录 | 1906 | 差额 518 来自拆除活动与临时活动共享同一 `parts` 数组（`core/seq.js:152`） |
| 唯一记录中 `st` 已赋值 | 1906 | 全部 |
| 唯一记录中有拆除时刻（`rm[0] ≥ 0`） | 518 | |
| 唯一记录中有支承集合（`sup`） | 1859 | `supRule` 赋值 |
| 3D 编译纳入的唯一记录 | 1906 | `compile()` 跳过 `untemp` 活动（`hzview.js:136`），另加 2 个列车项（`:137–138`） |
| 网架行记录（带 `cells`） | 106 | 其中移动 `grp > 0` 为 47，静止孔边为 59（由 106 − 47 推出） |
| 网架格 | 1432 | `HZ.cells`（`hzseq.js:197`） |
| 杆件 | 11456 | 格内杆件求和 |
| 提升器 | 32 | `HZ.lifters`（`hzseq.js:252`） |
| 塔吊 | 8 | 其中 6 台为主塔吊、2 台为云门塔吊（`hzseq.js:316` 起的 `mk` 调用，`:319`、`:321`） |
| 吊装分派：塔吊 / 履带 | 58 / 741 | 与 `HZ.lift` 计数一致 |

---

## 第三部分 图纸与 3D 同源对应

### 3.1 共用数据对象

- 活动与构件：`HZ.acts`（`hzseq.js:467`）、构件记录 `st/du/rm/c/top`（`:475–479`）。
- 网架与提升器：`HZ.cells`（`:197`）、`HZ.lifters`（`:252`）。
- 姿态与读数：`HZ.pose`（`:405`）、`HZ.jackRead`（`:413`）、`HZ.secY`（`:430`）、`HZ.secGap`（`:432`）。
- 几何辅助：`Ht` 定义于 `hzseq.js:73`，导出为 `HZ.Ht` 于 `:76`；`HZ.inSky` 同行导出；`HZ.K` 见 `:467`。

### 3.2 3D 视图渲染调用链（按调用顺序）

1. `run()` `hzview.js:42`
2. `HZ.make()` `hzview.js:48` → `hzseq.js:444`（`HZ.make`）→ `build()` `:445` → `SEQ.derive` `:462` → `SEQ.schedule` `:466` → `HZ.times` 与 `HZ.assignCranes` `:469`
3. `compile()` `hzview.js:135`：纳入记录 `:136–138`，合并属性 `:150–151`，生成网格与线段 `:153–157`
4. 材质：`patchStd` `hzview.js:99`；墨线 `inkMat` `:109`；线段 `lineMat` `:127`
5. 每帧 `frame(now)` `hzview.js:667` → `setT(t)` `:533` → `HZ.pose(t)` `:534`（`hzseq.js:405` → `HZ.motion` `:388` → `HZ.travel` `:387`）→ `HZ.mat` `:534`（`hzseq.js:437`）→ `zoneTint` `:535`（`:387`）→ `setDusk` `:540` → `camKey` `:543`（`:337`）→ `hud` `:545`（`:500`）
6. `frame` 续：`rebuildDyn(t)` `hzview.js:677`（`:252`）→ `craneState` `:242`（塔吊回转）→ `HZ.jackRead` `:281` 段（`hzseq.js:413` → `HZ.pose` `:415`）→ 油缸 `:281–291` → 上传 `:293–299` → 工人 `:301–311`
7. 渲染：`renderInk` `hzview.js:661`（墨线）或 `renderLit` `:663`（实景），由 `:679–680` 选择；GPU 侧 `hzCalc`（`:88`）读取 `uT`、`uG`、`aK`、`aR`

### 3.3 图纸绘制调用链（按调用顺序）

1. `frame(now)` `hzview.js:671`（仅 `sheetsDirty` 且 `SHEET === 'S-301'`）
2. `drawSheet(s, now)` `hzview.js:629` → `sheetCtx(s)` `:627`（提供 `tb`、`setScale`、`view`，`stroke` 经 `strokeData` `:623`）
3. `s.fn = SH.jack`：注册 `hzview.js:591`；`SH` 来自 `hzview.js:49`（`window.HZS.make`）→ `hzsheet.js:12`（`HZS.make`），导出 `:300`
4. `jack(g, w, h, t, ctx)` `hzsheet.js:223`，内部依次：
   - `frame(g, ...)` `hzsheet.js:29`（标题栏）
   - `HZ.jackRead(t)` `hzsheet.js:224` → `hzseq.js:413`
   - 平面映射与吊点圆 `hzsheet.js:229–233`、`:254`
   - 剖面：`Hb` `:188`（调 `HZ.Ht` `hzseq.js:73`、`HZ.inSky` `:76`）、`HZ.secY` `hzsheet.js:280`（`hzseq.js:430`）、`HZ.secGap` `:286`（`hzseq.js:432`）
   - 行程小图 `strokeChart` `hzsheet.js:193`（仅选中吊点时）
   - 标注 `label` `:45`
5. 竣工戳 `hzview.js:631`（`S.st.t >= TL.OPEN`）

### 3.4 两条链的同源点

- 姿态：3D `setT` 调 `HZ.pose`（`hzview.js:534`）；图纸经 `HZ.jackRead` 调 `HZ.pose`（`hzseq.js:415`）。同一函数。
- 吊点读数：3D `rebuildDyn` 的油缸段（`hzview.js:281–291`）与图纸平面（`hzsheet.js:254–255`）都读 `J.rows`。
- 剖面净空：图纸 `hzsheet.js:280`、`:286` 与 3D `secGap3`（`hzview.js:249`）都调用 `HZ.secGap` 与 `HZ.secY`。
- 构件状态：3D 用 GPU 版（`hzview.js:86–90`、`:120`），图纸用 `stOf`（`hzsheet.js:15`）。两者**不是同一函数**，只共享 `st/du/rm` 字段与相同的语义。

### 3.5 不在调用链上的图纸函数

- `section`（`hzsheet.js:57`）：未找到调用方。
- `plan`（`hzsheet.js:109`）：未找到调用方。
- `lift`（`hzsheet.js:152`）：未找到调用方。
- 它们的私有辅助 `hull`（`hzsheet.js:145`）、`zoneGeo`（`:146`）、`secBoxes`（`:17`）、`skinRows`（`:20`）、`cellPart`（`:25`）也只被这三个函数使用。

---

## 第四部分 校核与计算

| 名称 | 函数 | 文件:行 | 说明 |
|---|---|---|---|
| 支承判定（R1，网架与构件） | `supRule` | `web/hzseq.js:341–363` | 静止盒底面与下方盒顶面接触（差 < 0.05）且平面重叠 > 0.05，记为支承 |
| 支承规则（引擎） | `SEQ.RULE.support` | `web/core/seq.js:464–468` | 按阶段表，B 底面落在 A 顶面 ±tol 且投影重叠 > minOverlap 时连依赖 |
| 先挖后建 | `SEQ.RULE.dig` | `web/core/seq.js:469` | 移除类活动先于与其包围盒相交的非移除活动 |
| 屋盖顺序（R3 / R5 / R4 / R8） | `roofRule` | `web/hzseq.js:365–372` | 拼装→提升→合龙→整体提升→卸载→屋面的依赖链 |
| 提升扫掠（R8） | `sweepRule` | `web/hzseq.js:374–384` | 静止盒与提升包络相交则排在整体提升之后；相交于整体提升前驱则记为几何冲突 |
| 临时构件（R4） | `SEQ.RULE.temp` | `web/core/seq.js:479` | 搭设先于服务活动、拆除不早于服务活动完成；拆除活动生成见 `:150–153` |
| 养护间隔 | `SEQ.RULE.cure` | `web/core/seq.js:475` | 养护满期约束 |
| 资源占用（R5） | `usesOf` | `web/core/seq.js:533` | 按资源上限生成占用，审计峰值见 `:596` |
| 排程（CPM + SSGS） | `SEQ.schedule` | `web/core/seq.js:511` | 拓扑排序；循环依赖检测 `:518`；按资源上限串行排程 |
| 规则引擎入口 | `SEQ.derive` | `web/core/seq.js:502–506` | 依次套用规则并计数 |
| 独立审计（网络层） | `SEQ.auditNet` | `web/core/seq.js:585–605` | 依赖违例 `:590`；R4 `:591`；R5 峰值 `:596`；总判定 `:605` |
| A1 无支承 | `HZ.audit` | `web/hzseq.js:502–508`（循环 `:503`） | 每个静止构件开工时必须有已完成且未拆的支承 |
| A1 分区支承（吊点凸包 + 胎架） | `HZ.audit` | `web/hzseq.js:509–510` | 重心必须落在吊点凸包与胎架凸包内；胎架与提升架时序检查同行 |
| 凸包构造 / 包含判断 | `hull` / `inside` | `web/hzseq.js:507–508` | Andrew 单调链与叉积符号判断 |
| 合龙对齐 | `HZ.audit` | `web/hzseq.js:515` | 合龙时刻南北分区与中区高度差为 0，且旋转进度为 1 |
| A2 穿模 | `HZ.audit` | `web/hzseq.js:517–527` | 同时在场的静止盒两两相交（收缩 0.06 m），排除同构件与宿主 |
| A3 提升净空 | `HZ.audit` | `web/hzseq.js:529–549` | 5 个提升阶段各 25 个时刻采样，移动杆件与在场静止盒做线段-盒检测（`segBox`，`:562–564`） |
| A4 临时构件 | `HZ.audit` | `web/hzseq.js:551` | 直接取自 `auditNet.r4`（`core/seq.js:591`） |
| A5 塔吊回转净空（R9） | `HZ.audit` | `web/hzseq.js:542–547` | 每台塔吊 72 个方位，回转半径内的在场构件做线段-盒检测 |
| R10 吊装分派 | `HZ.assignCranes` | `web/hzseq.js:481–486` | 构件中心在某台在场塔吊回转半径（56 m）内归塔吊，否则归履带吊 |
| 履带站位搜索 | `clashAt` | `web/hzseq.js:489–495` | 站位离构件最近、整列到 200 m 不与在场构件相交；找不到计入违例（`:495`） |
| A6 提升同步与行程 | `HZ.audit` | `web/hzseq.js:552–555` | 四段提升按 5 min 采样，同步差 ≤ 10 mm，且行程在工期内走得完 |
| 行程可达判定 | `HZ.motionCap` | `web/hzseq.js:403` | `0.1 + (dur − 1)·10·0.25 ≥ travel` |
| 行程总量 | `HZ.travel` | `web/hzseq.js:387` | 南/北区与整体提升的控制吊点总行程 |
| 单个吊点节拍 | `HZ.motion` | `web/hzseq.js:388–402` | 按小时：首日 08–10 加载、10–11 试提升，之后每日 10 个行程窗口（08:00–18:00），夜间锁定 |
| 姿态 | `HZ.pose` | `web/hzseq.js:405–411` | 各分区的竖向偏移 `dy` 与旋转进度 `r`，由提升行程与整体提升比例求得 |
| 吊点读数 / 同步偏差 | `HZ.jackRead` | `web/hzseq.js:413–423` | 吊点竖向位移 `disp`（`:421`）；同步偏差 `dev`（`:420`）为模拟值，上限 `HZ.SYNC.limit` |
| 楼面最小净空 | `HZ.gap` | `web/hzseq.js:425–428` | 按姿态取各分区下弦最低点与楼面的差 |
| 楼面净空表 | `HZ.gapTab` | `web/hzseq.js:452` | 按旋转进度 33 档采样，供 `HZ.gap` 查表 |
| 剖面净空 | `HZ.secY` / `HZ.secGap` | `web/hzseq.js:430–434` | 剖面 x = 39 m 处下弦高度与楼面以上最低净空 |
| 整体提升高度 D | 构件循环 | `web/hzseq.js:225`（innerDrop）、`:232–233`（D） | 拼装姿态最低下弦须高出楼面胎架 1.2 m，取 Dmax 向下取整到 0.1 m |
| 旋转内边抬升 | `HZ.innerDrop` | `web/hzseq.js:225` | 南区以 4° 旋转后内边抬升量 |
| 胎架布置 | 构件循环 | `web/hzseq.js:236–238` | 每隔一格在楼面立胎架，顶为下弦节点减杆件半径 |
| 工期与吨位 | 构件循环 | `web/hzseq.js:185–186`（柱吨位） | 柱按高度 × 2.2 t/m 估算，网架按格数分摊 |
| 审计汇总 | `HZ.audit` | `web/hzseq.js:556` | `zero` 为所有子项为 0 时为真 |
| 审计 Worker | `auditWorker` | `web/hzview.js:582–588` | 在 Worker 中执行 `HZ.audit()`，失败时同步兜底（`:588`） |
| 审计结果展示 | `fillInfo` | `web/hzview.js:568–580` | 逐项列出；芯片 `:577` |
| 计算读数 | `calcText` | `web/hzview.js:469–480` | 支承 / 穿模 / 提升净空 / 吊装 的计数按时间累计 |
| 图纸的同步偏差着色 | `devCol` | `web/hzsheet.js:187` | 绿 ≤ 35%、黄 ≤ 70%、其余红 |
| 千斤顶图标注 | `jack` | `web/hzsheet.js:223–298` | 吊点读数、同步差、净空尺寸线（`:286–291`） |
| 镜头构图与遮挡 | `shotFor` | `web/hzview.js:356–374` | 扫描方位与仰角，遮挡只用静止盒（`hzview.js:359`） |
| 剖切视角 | `cutShot` | `web/hzview.js:428–436` | 剖切线 x = 39 m 的镜头距离 |
| 3D 净空标注 | `secGap3` / `measureAt` | `web/hzview.js:249–250` | 剖切时取剖面最低净空，否则取南区内边最紧处 |
| 推算示意（非校核） | 运输车 / 工人 | `web/hzview.js:268–270`、`:301–311` | 车数与工人数按工序推算，文字标注见 `hzview.js:576` |

注意：`hzsheet.js:145–147` 的凸包与重心校核（`zoneGeo.ok`）只属于未接线的 `lift` 函数（见 3.5）。

---

## 第五部分 四形态对照缺口

| 形态 | 现状 | 缺口 |
|---|---|---|
| 图纸 | 右栏仅 S-301 千斤顶图运行（`hzsheet.js:223`；注册 `hzview.js:591`；画布 `hzwest.html:141`） | 三张 A 系列绘制函数未接线（`hzsheet.js:57`、`:109`、`:152` 无调用方）；S-101、S-201、S-401、S-501 无图（`hzview.js:9`） |
| 施工过程 | 55 个活动、1906 个唯一构件的时间表由规则推导与 SSGS 排程生成（`hzseq.js:444–473`；`core/seq.js:511`）；工期为推算（`hzseq.js:35–46` 的 ASSUME 工期行） | 未找到施工实际进度的输入或对比数据；公开节点只以文字形式出现（`hzseq.js:10–22`、`:24–34`） |
| 成品 | 终态以“竣工 · 开通”戳与黄昏实景表示（`hzview.js:631`；`hzwest.html:134` 的推演完成浮层；`hzview.js:538` 的亮灯） | 未找到成品验收、质量检查项或成品状态字段；构件记录字段（第二部分 2.2）中没有验收相关字段 |
| 实物 | 未找到任何实地照片、测量、竣工图或实测数据（对 `web/hz*`、`docs/` 检索“实物 / 实测 / 照片 / 实拍”，仅命中算法注释 `hzview.js:674` 与 `docs/PLAYBOOK.md:97,107` 的界面测量用语） | 实物侧没有数据来源；页面中的“实录”日期（`hzview.js:579`）仅引用公开报道（`hzseq.js:24–34`），不是实测记录 |

---

**附：核实清单**
- 图纸画布：全页面 `<canvas>` 仅 `gl`（`hzwest.html:121`）与 `sh-jack`（`:141`）。
- 绘制函数调用：`SHEETS` 仅含 `sh-jack`（`hzview.js:591`）；`SH.section`、`SH.plan`、`SH.lift` 无匹配（全仓检索）。
- 计数：Node 执行 `HZ.make()` 与 `HZ.audit()`，结果 `zero = true`，支承、穿模、提升净空、塔吊回转、同步差均为 0（与 `hzseq.js:556` 判定一致）。
