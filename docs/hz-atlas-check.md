# 杭州西站图册 · 一键检查与旁路接口说明

## 一、怎么跑

一条命令跑完全部检查：

```
node tools/hz/check_all.js
```

逐项单独跑：

```
node tools/hz/check_make.js
node tools/hz/check_sheets.js
node tools/hz/check_atlas.js
node tools/hz/check_real.js
```

读法：

- 每个脚本成功时退出码 0，并打印以 `OK ` 开头的汇总行；失败时退出码 1，并打印以 `FAIL ` 开头的原因。
- `check_all.js` 按上面的顺序依次运行，任一退出码非零即停，打印 `FAIL check_all at <脚本名>` 并以 1 退出；四个全过打印 `OK check_all 4/4`。
- 看到 `FAIL check_all at …`，往上翻同一屏里该脚本自己打印的 `FAIL` 行，那才是具体原因。
- 环境要求：Node ≥ 18，只用内置模块，无第三方依赖，无需 `npm install`；脚本路径不依赖当前工作目录。

## 二、四个检查各自断言什么

### check_make（HZ-01：无头基座与构件计数）

- `HZ.acts.length === 55`、`Object.keys(HZ.K).length === 55`：防活动表被悄悄增删或键名漏改。
- `HZ.cells.length === 1432`：防构件总数变了而没人发现。
- `HZ.lifters.length === 32`：防提升器数量被改动。
- `Math.abs(HZ.D - 5.8) < 1e-9`：防整体提升高度被改动。
- `HZ.audit().zero === true`：防构件审计出现非零差错（漏装、重复、对不上）。
- 若上游改变了这些计数，不得改断言，先报告新旧值，由委托人裁定新基线。

### check_sheets（HZ-02：四张图纸的无头绘制）

- 四个绘制函数 `section / plan / lift / jack` × 7 个代表时刻 × 2 档画布尺寸（560×420 与 300×160），共 56 次调用：防某个时刻或矮窗口下绘制函数抛异常。
- 每张图自报图号必须符合约定（取 `ctx.seenNo`）：防图号字面量被误改。
- 每次调用至少 `fillRect` 一次且至少写一条文字：防图框和标题栏没画出来。
- 通过时打印 `OK check_sheets fns=4 times=7 sizes=2 runs=56`。

### check_atlas（HZ-03 / HZ-04：登记表与一致性）

- `PAGES` 的页序与每页 `on`，与 `web/hzview.js` 源码里 `SHEETS_ALL` 一致：防登记表与页面实际页序脱节。
- `SHEETS` 每项 `fn` 在 `HZS.make(HZ)` 返回对象里存在且为函数：防登记了不存在的绘制函数。
- `no === HZA.PROJECT + '-' + 键`、`canvas` 互不重复、`owner` 存在于 `PAGES`：防编号写错、画布 id 撞车、归属页悬空。
- 别名全局唯一，且每个别名经 `resolve` 必须解析到登记表中挂着它的那张子图：防 `A-101 → S-101` 这种字面替换的误映射。（原卡面的「别名数字 ≠ 所属页数字」写法与 A-301 数据自相矛盾，已经指挥官仲裁改为本式，理由见 check_atlas.js 头部注释。）
- `PAGES[*].sheets` 里的每个 id 都在 `SHEETS` 中：防页面引用不存在的图。
- `resolve` 的别名解析、短号、全号、未知输入（返回 `null`）各一例；`sheetsOf('S-301')` 顺序为 1、2、3、4：防解析函数回归。
- `wrapFn` 改号：对 `section / plan / lift` 调用后，`ctx.seenNo` 分别为 `HZW-S-301-3 / -4 / -2`：防改号包装漏改或多改。
- `web/hzwest.html` 中存在 `id="sh-jack"`，且 `S-301-1` 的 canvas 为 `sh-jack`：防原页面改掉千斤顶画布 id。
- `web/hzatlas.js` 含 `HZA.mount`、`HZA.setSub`、`hz-subtabs`、`S.SHEETS.push`，且不含 `S.SHEETS[0] =`、`S.SHEETS.splice`、`S.SHEETS.length = `：防旁路代码动到原页面的图纸数组下标 0。
- `web/hzatlas.html` 含 `fetch('hzwest.html'` 与 `hzatlas.js?v=`：防入口壳被改坏。
- 通过时打印 `OK check_atlas pages=6 sheets=4 aliases=3`。

### check_real（HZ-05 及附则：实物记录与两把时间尺）

- 每条记录的字段格式：`id` 为 `R-` + 4 位数字且唯一；`sheet` 能被登记表解析；`kind` 只取 `photo / measure / doc`；`date` 为 `YYYY-MM-DD`：防记录字段写歪。
- `t` 为 null 或数字，且 `0 ≤ t ≤ HZ.P.OPEN + 30`：防模型时刻越界。
- 两把时间尺：`date`（实际日历）与 `t`（模型时刻）相互独立，脚本不断言两者有换算关系，只在两者都非空时打印偏差天数：防把两把尺混成一把。
- `src` 必须有非空 `title`、非空 `license`；`url` 三选一：`http(s)://` 外链、仓库相对路径、空串（空串时 `license` 必须为 `own`）：防来源不明的素材混入。
- `cam` 为 null 或 `az / el / d / tx / ty / tz` 六个数字：防机位缺键。
- `anchor` 可选，非空时必须能解析为焦点值或活动键：防锚点指向不存在的东西。
- 字段表之外的未知键只警告不报错，不断言字段顺序：防过严而妨碍扩展。
- 通过时打印 `OK check_real records=<n> examples=<m>`，目前为 `records=1 examples=1`。

## 三、旁路依赖接口清单

给上游协作者 hark-cr 看：外挂的 hzatlas 依赖原页面以下接口，改版时请勿破坏；如需变更，请先在仓库里打招呼。

1. **`window.__pv`**：在初始化末尾经 `Object.assign` 暴露 `ready / sheet / SHEETS / SH / layout`。hzatlas 轮询 `ready`，就绪后才挂载。
2. **`SHEETS` 数组**：下标 0 恒为千斤顶图（交互代码按下标取它）。hzatlas 只向其尾部 `push` 新图纸，不改下标 0、不 `splice`、不改 `length`。
3. **图纸绘制调度**：一帧最多画一张，按 `drawn` 最旧优先；`drawSheet` 对 `clientWidth < 20` 的画布直接跳过且不更新 `drawn`。因此隐藏画布绝不能用 `display:none`（会饿死可见图）；hzatlas 用 `visibility:hidden + position:absolute` 保住尺寸。代价是隐藏的图也在画（S-301 页绘制量约 ×4）。
4. **绘图函数签名** `fn(g, w, h, t, ctx)`：图号经 `ctx.tb(w, h, no, name, t)` 上报。hzatlas 用 `wrapFn` 只替换图号，不动其余。
5. **页面元素**：`#col` 容器与 `#sh-jack` 画布 id 不变；hzatlas 新增画布的 id 即登记表的 canvas 字段（`sh-s301-2 / sh-s301-3 / sh-s301-4`）。
6. **hash 约定**：参数 `sheet`、`sub`。原页面 `hashSync` 保留未知 hash 参数（hzatlas 靠此共存）；hzatlas 改 `sub` 时用 `history.replaceState` 并保留其它参数。
7. **`hzview.js` 中 `SHEETS_ALL` 的源码字面格式**：check_atlas 用正则从源码提取页序与 `on` 列，改动该字面格式会让检查失效或变红。
8. **壳页 `hzatlas.html`**：用 `fetch` 载入 `hzwest.html`，并注入 `hzatlas.js?v=<版本>`。**`hzatlas.js` 每次改动必须升版本号**，否则浏览器缓存旧版（已实测踩过）。

## 四、图号规则与映射表

规则（来自方向备忘录 §1.4 与第一阶段附则）：

- S 为准，A 退为别名。A 与 S 不是同号同义（`A-101` 是屋盖网架平面，`S-101` 是地下；`A-301` 是横剖面，`S-301` 是整体提升），禁止字面替换，只按下表映射。
- 规范形：`<项目码>-S-<页号>-<子图序号>`，子图序号自 1 起。项目码由常量 `HZA.PROJECT` 定义，西站为 `HZW`；除登记表自身外，代码中不得再写死 `'HZW-'`。
- 登记表内部用短号（如 `S-301-2`），标题栏用全号（如 `HZW-S-301-2`）。页号不改。
- 旧号全部进别名表，只读不写，新代码不得再产生 A 号。
- 一张子图可被多个页引用（「详见某图」），标题栏永远显示子图自己的图号。
- 深链：`#sheet=S-301&focus=J23` 原样保留；子图切换用 `sub=<序号>`，缺省为 1。

映射表（以 `web/hzatlas.js` 登记表为准）：

| 短号 | 全号 | 图名 | 别名 | 绘制函数 | 画布 id |
|---|---|---|---|---|---|
| S-301-1 | HZW-S-301-1 | 千斤顶平面布置 · 剖面净空 | 无 | `jack` | `sh-jack` |
| S-301-2 | HZW-S-301-2 | 屋盖提升图 | HZW-A-501 | `lift` | `sh-s301-2` |
| S-301-3 | HZW-S-301-3 | 横剖面 B–B · x = 39 m | HZW-A-301 | `section` | `sh-s301-3` |
| S-301-4 | HZW-S-301-4 | 屋盖网架平面 | HZW-A-101 | `plan` | `sh-s301-4` |

## 五、上游同步后的例行流程

1. `git fetch upstream`，看上游前进了几个提交、动了哪些文件。
2. fork 的 main 合入 upstream/main。
3. 跑 `node tools/hz/check_all.js`，全过才继续。
4. 任一检查变红即停下报告，不带病推送（多半是接口被上游改动碰到，对照第三节清单定位）。
5. 推送 fork 的 main。我方新成果回上游走 PR。
