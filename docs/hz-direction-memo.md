# 杭州西站施工推演图册 · 方向备忘录

状态：总工程师规划稿，只做规划与判断，不含实现代码。
依据：`docs/hz-atlas-inventory.md`（盘点报告）、`web/hzwest.html`、`web/hzview.js`、`web/hzsheet.js`、`web/hzseq.js`，以及 2026-11-07 对上游仓 `changrong996-droid/osaka-castle-3d` main 的实地核查（见 §2.1）。
本文所有「行号」指盘点报告所用分支的文件；上游随时在变，执行时以 `grep` 现场定位为准，不要按行号盲改。

---

## 第一部分 建设顺序

### 1.0 一句话定位

委托人的愿景是「一张图，四种形态，共用一个编号」。对照现状：

| 形态 | 现状 | 判断 |
|---|---|---|
| 生长（施工过程推演） | 最强。55 个活动、1 906 个唯一构件，规则推导 + 排程，3D 与图纸同源 | 这是全部资产的发动机，不动它 |
| 图纸（静态图纸） | 只有 S-301-1 千斤顶图在跑；A-301 / A-101 / A-501 三张函数齐备、无画布无调用 | 最便宜的增量：接线即得三张图 |
| 成品（建成后三维） | 等于同一模型在 `t ≥ OPEN` 的终态 + 竣工章；无验收 / 质量字段 | 不需要第二个模型，只缺「验收字段」这层数据 |
| 实物（照片与实测） | 空 | 先立「入口」（数据格式 + 校验），不急着收内容 |

因此「四形态」不是四套系统，而是**同一个图号下的四个槽位**。第一阶段的任务就是把这四个槽位的「登记表」立起来，并把现成的三张图接进去；不新建页面、不重构数据、不改上游正在高频修改的文件。

### 1.1 排序总表

| 序 | 事项 | 阶段 | 排序理由（一句话） |
|---|---|---|---|
| 1 | 无头验收基座（Node 加载 `core/seq.js` + `hzseq.js` + `hzsheet.js`，桩画布跑四个绘制函数） | 一 | 沙箱没有浏览器，后面每张卡的验收都要落在它上面；同时它是「上游改坏了没有」的探测器。已实测可行：四个函数在 7 个时刻下全部可执行（§2.1 附） |
| 2 | 图号登记表（S 与 A 两套编号统一为一张表） | 一 | 「共用一个编号」的落点就是这张表；接线要先知道图号叫什么；它是纯数据新文件，零碰撞 |
| 3 | 三张闲置图接线（作为 S-301 的子图 2/3/4，经旁路扩展接入，不改现有文件） | 一 | 可见价值最高、成本最低（函数已写好）；三张图的内容——铰转角、整体提升 D、钢绞线、移动分区染色、提升曲线——本来就是为提升阶段画的，归入 S-301 顺理成章 |
| 4 | 实物层入口（记录格式 + 校验脚本，空记录） | 一 | 便宜，且必须在登记表定型前把「实物」槽位的字段定下来，否则登记表会返工；不收内容 |
| 5 | 一键检查入口（把 1–4 的脚本串成一条命令，上游每次同步后跑） | 一 | 执行模型和委托人都需要一个「跑一下就知道有没有坏」的按钮 |
| 6 | 成品层验收字段 + 公开节点对照脚本 | 二 | 要先决定「验收」指什么（模型里程碑日期 vs 公开报道日期是最便宜、最硬的一组）；登记表立好后它只是加字段 |
| 7 | A 系列字面量在 `hzsheet.js` 里的清退（3 处字符串） | 二 | 必须改现有文件，而该文件被上游回路整文件覆盖；要等「握手」（§2.1）后再做 |
| 8 | 新页面 S-101 / S-201 / S-401 / S-501 | 二或三 | 每个新页面都要改 `hzview.js` 的 `timeline` / `SEGS` / `sheetOf` / `camKey` / 大数字；碰撞最重；而且 S-301-3 横剖面接好后，地下 / 承轨层的图纸形态已可被交叉引用，不急 |
| 9 | 构件数据产线：先「导出快照」（`HZ.make()` → JSON 金样），后「反向驱动」（JSON → build） | 二（导出）/ 暂缓（反向） | 导出便宜且立即有用（回归比对）；反向重写 `build()` 400 行手工几何是最大工程，只有出现第二个站 / 第二个项目时才值得 |
| 10 | 实物内容收集（照片、实测） | 三 | 涉及许可与来源，不是工程问题；入口立好后由委托人决定收什么 |

### 1.2 各事项的理由展开

**(1) 无头验收基座排第一。** 硬约束四说验收必须落在静态检查与可运行脚本上。盘点报告已在 Node 里跑过 `HZ.make()` 与 `HZ.audit()`；本次又验证了 `hzsheet.js` 只在 `hatchOf` 里碰 `document.createElement('canvas')`，用一个 Proxy 桩上下文即可让 `section / plan / lift / jack` 四个函数在 Node 里完整执行（结果：7 个时刻 × 4 函数 = 28/28 通过，标题栏图号分别捕获为 `HZW-A-301 / HZW-A-101 / HZW-A-501 / HZW-S-301-1`）。有了这个基座，「三张图没坏」「图号对不对」「上游改完我们还能不能加载」都变成一条命令的事。

**(2) 登记表第二。** 两套编号的真实情况是：S 系列是页面 / 深链 / `body` 类名 / 阶段条在用的「页号」；A 系列只存在于三张没人调用的函数的标题栏字符串里。所以统一方向只能是 **S 为准，A 退为别名**。但要警惕一个陷阱：**A 与 S 不是同号同义**——`A-101` 是屋盖网架平面，`S-101` 是地下；`A-301` 是横剖面，`S-301` 是整体提升。绝不能做「A-xxx → S-xxx」的字面替换。本备忘录定下的编号规则见 §1.4。

**(3) 接线第三，且走旁路。** 盘点第五部分列出的缺口里，这是唯一「代码已经写好」的一项。但接线的常规做法（在 `hzwest.html` 加 `<canvas>`、在 `hzview.js` 的 `SHEETS` 数组加条目）恰好要改上游回路每 30–60 分钟整文件覆盖的两个文件（§2.1）。核查 `hzview.js` 后确认它把 `SHEETS`（数组引用）、`SH`（绘制函数集）、`layout()`、`ready`、`sheet` 全部挂在 `window.__pv` 上，`setT` 会置 `sheetsDirty`，`hashSync` 只增删 `focus` 参数、保留其它参数，`drawSheet` 对 `clientWidth < 20` 的画布直接跳过——这意味着一个**后加载的独立脚本**可以在 `__pv.ready` 后往 `#col` 里插画布、往 `__pv.SHEETS` 里推条目、用包装函数改写 `ctx.tb` 传入的图号，不改现有任何一行。图号覆盖这一点已在本次验证中确认可行（图号经 `ctx.tb(w, h, no, name, t)` 流入 `frame()`，包装层可替换 `no`）。

**(4) 实物入口第四。** 实物层现在是空的，但登记表里「实物」槽位要引用什么格式的记录，必须在第一阶段定下来，否则第二阶段加字段时登记表要改结构。只做格式与校验，零内容。

**(5) 一键检查第五。** 把前四项的脚本串成 `node tools/hz/check_all.js`，退出码非零即失败。这是执行模型领卡后唯一需要会跑的命令，也是上游每次同步后的体检。

**(6) 成品验收字段放第二阶段。** 「成品」现在等于同一模型的终态；缺的是「验收字段」。最便宜又最硬的验收是：模型里程碑日期（`HZ.K.wlift.end`、`K.pv.end`、`P.OPEN` 等经 `HZ.dayDate` 换算）对照 `HZ.FACTS` 里的公开节点（2021-06-28 提升完成、2021-08-31 屋面闭水、2022-09-22 开通）。这同时是「成品 ↔ 实物」的第一组真实对照。它只依赖登记表与基座，放第二阶段第一件。

**(7) A 字面量清退放第二阶段。** 第一阶段用包装层覆盖图号后，用户已看不到 A 编号；`hzsheet.js` 里的 3 处字面量只是「技术债」，等上游回路停下或与协作者握手后一次性改掉。

**(8) 新页面放后。** 每个新 S 页都要动 `hzview.js` 中 `timeline()`（只认 S-000 / S-301）、`sheetOf()`（其余回落 S-000）、`SEGS`、`camKey`、`big301`、`layout` 的 `body` 类名——这些全在上游高频改动的文件里，而且 `SHEETS_ALL`、`tabs()` 是闭包内常量，旁路改不了。等 S-301 四张图跑稳、登记表成为事实标准后再谈。

**(9) 数据产线先导出后反向。** 盘点第二部分 2.2 的字段表已经是一份「隐式 schema」。先写导出脚本把 `HZ.make()` 的结果按这张表落成 JSON 金样（`data/hz/parts.json`），用于回归比对（上游改了 `hzseq.js`，差异一目了然）。反向（JSON → `build()`）是重写 400 行手工几何，只在出现第二个站房 / 第二个项目时才有收益；在此之前属于「不要做」。

### 1.3 第一阶段：只做什么、不做什么

**只做：**
- 新增文件：`tools/hz/`（基座与检查脚本）、`web/hzatlas.js`（登记表 + 旁路扩展）、`web/hzatlas.html`（旁路入口壳）、`web/hzreal.js`（实物记录）、`docs/hz-atlas-check.md`（如何跑检查）。
- 三张闲置图以 S-301 子图 2/3/4 的身份在 `hzatlas.html` 里可切换显示，标题栏显示新图号。
- 登记表覆盖全部六个页号、四张子图、四个形态槽位、A → S 别名。
- 一条命令跑完全部检查。

**不做：**
- 不改 `web/hzwest.html`、`web/hzview.js`、`web/hzsheet.js`、`web/hzseq.js`、`web/core/seq.js`、`web/fx.js`、`web/look.js` 的任何一行（含 `?v=` 版本号）。
- 不新开 S-101 / S-201 / S-401 / S-501 页面，不改 `SHEETS_ALL` 的灰显状态。
- 不改 `build()`，不做 JSON → 构件的反向产线。
- 不收集照片、不下载任何外部图片。
- 不引入 npm 依赖、不装 jsdom / puppeteer / playwright、不加打包器、不把脚本改成 ES module。
- 不碰大阪城相关的任何文件（`index.html`、`app.js`、`site.js`、`bldg.js`、`camera.js`、`tenshu.js`、`data.js`、`bake/`、`shots/`、`blender/`、`tools/*.py`、`tests/`）。

### 1.4 编号规则（本备忘录裁定）

- 规范图号：`HZW-S-<页号>-<子图序号>`。页号沿用现有 `S-000 / S-101 / S-201 / S-301 / S-401 / S-501`，**不改任何页号**；子图序号自 1 起。登记表内部用短号 `S-301-2`，标题栏用全号 `HZW-S-301-2`。
- 现有图号映射：

| 旧（标题栏字面量） | 新短号 | 新全号 | 绘制函数 | 理由 |
|---|---|---|---|---|
| `HZW-S-301-1` | `S-301-1` | `HZW-S-301-1` | `jack` | 不变 |
| `HZW-A-501` 屋盖提升图 | `S-301-2` | `HZW-S-301-2` | `lift` | 提升曲线 + 吊点凸包，纯提升阶段内容 |
| `HZW-A-301` 横剖面 B–B | `S-301-3` | `HZW-S-301-3` | `section` | 画铰转角、整体提升 D、钢绞线、随姿态的网架切片，是为提升阶段设计的；S-101 / S-201 开页后以「详见 S-301-3」交叉引用 |
| `HZW-A-101` 屋盖网架平面 | `S-301-4` | `HZW-S-301-4` | `plan` | 移动分区染色、提升点标记、剖切线 B–B，同上 |

- 旧号全部进别名表，`HZA.resolve('HZW-A-501') === 'S-301-2'`；别名只读不写，任何新代码不得再产生 A 号。
- 一张子图可被多个页号引用（登记表 `PAGES[页].sheets` 是 id 列表），标题栏永远显示子图自己的图号。这是真实图册的做法（「详见某图」），不是把图复制一份。
- 深链：现有 `#sheet=S-301&focus=J23` 原样保留；子图切换用新增参数 `sub=<序号>`（`#sheet=S-301&sub=3`），缺省 `sub=1`。

---

## 第二部分 风险与不要做清单

### 2.1 与上游回路的碰撞风险（最高优先级）

**核查到的事实（2026-11-07，`git fetch` 上游 main 最近 40 个提交）：**
- 上游最近 24 小时内有 7 轮「goal mode」提交，**每轮改的正是 `web/hzview.js`、`web/hzwest.html`、`web/hzsheet.js`、`web/hzseq.js`**（分别 8 / 7 / 7 / 6 次），外加 `goal/CHANGELOG.md`、`docs/PLAYBOOK.md`。它们正在做 set2a → set2d（图纸 ↔ 3D 联动、剖切、镜头碰撞），节奏 30–60 分钟一轮。
- 上游 `goal/RUNBOOK.md` 写明推送方式是 `goal/push.py <文件…>`，「自动取 sha 更新已有文件」——即**用协作者本地内容整文件覆盖 GitHub 上的文件**，流程里没有「先拉取」步骤。
- 本 fork 的 main 已落后上游 40 个提交；四个 hz 文件与上游的差异为 +99/−37 行。

**推论：** 我们对这四个文件的任何改动，即使 PR 合入上游 main，也会在协作者下一轮推送时被其本地副本**静默覆盖**——不是冲突，是消失。所以：

| 风险 | 应对（已写入第一阶段任务卡） |
|---|---|
| 改现有 hz 文件被整文件覆盖 | 第一阶段一行都不改；全部能力放在新文件，经 `web/hzatlas.html` 壳 + `window.__pv` 接口旁路接入 |
| 上游改动破坏旁路依赖的接口（`__pv.SHEETS / SH / layout / ready / sheet`、`ctx.tb` 签名、`#col` 存在、`hashSync` 保留未知参数） | 基座脚本把这些依赖点列成断言，每次同步上游后跑 `check_all`；断了就只修 `hzatlas.js`，不去改上游文件 |
| 共享文件 `core/seq.js`、`fx.js`、`look.js` 被大阪城那条线改坏 hz | 同上，`check_make` 对 `HZ.make()` + `HZ.audit()` 的计数与 `zero === true` 做断言（当前基线：活动 55、格 1 432、提升器 32、D = 5.8） |
| fork 落后太多，PR 出现无关 diff | 每张卡开工前先 `--ff-only` 同步 fork main 到上游 main；分支只从同步后的 main 切；PR 只含新增文件 |
| 协作者的回路不知道有 `hzatlas.html` 存在，重构时顺手改掉 `__pv` | 第一阶段结束时由委托人把 `docs/hz-atlas-check.md` 的「依赖接口清单」转给协作者（这是人与人的握手，不是 PR 能解决的） |
| `?v=` 缓存版本号 | 我们不碰；`hzatlas.html` 用 `fetch` 取当前 `hzwest.html` 原文再注入，天然跟随上游版本号 |

**握手条件（进入第二阶段第 7、8 项的前提）：** 协作者确认其本地副本已合入我们的改动，或其回路改为「先拉取再推送」，或回路已停止。满足之一后才允许改现有文件。

### 2.2 编号迁移风险

| 风险 | 说明 | 应对 |
|---|---|---|
| A ↔ S 同号不同义 | `A-101`（网架平面）≠ `S-101`（地下）；`A-301`（横剖面）≠ `S-301`（整体提升） | 禁止字面替换；只按 §1.4 的映射表走；登记表的 `check_atlas` 断言「任何 A 号别名都不得解析到同数字的 S 页」 |
| 深链失效 | `#sheet=S-301&focus=J23` 已对外可用（set2b 起） | 页号不改；新增 `sub=` 只做增量；`check_atlas` 断言 `S-000`、`S-301` 仍在登记表且 `on = 1` |
| `body` 类名与 CSS 绑定页号 | `body.s000 / body.s301`、`#rd` 显示、`#col` 隐藏全靠页号 | 不改页号即无风险；新页面（第二阶段）必须沿用同一规则 |
| 标题栏放不下 | `frame()` 按宽度从右往左裁日期 / 比例 / 校核 | 新全号与 `HZW-S-301-1` 等长（11 字符），无新增风险；第二阶段若出现两位数子图序号需再评估 |
| 历史文档引用旧号 | `goal/CHANGELOG.md`、`hzsheet.js` 头注释、PLAYBOOK 提到 A-301 / A-101 / A-501 | 不改历史；登记表的别名字段保留追溯；新文档只写新号 |
| 两处图号来源打架 | 第一阶段：函数内字面量仍是 A 号，包装层覆盖成 S 号 | `check_sheets` 同时记录「函数自报图号」与「包装后图号」，两者都入断言；第二阶段清退字面量后把「自报图号」断言改成 S 号 |

### 2.3 不该投入的方向（本阶段判断）

1. **重写或大改 `hzview.js`**（733 行、上游每小时在动）。任何「顺手重构」都会在下一轮被覆盖或制造冲突。
2. **把页面改成 ES module / 加打包器 / 加 npm 依赖**。现有体系是裸 `<script>` + `window.*` 全局，大阪城那条线也如此；换体系等于和整个仓库的工作流对着干。
3. **在沙箱里装 jsdom / puppeteer / playwright 来「模拟浏览器验收」**。上游 PLAYBOOK §7 已明确：DOM / 数字检查可在 VM 上跑，但验收必须在 Mac 真 GPU 上跑——那是协作者和委托人的事。沙箱只做静态与无头脚本，不要假装能验收版式。
4. **为「成品形态」再建一个三维模型**。成品就是同一模型 `t ≥ OPEN` 的终态；再建一份会破坏「同源」这个最大卖点。
5. **现在就做 JSON → `build()` 的反向数据产线**。没有第二个项目之前这是纯成本；且 `build()` 被上游高频修改，反向产线会一直追着别人跑。
6. **现在就开 S-101 / S-201 / S-401 / S-501 四个新页面**。每页都要改上游文件；且没有新的绘制函数，开页等于空页。
7. **收集实物照片**。许可、来源、机位配准都是内容工作，不是第一阶段的工程工作；入口立好后再谈。
8. **把 S 页号改名**（比如改成 `S-100` 系列或加前缀）。深链、CSS、阶段条全绑定在现有页号上，收益为零。
9. **性能优化、移动端适配、新的 3D 效果**。与「四形态共用一个编号」无关，上游正在做自己的版本。
10. **碰大阪城文件**。零相关、高风险。

---

## 第三部分 第一阶段任务卡

通用约定（每张卡都适用，执行者照做，不自行发挥）：

- 仓库：`tanxinhao2026-netizen/osaka-castle-3d`（本 fork）；上游：`changrong996-droid/osaka-castle-3d`。
- 分支命名：`hz/<卡号>-<短名>`，例如 `hz/01-harness`。每卡一分支一 PR，PR 目标为上游 `main`，PR 标题前缀 `[hz-atlas] `。
- **只允许新增文件**，改动文件范围以外的任何文件出现在 `git diff --stat` 里即不合格。
- 所有脚本用 Node ≥ 18 内置模块（`fs`、`path`、`vm`），不 `require` 第三方包，不新增 `package.json`。
- 脚本成功时退出码 0 并打印以 `OK ` 开头的汇总行；失败时退出码 1 并打印以 `FAIL ` 开头的原因。
- 文件头第一行写 `'use strict';`，第二行一句话注释说明用途；其余注释只写非显然的约束。
- 验证方式一栏里的命令，执行者必须真的跑一遍并把输出贴进 PR 描述。
- 卡与卡之间按编号顺序执行；HZ-00 是所有卡的前置。

### HZ-00 同步 fork 并建立工作分支

- **目标**：fork 的 `main` 与上游 `main` 完全一致，后续每张卡从干净基线切分支。
- **改动文件范围**：无（只动 git 引用）。
- **操作步骤**：
  1. `git remote add upstream https://github.com/changrong996-droid/osaka-castle-3d.git`（已存在则跳过）。
  2. `git fetch upstream main`。
  3. `git checkout main && git merge --ff-only upstream/main`；若 `--ff-only` 失败，停止并在 PR / 回复里报告「fork main 有本地提交，需人工决定」，不得 `--no-ff` 合并或强推。
  4. `git push origin main`。
  5. 每张后续卡：`git checkout main && git fetch upstream main && git merge --ff-only upstream/main && git checkout -b hz/<卡号>-<短名>`。
- **验收标准**：`git rev-parse main` 与 `git rev-parse upstream/main` 相同；`git status` 干净。
- **验证方式**：`git rev-parse main upstream/main`（两行哈希一致）；`git status --porcelain`（无输出）。

### HZ-01 无头基座与构件计数检查

- **目标**：在 Node 里加载 `core/seq.js`、`hzseq.js`、`hzsheet.js`，提供桩 2D 上下文；对 `HZ.make()`、`HZ.audit()` 做基线断言。
- **改动文件范围**：新增 `tools/hz/harness.js`、`tools/hz/check_make.js`。不改其它文件。
- **操作步骤**：
  1. `tools/hz/harness.js` 导出 `load(opts)`：
     - 用 `vm.createContext` 建全局对象 `G`，设 `G.window = G; G.self = G;`。
     - `G.document = { createElement: () => ({ width: 0, height: 0, getContext: () => makeCtx().g }) }`（`hzsheet.js` 的 `hatchOf` 需要）。
     - 依次 `vm.runInContext` 读入 `web/core/seq.js`、`web/hzseq.js`、`web/hzsheet.js`（路径相对仓根，用 `path.join(__dirname, '../../web', …)`）；`opts.extra` 为额外文件列表（后续卡用来加载 `web/hzatlas.js`、`web/hzreal.js`），在 `hzsheet.js` 之后加载。
     - 返回 `{ G, HZ: G.HZ, SEQ: G.SEQ, HZS: G.HZS, makeCtx }`。
  2. `harness.js` 导出 `makeCtx()`：返回 `{ g, calls, texts }`，`g` 为 Proxy：`measureText(s)` 返回 `{ width: String(s).length * 6 }`；`getTransform()` 返回 `{ a: 1 }`；`getImageData()` 返回 `{ data: new Uint8ClampedArray(48) }`；`createPattern()` 返回 `'pat'`；`canvas` 返回 `{ width: 800, height: 600 }`；`fillText(s)` / `strokeText(s)` 把 `s` 推入 `texts`；其余任意属性名返回空函数并在 `calls[name]` 计数；`set` 一律返回 `true`。
  3. `harness.js` 导出 `sheetCtx(no, overrides)`：返回绘制函数需要的 `ctx` 对象：`tb: (w, h, no0, name, t) => { ctx.seenNo = no0; return { tb: 20, no: no0, name, scale: '1:—', rev: 1, date: '—', chk: '—', chkOk: true }; }`，`lastVe: 1`，`view: { k: 1, px: 0, py: 0 }`，`hover: -1`，`sel: -1`，`zone: 0`，`cut: 0`，`hoverK: null`，`stroke: null`，`setScale: () => {}`；`overrides` 合并覆盖。
  4. `tools/hz/check_make.js`：调用 `load()`，执行 `HZ.make()`、`HZ.audit()`，断言：`HZ.acts.length === 55`、`HZ.cells.length === 1432`、`HZ.lifters.length === 32`、`Math.abs(HZ.D - 5.8) < 1e-9`、`audit.zero === true`、`Object.keys(HZ.K).length === 55`。任一不符打印 `FAIL check_make: <项> 期望 <x> 实得 <y>` 并 `process.exit(1)`。全部通过打印 `OK check_make acts=55 cells=1432 lifters=32 D=5.8 zero=true`。
  5. 若上游已改变这些计数（同步后首次运行就失败），执行者**不得改断言**，而是在 PR 描述里报告新旧值，由委托人裁定新基线。
- **验收标准**：`node tools/hz/check_make.js` 退出码 0 且打印 `OK check_make …`；`node --check` 两个文件通过；`git diff --stat main` 只含这两个新文件。
- **验证方式**：`node --check tools/hz/harness.js && node --check tools/hz/check_make.js && node tools/hz/check_make.js; echo exit=$?`；`git diff --stat main`。

### HZ-02 四张图纸的无头绘制检查

- **目标**：证明 `section / plan / lift / jack` 四个函数在代表性时刻都能完整执行，并记录它们自报的图号。
- **改动文件范围**：新增 `tools/hz/check_sheets.js`。依赖 HZ-01。
- **操作步骤**：
  1. `load()` 后 `HZ.make()`，`SH = HZS.make(HZ)`，`K = HZ.K`。
  2. 时刻集合固定为：`[0, K.deckS.start + 1, K.jig1.start + 5, K.lift1.start + 1.5, K.wlift.start + 2, K.head.end + 10, HZ.P.OPEN + 1]`。
  3. 画布尺寸固定为两档：`[560, 420]` 与 `[300, 160]`（后者模拟矮窗口）。
  4. 对 `{ section, plan, lift, jack }` × 时刻 × 尺寸，用 `makeCtx()` 与 `sheetCtx()` 调用 `fn(g, w, h, t, ctx)`；捕获异常即 `FAIL check_sheets: <fn> t=<t> <w>x<h> <message>`。
  5. 断言自报图号：`section → 'HZW-A-301'`、`plan → 'HZW-A-101'`、`lift → 'HZW-A-501'`、`jack → 'HZW-S-301-1'`（取 `ctx.seenNo`）。此断言在第二阶段清退字面量时才允许改。
  6. 断言每次调用 `calls.fillRect >= 1`（至少画了图框底）且 `texts.length >= 1`（至少写了标题栏）。
  7. 通过时打印 `OK check_sheets fns=4 times=7 sizes=2 runs=56`。
- **验收标准**：退出码 0，打印上述 `OK` 行；`git diff --stat main` 只含一个新文件。
- **验证方式**：`node tools/hz/check_sheets.js; echo exit=$?`。

### HZ-03 图号登记表与一致性检查

- **目标**：建立「一个编号、四个形态」的单一数据源，并静态核对它与现有代码一致。
- **改动文件范围**：新增 `web/hzatlas.js`（本卡只写登记表与纯函数部分，不写 DOM 部分；DOM 部分在 HZ-04 追加到同一文件）、`tools/hz/check_atlas.js`。依赖 HZ-01。
- **操作步骤**：
  1. `web/hzatlas.js` 结构：`(function (G) { const HZA = {}; …; G.HZA = HZA; })(typeof window !== 'undefined' ? window : globalThis);`。
  2. `HZA.VERSION = 1`。
  3. `HZA.PAGES`（键为页号，顺序与 `hzview.js` 的 `SHEETS_ALL` 一致）：

     | 键 | `title` | `on` | `sheets` |
     |---|---|---|---|
     | `S-000` | `总图` | `1` | `[]` |
     | `S-101` | `地下` | `0` | `['S-301-3']` |
     | `S-201` | `承轨层` | `0` | `['S-301-3']` |
     | `S-301` | `整体提升` | `1` | `['S-301-1', 'S-301-2', 'S-301-3', 'S-301-4']` |
     | `S-401` | `屋面` | `0` | `['S-301-4', 'S-301-3']` |
     | `S-501` | `开通` | `0` | `[]` |

  4. `HZA.SHEETS`（键为短号）：每项字段固定为 `{ no, title, fn, canvas, owner, aliases }`：

     | 键 | `no` | `title` | `fn` | `canvas` | `owner` | `aliases` |
     |---|---|---|---|---|---|---|
     | `S-301-1` | `HZW-S-301-1` | `千斤顶平面布置 · 剖面净空` | `jack` | `sh-jack` | `S-301` | `[]` |
     | `S-301-2` | `HZW-S-301-2` | `屋盖提升图` | `lift` | `sh-s301-2` | `S-301` | `['HZW-A-501']` |
     | `S-301-3` | `HZW-S-301-3` | `横剖面 B–B · x = 39 m` | `section` | `sh-s301-3` | `S-301` | `['HZW-A-301']` |
     | `S-301-4` | `HZW-S-301-4` | `屋盖网架平面` | `plan` | `sh-s301-4` | `S-301` | `['HZW-A-101']` |

  5. `HZA.FORMS`（键为页号，四个槽位固定为 `sheet / grow / built / real`，每槽 `{ status, note }`，`status` 只取 `'有' | '部分' | '无'`）：
     - `S-000`：sheet 无「3D 总图无 2D 图纸」；grow 有「全工期 0 → OPEN+30」；built 部分「t ≥ OPEN 终态 + 竣工章，无验收字段」；real 无「见 hzreal.js」。
     - `S-301`：sheet 有「S-301-1…4」；grow 有「K.lift1.start → K.head.end，按小时加权」；built 部分「同上」；real 无「同上」。
     - 其余四页：sheet 部分「交叉引用」或 无；grow 有「包含在 S-000 时间轴内，无独立时间窗」；built 部分；real 无。
  6. 纯函数（不碰 DOM）：
     - `HZA.resolve(id)`：输入短号 / 全号 / 别名，返回短号；找不到返回 `null`。全号 → 短号规则：去掉前缀 `HZW-`。
     - `HZA.sheetsOf(page)`：返回 `PAGES[page].sheets` 中每个短号对应的 `SHEETS` 对象数组（含 `id` 字段），页不存在返回 `[]`。
     - `HZA.wrapFn(fn, no)`：返回 `(g, w, h, t, ctx) => fn(g, w, h, t, Object.assign({}, ctx, { tb: (w2, h2, _no, name, t2) => ctx.tb(w2, h2, no, name, t2) }))`——只替换图号，其余透传。
  7. `tools/hz/check_atlas.js`：`load({ extra: ['web/hzatlas.js'] })` 后断言：
     - `PAGES` 的键顺序与 `web/hzview.js` 源码里 `SHEETS_ALL` 的页号顺序一致，且每页 `on` 与源码第三列一致（用正则从源码文本提取：`/\['(S-\d{3})',\s*'[^']*',\s*(\d)\]/g`）。
     - `SHEETS` 每项 `fn` 在 `HZS.make(HZ)` 返回对象里存在且为函数。
     - `SHEETS` 每项 `no === 'HZW-' + 键`；`canvas` 值互不重复；`owner` 存在于 `PAGES`。
     - 所有别名全局唯一；每个别名解析得到的短号，其 `owner` 页的数字部分**不等于**别名中的数字部分（防 A-101 → S-101 的误映射）。
     - `PAGES[*].sheets` 中每个 id 存在于 `SHEETS`。
     - `resolve('HZW-A-501') === 'S-301-2'`、`resolve('S-301-3') === 'S-301-3'`、`resolve('HZW-S-301-4') === 'S-301-4'`、`resolve('X') === null`。
     - `sheetsOf('S-301').map(s => s.id)` 等于 `['S-301-1','S-301-2','S-301-3','S-301-4']`。
     - `wrapFn(SH.section, 'HZW-S-301-3')` 用 `makeCtx()` / `sheetCtx()` 在 `t = K.lift1.start + 1.5` 调用不抛错，且 `ctx.seenNo === 'HZW-S-301-3'`；对 `plan → HZW-S-301-4`、`lift → HZW-S-301-2` 同样断言。
     - 在 `web/hzwest.html` 源码中存在 `id="sh-jack"`；`SHEETS['S-301-1'].canvas === 'sh-jack'`。
     - 通过时打印 `OK check_atlas pages=6 sheets=4 aliases=3`。
- **验收标准**：`node tools/hz/check_atlas.js` 退出码 0；`node --check web/hzatlas.js` 通过；`git diff --stat main` 只含两个新文件；HZ-01、HZ-02 仍通过。
- **验证方式**：`node --check web/hzatlas.js && node tools/hz/check_atlas.js; echo exit=$?`；`node tools/hz/check_make.js && node tools/hz/check_sheets.js`。

### HZ-04 旁路接线：S-301 子图 2/3/4 与入口壳

- **目标**：不改任何现有文件，让 `web/hzatlas.html#sheet=S-301&sub=3` 在右栏显示横剖面（图号 `HZW-S-301-3`），`sub=1..4` 可切换，时间轴变化时该图随时刻重画。
- **改动文件范围**：修改 `web/hzatlas.js`（HZ-03 创建，追加 DOM 部分）、新增 `web/hzatlas.html`。依赖 HZ-03。
- **操作步骤**：
  1. `web/hzatlas.html` 全文固定为：`<!DOCTYPE html><meta charset="UTF-8"><title>杭州西站 · 图册（hzatlas 壳）</title><script>fetch('hzwest.html',{cache:'no-store'}).then(r=>r.text()).then(h=>{document.open();document.write(h.replace('</body>','<script src="hzatlas.js?v=1"></scr'+'ipt></body>'));document.close();}).catch(e=>{document.body.textContent='加载 hzwest.html 失败：'+e.message;});</script>`。要求：必须经静态服务器打开（`python3 -m http.server`），`file://` 下 `fetch` 会失败并显示上述提示。
  2. `web/hzatlas.js` 追加 DOM 部分，整段用 `if (typeof document === 'undefined' || !document.getElementById) return;` 守卫（Node 下直接跳过），并在 `G.__pv` 就绪后执行：轮询 `G.__pv && G.__pv.ready`，间隔 50 ms，最多 600 次（30 s），超时打印 `console.warn('hzatlas: __pv 未就绪')` 并放弃。
  3. 就绪后的动作（函数名固定 `HZA.mount()`，可重复调用但只挂载一次）：
     - `S = G.__pv`；若 `!S.SHEETS || !S.SH || !S.layout` 则 `console.warn('hzatlas: __pv 接口缺失')` 并返回。
     - 读 `const col = document.getElementById('col')`；不存在则返回。
     - 注入 `<style id="hzatlas-css">`：`#col{grid-template-rows:auto minmax(0,1fr)!important}#hz-subtabs{display:flex;gap:4px;font-family:var(--mono);font-size:12px}#hz-subtabs .st{padding:3px 8px;border:1px solid var(--line);border-radius:3px;cursor:pointer;background:#fbf9f5}#hz-subtabs .st.on{background:var(--ink);color:#fff}#col canvas.sheet.hz-off{display:none}`。
     - 在 `col` 最前面插入 `<div id="hz-subtabs">`，为 `HZA.sheetsOf('S-301')` 的每项建一个 `<span class="st" data-id="短号">全号</span>`。
     - 对 `sheetsOf('S-301')` 中 `canvas !== 'sh-jack'` 的每项：创建 `<canvas id="<canvas>" class="sheet hz-off" aria-label="<全号> <title>">` 追加到 `col`；向 `S.SHEETS` `push({ id: canvas, fn: HZA.wrapFn(S.SH[fn], no), no, el, key: '', drawn: 0, n: 0, scale: '' })`。**不得**改动 `S.SHEETS[0]`（jack 的交互代码按下标 0 取它）。
     - `HZA.setSub(k)`（k 为 1..4）：给对应画布去掉 `hz-off`、其余加上 `hz-off`（含 `sh-jack`）；更新子标签 `on` 类；把 hash 里的 `sub` 参数设为 `k`（用 `history.replaceState`，保留其它参数）；调用 `S.layout()`（它会清空全部 `key` 并置 `sheetsDirty`）。
     - 初始 `sub` 取自 `location.hash` 的 `sub` 参数，非 1..4 一律当 1；只在 `S.sheet === 'S-301'` 时显示子标签，`S-000` 下 `#col` 本就被 CSS 隐藏，不需处理。
     - 监听 `hashchange`：若 `sheet` 变为 `S-301` 则按 `sub` 重新 `setSub`，否则不动。
     - 子标签 `onclick → HZA.setSub(k)`。
  4. 不监听、不改写 jack 画布上的任何指针 / 滚轮事件。
- **验收标准（沙箱可做的部分）**：
  - `node --check web/hzatlas.js` 通过；`node tools/hz/check_atlas.js` 仍通过（证明 DOM 守卫有效，Node 下不抛错）。
  - 在 `check_atlas.js` 中追加（本卡允许修改该脚本）：源码静态断言 `web/hzatlas.js` 含字符串 `HZA.mount`、`HZA.setSub`、`hz-subtabs`、`S.SHEETS.push`，且**不含** `S.SHEETS[0] =`、`S.SHEETS.splice`、`S.SHEETS.length = `；`web/hzatlas.html` 含 `fetch('hzwest.html'` 与 `hzatlas.js?v=`。
  - `git diff --stat main` 只含 `web/hzatlas.js`、`web/hzatlas.html`、`tools/hz/check_atlas.js`。
- **验收标准（沙箱不可做、由委托人在浏览器做，PR 描述里必须写明「待委托人浏览器确认」）**：在静态服务器下打开 `web/hzatlas.html#sheet=S-301&sub=3`，右栏出现横剖面，标题栏图号为 `HZW-S-301-3`；点子标签切到 `sub=1` 后千斤顶图的滚轮缩放、点吊点飞镜头仍正常；拖时间轴时当前子图随时刻变化。
- **验证方式**：`node --check web/hzatlas.js && node tools/hz/check_atlas.js; echo exit=$?`；`python3 -m http.server 8000 --directory web` 后由委托人按上条打开。

### HZ-05 实物层入口：记录格式与校验

- **目标**：为「实物」槽位定下记录格式并给出校验脚本；本卡**零内容**，只有格式与一条示例记录（示例标记为 `example: true`，校验时跳过来源核对但仍校验字段）。
- **改动文件范围**：新增 `web/hzreal.js`、`tools/hz/check_real.js`。依赖 HZ-03。
- **操作步骤**：
  1. `web/hzreal.js` 结构同 `hzatlas.js`，导出 `G.HZR`，`HZR.VERSION = 1`，`HZR.RECORDS = [ … ]`。
  2. 每条记录字段固定（顺序与名称不可改）：

     | 字段 | 类型 | 约束 |
     |---|---|---|
     | `id` | string | `R-` + 4 位数字，全局唯一 |
     | `sheet` | string | 必须是 `HZA.PAGES` 的页号或 `HZA.SHEETS` 的短号 |
     | `kind` | string | `'photo' | 'measure' | 'doc'` |
     | `date` | string | `YYYY-MM-DD` |
     | `t` | number 或 null | 施工日（天），`0 ≤ t ≤ HZ.P.OPEN + 30`；null 表示未对齐 |
     | `src` | object | `{ title: string 非空, url: string 以 http 开头, license: string 非空 }` |
     | `cam` | object 或 null | `{ az, el, d, tx, ty, tz }` 六个数字，与 `hzview.js` 的机位键同名同义 |
     | `note` | string | 可空 |
     | `example` | boolean | 可省略，示例记录为 `true` |

  3. 示例记录一条：`{ id: 'R-0001', sheet: 'S-301', kind: 'doc', date: '2021-06-30', t: null, src: { title: '央广网 2021-06-30（206 台提升器、6-28 提升完成）', url: 'http://news.cnr.cn/native/city/20210630/t20210630_525524643.shtml', license: '公开报道，仅引用' }, cam: null, note: '示例：来源取自 hzseq.js 的 HZ.SOURCES', example: true }`。
  4. `tools/hz/check_real.js`：`load({ extra: ['web/hzatlas.js', 'web/hzreal.js'] })`，`HZ.make()` 后对每条记录按上表逐字段断言；`id` 唯一；`sheet` 可被 `HZA.resolve` 或 `HZA.PAGES` 解析；通过时打印 `OK check_real records=<n> examples=<m>`。
- **验收标准**：`node tools/hz/check_real.js` 退出码 0 且 `records=1 examples=1`；`node --check web/hzreal.js` 通过；`git diff --stat main` 只含两个新文件。
- **验证方式**：`node --check web/hzreal.js && node tools/hz/check_real.js; echo exit=$?`。

### HZ-06 一键检查与说明文档

- **目标**：一条命令跑完 HZ-01…HZ-05 的全部检查；写一页说明给委托人与协作者。
- **改动文件范围**：新增 `tools/hz/check_all.js`、`docs/hz-atlas-check.md`。依赖 HZ-01…HZ-05。
- **操作步骤**：
  1. `check_all.js` 用 `child_process.spawnSync(process.execPath, [script], { stdio: 'inherit' })` 依次运行 `check_make.js`、`check_sheets.js`、`check_atlas.js`、`check_real.js`；任一退出码非零则立即打印 `FAIL check_all at <script>` 并退出 1；全部通过打印 `OK check_all 4/4`。
  2. `docs/hz-atlas-check.md` 内容固定为五节：① 怎么跑（`node tools/hz/check_all.js`）；② 四个检查各自断言什么（逐条抄自 HZ-01…05 的验收标准）；③ **旁路依赖接口清单**（`window.__pv` 的 `ready / sheet / SHEETS / SH / layout`、`ctx.tb(w,h,no,name,t)` 签名、`#col` 元素、`hashSync` 保留未知 hash 参数、`drawSheet` 跳过 `clientWidth < 20` 的画布）——这节是给上游协作者看的；④ 图号规则与映射表（抄 §1.4）；⑤ 上游同步后的例行流程（HZ-00 的 5 步 + 跑 `check_all`）。
  3. 文档全文中文，不写行号，只写函数名与文件名。
- **验收标准**：`node tools/hz/check_all.js` 退出码 0 且打印 `OK check_all 4/4`；文档含上述五节标题；`git diff --stat main` 只含两个新文件。
- **验证方式**：`node tools/hz/check_all.js; echo exit=$?`；`grep -c '^## ' docs/hz-atlas-check.md`（应为 5）。

### 第一阶段完成的定义

- HZ-00…HZ-06 的 PR 全部合入上游 `main`，且合入后在上游 `main` 上 `node tools/hz/check_all.js` 仍打印 `OK check_all 4/4`（证明没有被回路覆盖——新文件不会被覆盖，这一条主要验证共享文件没有改坏我们）。
- 委托人在浏览器里确认 `hzatlas.html#sheet=S-301&sub=2/3/4` 三张图可见、图号为新号、`sub=1` 下原有交互不变。
- `docs/hz-atlas-check.md` 的「旁路依赖接口清单」已交给上游协作者。

满足以上三条后，进入第二阶段（§1.1 第 6–9 项）。

---

附：本次核查用到的命令（供复核，不入库）
- 上游节奏：`git fetch --depth=40 https://github.com/changrong996-droid/osaka-castle-3d.git main && git log --format='%h %ad %s' --date=iso-strict FETCH_HEAD -40`
- 落后计数：`git rev-list --count HEAD..FETCH_HEAD`（结果 40）
- 无头绘制验证：Node 24，`vm.createContext` + Proxy 桩上下文，四函数 × 7 时刻全部通过。
