# 睡点 · 关键更新记录

## 2026-10-27 · 计算器结果面：翻面不再让整页上移 + 回显等比例放大 + 操作分两行

背景（用户两轮反馈）：①翻面时结果态把副标 `max-height` 压成 0、标题又从 72rpx 缩到 40rpx，hero 一下矮约 90rpx，卡片与页脚整体上跳；②回显太小，且「去入睡打卡」与「换成…」的位置该互换、后者不该有按钮底。舞台高度本来就固定 712rpx，收副标换不来任何空间——只是位移。

- **首行等高**：新增 `--calc-hero-line: 83rpx`（= 主字号 72rpx × 1.15）。正面问句与背面回显同高；回显外层 `align-items:center` 锁定高度、内层 `.hero-echo-line` 只做基线对齐。窄屏 `@media (max-width:360px)` 同步 `--calc-hero-size:64 / --calc-hero-side:38 / --calc-hero-line:74`。
- **回显等比例放大**：时间 `40 → 72rpx`（与问句同号）、「今天/明天 时段」与「起床/入睡」`24 → 43rpx`（同比例 0.6），提问与回显形成「输入 → 输出」的对称。
- **结果态副标**：由「收起（max-height:0）」改为「视觉隐藏但保留占位」（`visibility: hidden`）——提示文案去掉，高度不动。
- **操作重排**：上行「提醒我入睡/起床 + 换成我想几点睡/起」，下行「‹ 返回 + 去入睡打卡」；`换成…` 去背景框（`background: transparent`、`padding: 0`、`margin-left: auto`），右缘与主按钮对齐；dense 规则拆成两条免得 `padding: 0 20rpx` 又把无框按钮撑回去；`.result-extra` 的 `margin-top` 24 → 16rpx，抵消主 CTA 换行后把该行从 72 撑到 80rpx 的 8rpx。
- **singlePage（朋友圈单页）**：`singlePage` 条件从「整块隐藏」下放到按钮——「换成…」是页内动作，保留；提醒与去打卡是跨页动作，仍隐藏。
- **验证**：模拟器实测翻面前后 `hero top/height = 91/77.5`、`card top = 182.5`、脚注 `top = 646.5` 完全一致；`result-share` 两态高度均 33px（未被 flex 压缩）；`tests/calc-copy.test.js` 9/9；`npm test` 438/437/0 fail/1 skip；`npm run check` 通过（695.8 KB）。

## 2026-10-27 · 统计页详情卡补齐「改 / 删」：历史记录不再是单向门

背景：用户点开 10-21 的格子，详情卡只有「补记一段」（只能加）。取证：入睡页的 `onEditSession` / `onDeleteSession` 都有 `day !== record.day` 守卫——只作用于当天；**历史日期在整个 App 里没有任何修正入口**，补记错了只能继续补记。底层 `storage.updateSession(day, id, ...)` / `removeSession(day, id)` 本来就接收任意 day，缺的只是 UI。

- **详情卡逐段操作**：有记录日新增段列表（`13:00–14:30 · 1 小时 30 分` + `改 / 删`）；跨自然日的段标「次日」，否则 `22:58–18:23` 会被读成倒序；`canEdit` 与补记同窗口（400 天）。
- **改**：复用页内补记面板的编辑态——标题「修改这一段」、醒来日只读、预填该段起止、按钮「保存修改」；保存走 `storage.updateSession`（内含重叠、24h 上限、跨天查重、v1 迁移）。
- **校验排除自身**：`manual-sleep.evaluateManualRange` 新增 `excludeId`（同时透传给 `capacityErrorOf`），否则「只挪一分钟」会命中自己判成重叠、8 段日里编辑也会被当成「第 9 段」。
- **删**：`wx.showModal` 确认 → `storage.removeSession`；删到最后一段时整天撤销并写墓碑（`tombstoneTime` 保证晚于记录 `updatedAt`，防云端回填），与入睡页删除语义完全一致。
- **醒来日守卫**：多段日改到别天会把一段拆到另一个归档日（`updateSession` 内部会拒且无文案），面板先给可读提示「这天有多段：改醒来日会把记录拆到另一天，请先删除其它段」；单段日允许随起床时间迁移，成功后提示「已移到 X」并把选中态/详情卡落到实际的归档日。
- **时序加固**：时间 picker 的 `setData` 回调是异步的，极快「选完就点保存」会用上一次的缓存区间（模拟器实测过 `_manualWakeAt` 仍为 0）。`saveManualSession` / `saveEditSession` 开头同步重算一次（`computeManualSheet`），有错误则 toast 不落库。
- **测试**：`manual-sleep` 新增 2 条（排除自身不算重叠、8 段日编辑不按第 9 段拒）；`stats-page` 新增 2 条（改：段数不变且时长更新、详情卡跟着刷新；删：多段日只删该段 / 删光整日撤销）。
- **验证**：`npm test` 438 项 / 436 通过 / 1 失败 / 1 skip（唯一失败是并行 tabbar 改动留下的 `wx.switchTab` 断言）；`npm run check` 通过（695.8 KB）；模拟器实测：10-21 两段 → 改起床 14:30→15:00 后详情与存储同步（1h30→2h）、删一段当天保留、删第二段整天撤销（`detail=null`）。

## 2026-10-27 · 日历格内时长改为精确到分钟（与详情同源）

背景：用户点开 10-21 的格子（格内 `6.1h`），详情却写「共 6 小时 05 分」，怀疑数据对不上。核实：同一份 365 分钟数据——格内 `fmtHoursShort` 按 0.1 小时四舍五入（`Math.round(365/6)/10` = `6.1h` ≈ 6 小时 6 分），详情 `fmtDuration` 精确到分钟。是精度不一致，不是数据错，但用户无从分辨。

- `format.fmtHoursShort` 改为 `6h05 / 45m`（`Math.floor(min/60) + 'h' + pad2(min%60)`）：格内与详情数字逐位一致；不足 1 小时仍是 `45m`，无记录返回空串。
- 宽度复核：格 92rpx、字号 19rpx，`6h05` 5 字符约 48rpx；`10.1h` 本来就是 5 字符，不挤（模拟器截图确认）。
- 唯一消费方是 `components/month-calendar`（1 年视图 `calendar-strip` 不显示时长），海报/分享仍用 `fmtHours`（canvas 空间有限，保留一位小数）。
- 测试：`tests/format.test.js` 新增 1 条（365→`6h05`、219→`3h39`、60→`1h00`、45→`45m`、0→`''`，并与 `fmtDuration(365)='6 小时 05 分'` 对齐）。
- 验证：`node --test tests/format.test.js` 3/3；`npm run check` 通过（685.2 KB）；模拟器格内 `6h53` 与详情「6 小时 53 分」一致。

## 2026-10-27 · 统计页移除标题区与「按均值定今晚」入口

背景：用户要求两处一起移除（截图圈选）——①页面顶部整块标题区（REVIEW / 回顾 / 副标）；②指标下方的「按本周均值（HH:MM）定今晚上床点 →」入口。理由：标题区在只有三个数字的页面上是纯装饰，删掉后首屏直接从周期行开始；入口是统计页唯一的建议型入口，与「只陈述事实、不评价不建议」的产品立场冲突，且均值可能只由 1–3 天得出，用它定"今晚"代表性弱。

- **标题区**：`stats.wxml` 的 `stats-hero`（eyebrow + 标题 + 副标）与 `stats.wxss` 的 `.stats-hero / .stats-hero .title-xl`（含 `margin-bottom: 34rpx`）整体删除；页面顶部只剩 `top-bar` 与周期行。上一轮刚改的副标「记录每一天的睡眠数据」随块一并移除。
- **入口**：`stats.wxml` 的 `week-plan` 块、`stats.wxss` 的四组样式（`.week-plan/-k/-arrow/--tap`）删除；`stats.js` 删除 `planLabel/bedPrefill/_avgBedMin`、`onPlanFromAverage`、签名项与 setData 字段；首页 `onShow` 里消费 `meta.prefillSleepMin` 的整块删除（不再有写入方）。
- **测试**：删除 `tests/stats-page.test.js`「按本周均值定今晚上床点」与 `tests/index-page.test.js`「首页消费统计页预填」两条用例。
- **文档**：`docs/13` §1.25 改为「已移除」并附原因、§1.30/§1.32 里对入口与 `subOf` 的描述同步；`docs/14` 真机项 C3 删除；`context.md` 第 40 条改记为已移除、第 43 条去掉入口提及。
- **验证**：`node --test tests/stats-page.test.js tests/index-page.test.js` 24 项 / 23 通过（唯一失败是并行 tabbar 改动的 `wx.switchTab` 断言）；`npm run check` 通过；模拟器实测首屏无标题区、无入口，指标与日历位置正常。

## 2026-10-27 · 统计页首屏去噪：指标卡只留数字，对比下沉到说明卡

背景：用户反馈指标卡下方的「比上周…」一行变化与点击后的说明卡重复，首屏显得吵；左上副标「只看数据，不做评价」是态度而非内容，读不出这一页是什么。

- **副标**：`只看数据，不做评价` → `记录每一天的睡眠数据`（说明页面内容；"不评价/不建议"的立场仍由说明卡里的纯事实文案承担）。
- **指标卡**：删除卡面副标（形如「比上周同期多 1h20m」），卡面只留「大数字 + 短标签」；三列等高、整体矮约 31rpx。
- **说明卡**：`平均睡眠` 补一行 `compareLine`（原先只在卡面出现，`detail` 里没有）→ duration 4 行、bed/wake 仍 3 行；对比文案统一用全称（「比上周同期多 2 小时 50 分」），不再用 `h/m` 紧凑写法。
- **清理**：`deltaAmount`、`subOf`、`metrics[].sub` 字段删除；页面刷新指纹改拼 `detail`（否则说明卡内容变但数字未变时会漏刷）；`.metric-sub` 与 `.metric--duration .metric-sub` 样式删除。
- **测试契约同步**：`tests/stats.test.js`、`tests/stats-calendar.test.js` 里 6 处 `sub` 断言改为断言 `detail` 里的对比行；「上周无记录不编造对比」改为逐行 `/^比/` 统一校验。
- **验证**：`node --test tests/stats.test.js tests/stats-calendar.test.js` 33/33；`npm run check` 通过（688.3 KB）；`npm test` 435/432 pass/2 fail/1 skip——两条失败是并行 tabbar 改动（`wx.switchTab` → `tabbar.switchTo`）留下的 `stats-page` 断言，与本轮无关。模拟器：首屏三列只有数字，点「平均睡眠」展开 4 行（含「比前 7 天少 59 分钟」）。

## 2026-10-27 · 统计页日历色阶：同色相由弱到强 + 图例连成色阶条

背景：用户反馈「睡越短颜色越深、睡越久是白色背景」，怀疑色阶方向反了。核实：方向本就是「越久越亮」（`docs/09` 原文「颜色越亮 = 睡得越久」），真问题在两个端点——`#E0E7FF` 近白在夜墨底上像「空格/高亮」，格内文字被迫翻成深色、整格反相；`#3F3C9E` 与 `#5B57D6` 在深底上只差一档且贴近空格 `rgba(255,255,255,.045)`。

- **色阶（4 处同步）**：`#5A57C8` → `#6C68E8` → `#8A90FF` → `#A5B4FC`（实色品牌紫，对空格约 3.1 / 4.1 / 6.6 / 9.2 比 1）；**最高档刻意停在浅紫、不近白**。落点：`components/month-calendar`、`components/calendar-strip`（1 年视图）、`pages/stats` 图例、`stats.js` `drawPoster` 的 canvas `colors`。文字色同步：低两档浅字（`#EDEEFF` / `#F8FAFC`）、高两档深字（`#1E1B4B`）。
- **色阶必须是实色，不能用半透明**：首版用 `rgba(139,135,255,.22)`，在夜墨底上叠出 rgb(37,38,72)，与空格 `rgba(255,255,255,.045)` 只有约 **1.25:1** —— 比改造前的 `#3F3C9E`（约 2.0:1）更差，<4h 的日子会被看成"没打卡"。改为实色后最低档 3.1:1，过 WCAG 非文本 3:1。
- **图例**：4 个分离小方块 → 4 段连成一条色阶条 + 下方 4 档区间标签（`＜4h / 4–6h / 6–8h / 8h+` 分别居中于各段），一眼读出「弱 → 强」的连续强度。首段也必须可见（半透明版首段对页面底只有 1.36:1，整条看起来像只有三段）。
- **语义边界**：只表达「记录时长越长」，不表达「睡得更好」；图例不写评价词。
- **审查连带修复（子代理独立审查 P2）**：①分享标题写死「本周打卡 N 天」，回退到最近 7 天/全部记录时口径错 —— 改为主语取 `periodLabel`；②回退注脚在「全部记录」周期仍只写「本周还没有记录」—— 新增 `periodFallbackNote`，两处文案：「本周还没有记录」/「本周与最近 7 天都没有记录」；③补测试 3 条（`options.period` 显式指定不算回退、跨年区间 `12.28–01.03`、全部记录周期三项副标全为空）。
- **验证**：`npm test` 435/434/0 fail/1 skip；`npm run check` 通过（679.6 KB，三处 wxss 花括号配平 102/102、31/31、18/18）；模拟器四档同屏（3h→lv1 深紫且与空格「+」一眼可分、4.9h→lv2、7.2h→lv3、9.0h→lv4 浅紫不再白；图例条四段均可见），截图 `docs/assets/l4-stats-heat-v2.png`、1 年视图 `docs/assets/l4-stats-heat-year.png`（验证最低档时临时注入 3h 记录，两张图均已还原为 23 天真实数据）。
- 待真机：护眼/低亮度下 lv1 与空格是否仍可区分；1 年视图 40rpx 小格的四档区分度。
- 已知未修（非本轮引入）：30 天海报的 30 格按 `i % 7` 从任意星期几开始铺，7 列不对应周一到周日，读者可能当周历误读。

## 2026-10-27 · 口径命名收敛 + 睡眠效率（L4 交付）

背景：`startAt` 是上床，界面上却多处写成「入睡」；大数字是「在床」，却叫「当天总睡眠」。名称不统一时，「睡着 7h00」和「总长 7h15」会被读成两个互相矛盾的数字。

- **完成态**：大数字标签由写死的「当天总睡眠（含午休/间断）」改为 `recordView.durationK`（单段「在床时长」/ 多段「当天在床（含午休/间断）」）；时间轴左标签「上床」。
- **睡眠效率**：新增 `efficiency = 睡着 / 在床`（仅主段、仅当有 `sleepAt`），完成态一行显示「入睡 23:00 · 睡着 7 小时 00 分 · 效率 97%」；无 `sleepAt` 不显示、效率为 0 时不写百分比，**不做任何评价**（只陈述数字）。
- **统计页**：核心指标「平均入睡」→「平均上床」（`avgBedMin` 本来就是 startAt）；展开说明补「按上床到起床算」；「有 N 天在 0 点后入睡」→「0 点后上床」；入口「定今晚入睡点」→「定今晚上床点」；日期详情主行「首段 X 入睡」→「首段 X 上床」；分享图与海报同步（`平均上床` / `凌晨上床`）。
- **刻意不改**：空态「去入睡」、补记面板「入睡/起床」、进行中状态「已记录入睡，还没有结束时间」——这些是**事件描述**（用户语言），不是精确时刻标签。规则：精确时刻说「上床」，事件说「入睡」。
- **未切口径**：`durationMin` 仍是 `endAt - startAt`。理由：`sleepAt` 的默认值是「上床 + 档位（默认 15）」，不改的用户会得到恒等于「在床 − 15 分钟」的“睡着时长”，这不是新信息；且系统无法区分「认可默认 15 分钟」和「根本没看」。等「改入睡时刻的用户占比」有数据后再评估是否把 TST 升为并列指标。
- **验证**：`npm test` 433 项 / 432 通过 / 0 失败 / 1 skip；`npm run check` 通过（主包 677.7 KB，配图无死链无孤儿）；模拟器 390×844 实测：完成态「7 小时 15 分 · 在床时长」+「入睡 23:00 · 睡着 7 小时 00 分 · 效率 97%」、统计页「平均上床 22:45」、日期详情「22:45 上床 → 06:00 起床 · 共 7 小时 15 分」，截图 `docs/assets/l4-sleep-efficiency-done.png` / `-stats.png` / `-detail.png`；**窄屏 375×812 复验**效率行不折行、三列指标不挤压，截图 `docs/assets/l4-sleep-efficiency-mini.png` / `-mini-stats.png`。

## 2026-10-27 · 统计页指标周期：本周为空时回退「最近 7 天」

背景：首屏 3 个指标一直是自然周口径（周一 00:00 起）。周一刚过零点本周必然 0 天 → 首屏「本周还没有完整记录」，而下方日历是「当月」口径仍满屏记录，用户反馈以为历史数据丢了。

- **口径**：`utils/stats.js` 新增 `periodStats(records, now, period)` / `latestPeriodStats`；`metricsOf` 依次取「本周 → 最近 7 天 → 全部记录」，返回 `periodKey/periodLabel/rangeText/isFallback`。`weekly()` **不动**（入睡页「本周 X 天」与 `factsOf` 仍用本周口径，双页不出现第二个口径）。全部记录周期下限取第一条记录所在日，展示区间如 `09.01–10.26`。
- **对比基线随周期换**：本周→上周同期（保持等长天数）；最近 7 天→前 7 天**完整 7 天**；全部记录→无基线，说明卡写「统计范围 X，没有可对比的上一段」，不再编造「上周同期」。
- **文案参数化**：`durationNoteOf(cur, subject)`、`scope`（「本周 3 天」/「最近 7 天共 5 天」）、`subOf/compareLine` 全部按周期换主语；回退后不再出现「本周」。
- **UI**：指标上方新增一行周期标签（周期 + 区间，回退时补「本周还没有记录」）；「按均值定今晚入睡点」整句改由页面生成 `planLabel`（回退时「按最近 7 天均值（23:24）」）；空态去「本周」改为「还没有完整记录」。
- **刷新签名**：`periodKey / rangeText / planLabel` 进签名——本周回退到最近 7 天时数字可能恰好相同，只拼 metrics 会漏刷周期标签。
- **测试**：`tests/stats.test.js` 新增 4 条（周一回退、前 7 天基线、本周有记录不回退、全记录不编造对比）。
- **验证**：`npm test` 432 项 / 431 通过 / 0 失败 / 1 skip；`npm run check` 通过（676.4 KB）；模拟器实测（真实数据，本周 0 天）：周期行「最近 7 天 10.21–10.27 本周还没有记录」、副标「比前 7 天少 5m / 早 35m / 晚 1h03m」、入口「按最近 7 天均值（23:24）定今晚入睡点」，截图 `docs/assets/l4-stats-period-fallback.png`。（并行会话的「入睡耗时」轮在本条之后。）
- 待真机：跨周切换时首屏是否闪一下、周期行是否跳动。

## 2026-10-27 · 入睡耗时接入打卡 + 完成态区分「上床 / 入睡」

背景：计算器一直在说「已含 15 分钟入睡」，记录侧却只有打卡时刻，统计按 `wakeAt - bedAt` 全额算——同一份数据两套口径。本轮先修默认值，再把「上床」与「入睡」拆成两个字段（**统计口径不变**）。

**A. 会话档位下传 + 打卡快照**

- `app.globalData.fallMinutes`（新增）由计算器 `onFallAsleepTap`/`cycleFall` 写入，**刻意不落 prefs**——PRD 定的是「入睡耗时默认 15、仅会话内可调」，跨启动记忆会让隔天打卡莫名沿用上次的 30 分钟。
- `pending.fallMinutes` 随打卡落盘（`storage.setPending` 白名单已放行）。必须落盘：睡前打卡、第二天早上才结束是常态，那时会话级变量早已丢失。
- `defaultExpectedWake(now, fallMinutes)` 读快照/会话档位，`P.nextWakeAt` 用它留白（原先写死 15）。

**B. 结束面板：上床 / 入睡 / 起床 三格**

- `startAt` 语义定为「上床」，新增 `sleepAt` = 「睡着」。面板默认 `入睡 = 上床 + 档位`，**放得下才预填**（`wanted ≤ 起床 - 1 分钟 && wanted ≤ now`），否则留空——刚点就结束不会切出「只睡 4 分钟」的假入睡点。
- 说明行 `endFallNote`「入睡按 N 分钟入睡耗时预估，可改成你真正睡着的时刻」只在预填时出现；补记/编辑面板保持两格（入睡/起床），`closeSheet` 一并清空，避免残留上一个面板的说明。
- 入睡可跨午夜：`computeEndSheet` 对上床日与次日各试一次，取落在 `(上床, 起床)` 内的那个；`_endStartDay` 回到 `startOfDay(pending.bedAt)`（不再跟着入睡走，否则 `rangeBetween` 会算成 20+ 小时假段）。

**C. 数据与展示（方案 C 第一步：只加不改）**

- 本地 `sessions[].sleepAt`（可选）：`normalizeSession` 校验 `startAt < sleepAt < endAt`，**越界只丢字段不丢整段**（老记录没有、手改时间后越界，都不该让一段睡眠消失）。
- 服务端 `validate.normalizeSession` **白名单同步放行**——不放行的话客户端上传的 `sleepAt` 会被静默剥掉，云备份回拉即丢；`sessions` 本来就是 JSONB 整存，无需建表迁移。
- 完成态时间轴左标签「入睡」→「上床」，下方新增一行「入睡 23:06 · 这一段睡着 7 小时 00 分」；分享文案「我 X 入睡」→「我 X 上床」（firstBed 现在是上床时刻）。
- **统计口径不变**：`durationMin` 仍是 `endAt - startAt`。统计页「平均入睡」的改名与展开说明在同日「口径命名收敛」条目完成（→「平均上床」），本条目只负责数据层。

**验证**：`npm test` 433 项 / 432 通过 / 0 失败 / 1 skip（新增 sessions 1 条、sleep-page 7 条、server validate 1 条）；`npm run check` 静态检查通过（主包约 676.5 KB；配图检查被并行会话新增的未引用截图 `l4-stats-period-fallback.png` 挡住，非本轮产物）；模拟器 390×844 实测：面板三格 22:51 → 23:06 → 06:06（时长 7 小时 15 分），保存后完成态「7 小时 15 分」+「入睡 23:06 · 这一段睡着 7 小时 00 分」，截图 `docs/assets/l4-sleep-onset-sheet.png` / `docs/assets/l4-sleep-onset-done.png`。

**遗留（第二步，待评审）**：是否把总睡眠口径切到 `endAt - sleepAt`。切换会让所有历史数字变小，且需同步改服务端 `duration_min` 重算、统计页标签与日历色阶。

## 2026-10-27 · 入睡页动作词统一 + 完成态「每日一句」

- **动作词统一**：空闲圆环提示「轻触圆环，记录入睡」→「点击圆环，记录入睡」，与睡梦中「点击圆环、结束入睡」同用「点击」，不再一态「轻触」一态「点击」。**没有**采纳「开始入睡」——本页只落一个 `bedAt` 时间戳，不监测也不干预睡眠，「开始」会承诺产品没有的能力；「记录」是事实陈述，与「只陈述事实」的既有原则一致。
- **完成态页脚改为「每日一句」**：新增纯函数模块 `miniprogram/utils/sleep-quotes.js`（`QUOTES` 16 条 + `quoteOf(dateKey)`），按 `dateKey`（设备本地日历日，仅 UI 文案）转「自 1970 起的天数」取模，同日恒定、相邻日换句、16 天一轮。语录取公版（先秦至清诗句/典籍/歌谣），逐条带出处，完成态在正文下显示弱化小字出处（22rpx / opacity 0.7）；`quoteOf` 对非法日期返回 `null`，页面回落到原按时段收尾句（早安/今天也辛苦了/夜深了）。
- **只放完成态**：空闲/睡梦中页脚保持「愿这一觉安稳 / 放轻松，慢慢睡。」且不渲染出处行——睡前页的唯一任务是「点一下然后放下手机」，不做需要翻页的内容消费；也没有做左右方向键（「再看一条」与睡前场景相反）。
- **视觉**：新增 `.sleep-quote.is-quote`（字距 7rpx→2rpx、行高 1.9、左右 40rpx 内边距）承接长句，`.sleep-quote-source` 独立小字行；390×844 实测完成态语录与出处均落在视口内（`scrollHeight == windowHeight`，无溢出）。
- **验证**：`npm test` 420 项 / 419 通过 / 0 失败 / 1 skip（新增 `tests/sleep-quotes.test.js` 7 条 + `sleep-page.test.js` 补两态 orbCaption 与语录断言）；`npm run check` 通过（主包约 661.2 KB，含并行音频改动）；模拟器实测空闲态文案已切换、完成态正文「其寝不梦，其觉无忧。」与出处「《庄子·大宗师》」渲染正常，截图 `docs/assets/l4-sleep-quote.png`。

## 2026-10-26 · 复核后收口：热启动界面、单页模式与清除数据余量

- **先核验后动手**：上一轮报告的 3 组 P1（同步 trailing、提醒可信化/取消重建、音频回环熔断）已在 `e04cbb5` 修复，并用 `tests/sync-trailing.test.js`、`server/test/reminders.test.js`、`tests/audio-session.test.js` 逐项复核；本轮不重复改。
- **删除云端副本后的提醒收敛**：`eraseCloudData()` 会一并删除服务端 `sleep_reminders`，但原成功后只清 `lastSyncAt/cloudPendingErase`，本地 `planReminder` 与 pending 的 `reminderOptIn` 仍保持已开启，用户无法重设。新增 `clearLocalCloudReminderState()`，成功后同时清计划提醒、把进行中会话的提醒标记复位，提示改为「云端副本与提醒已删除」。
- **未开启云备份时服务端清除失败**：`eraseThenClear()` 的本机分支原本只在 `lastSyncAt>0` 时提示失败，且 `cloudPendingErase` 已为 false，用户既看不到重试入口，服务端提醒/事件也可能残留。现在失败统一保留 `cloudPendingErase`，始终提示可在统计页重试。
- **订阅消息热启动**：新增 `utils/launch-intent.js`，由 `App.onLaunch/onShow` 捕获 `end/remind` 意图，入睡页每次 `onShow` 消费一次（2 分钟 TTL）。页面不再只依赖 `onLoad(options)`，解决缓存 tab 热启动丢失落地意图。
- **朋友圈单页模式**：首页底栏改用显式 `tabBar.hidden`（custom-tab-bar 独立 root，`wx:if` 不足以保证隐藏）；「换背景」在单页模式/无背景配置时不渲染；`custom-tab-bar` 的 `switchTab` 补失败 toast，点当前 tab 回顶。
- **启动事件**：`app_open` 从「配置加载成功回调内」移到启动即上报，弱网/新用户首启不再因配置失败漏掉获客分母。
- **触控热区**：dense 结果面两个次级 pill 与首页脚注整行补到 88rpx 命中区，不改变视觉高度。
- **音频解锁可观测**：新增 `audio_unlock_fail` 事件（target=`skipped|busy|error|unavailable|<trackId>`），服务端白名单放行；`analytics.overview` 增加今日/本周 `unlockFails`、`unlockFailReasons` 与 `unlockLoadFailureRate`（`error+unavailable / 成功+两者`，排除用户跳过/广告忙碌）；后台概览新增「音频解锁观测」面板。广告失败仍按 `onAdError` 配置决定是否放行，但放行不再等于不可观测。
- **环境音刷新**：`audio-dock` 回入睡页改为 `loadConfig(true)`（内部 3 秒 force 去重），后台新增/改名音轨后不必等 10 分钟缓存。**本地若看不到后台新增曲目，先检查开发者工具 Storage 是否有 `sleep:dev-api` 覆盖到线上**；有覆盖时本地 3100 后台的数据不会下发，且线上请求失败会落到旧配置缓存。
- **验证**：`npm test` **405 项 / 404 通过 / 0 失败 / 1 skip**；`npm run check` 通过（主包约 **642.1 KB**）。模拟器 390×844 实测热启动 `remind=sleep` 落在入睡页并显示提示（截图 `docs/assets/l4-hotstart-remind.png`）；单页模式 `singlePage=true` 时底栏隐藏、顶栏「换背景」隐藏；本地 3100 `/api/config` 已下发 6 条环境音，drawer 运行态为 6 条（旧缓存仍可能显示历史标题，清 `sleep:config:v1` 后重拉）。真机订阅点击/冷热启动仍待复测。

## 2026-10-26 · 文档配图清理 + 配图检查工具（防止孤儿图与死链）

- **清理 13 张未被引用的截图**（657KB）：`docs/assets` 共 82 张 → 69 张，全部被文档（changelog / 验收清单）以路径形式引用；被删的是改前/改后中间态与无引用遗留（如 `l4-audio-visual-v3.png` 圆框版、`l4-lights-out-done.png`、`design-preview.png`）。**保留的 69 张是 L4 交付证据**（真机复测、回归对照、评审追溯都靠它们），不是冗余资源；`docs/assets` 不在小程序包内，不影响主包体积。
- **新增 `tools/check-docs-assets.mjs` 并挂进 `npm run check`**：①文档里写出的 `docs/assets/...` 路径必须真实存在（防"删图留死链"——上一轮误删 `calendar-strip` 组件导致 1 年视图整块空白，同类问题要有工具兜住）；②`docs/assets` 下不得存在未被任何文档提及的图（防中间态截图越积越多）。
  - 引用口径按本项目实际写法：markdown 嵌入写法、反引号包住的带 `docs/assets/` 前缀的路径、裸文件名都算；通配/枚举写法（`l4-*.png`、`tab-home(-active).png`）属设计文档的规格描述，不判死链。
- **验证**：`npm run check` 通过（静态检查 + 文档配图检查：42 个文档、69 张被引用图片、无死链、无孤儿图）；`npm test` 394 通过 / 0 失败 / 1 skip。

## 2026-10-26 · 部署前 code-review（1b1371d..ade0da5）：修 1 个 P0 + 5 项一致性问题

- **P0：提醒模板字段快照在路由层断链**。`routes/reminders.js` 的 `currentReminder()` 只返回 `{enabled, templateId, page}`，而落库时传的是 `reminderConfig.thingKey/timeKey` → 恒为 `undefined` → 落库空串 → 发送端永远回退到**当前**配置的字段名。也就是说"运营换模板后旧任务仍按创建时字段发送"的保护**完全没生效**，旧任务仍会被微信以 47003 拒绝。此前单测直接调 `db.saveReminder`（绕过路由），所以测试全绿也没暴露。
  - 修复：抽出 `server/src/lib/reminder-config.js`（`reminderConfigOf` 纯函数），**路由层与服务层共用同一份归一化**，从结构上消除"两处各拼一次、漏一处"的问题；新增 `server/test/reminder-config.test.js` 3 条（缺省补 `thing1/time2`、后台自定义字段原样带出、空配置与 env 兜底）。
- **分享漏斗补齐**：此前只有计算器页 `onShareAppMessage` 上报 `share`，统计页与入睡页的分享**完全没有计入分母**，看板会系统性低估分享量 → 两页补 `events.track('share', 'stats'|'sleep')`（只记来源页，不带任何睡眠数据）。
- **AGENTS.md 五处同改**：`miniprogram/config/fallback.js` 的 reminder 块补 `thingKey/timeKey`（此前缺这两键，与 `server/config/app.config.json` 不同构）。
- **AGENTS.md §5.1**：`audio-dock` 缓存读失败的回退分支里那句冗余 `patchMeta({lastTrackActive:true})` 删除——播放错误路径只应改 `lastTrackPlaying`，会话复活由 `audio-session.onPlay()` 统一负责。
- **重试字段两端统一**：`scheduleReminderRetry` 不再把"最后失败时刻"写进 `cancelled_at`（PG）/ `lastErrorAt`（memory），只写 `attempts/retry_at`——pending 行不该带取消时间，两端语义也要一致。
- **注释漂移修正**：`audio-dock` 与 `audio-cache` 三处仍写"移动网络延迟 15s / Wi-Fi 立即"，与实际的 `autoCacheDelay`（Wi-Fi 8s / 移动 20s）矛盾，已改正。
- **审查判定为"不修"的两项**：①统计页首次进页确实会算两次——第一次用兜底配置、配置回来后必须用线上配置重算，属刻意设计（且日历部分已被缓存兜住）；②`admin.js` 与 `config-schema.js` 的字段名校验重复且长度限制已漂移（20 字符 vs 不限），重构风险大于收益，改为记录待办。
- **验证**：`npm test` **395 项 / 394 通过 / 0 失败 / 1 skip**；`npm run check` 通过（主包 **636.8 KB**）。

## 2026-10-26 · wxss 重复核实（不合并）· 真机复测单

- **`audio-dock.wxss`「两套定义」核实为不需要合并**：脚本统计全文件 173 个选择器，重复定义仅 **29 个（约 64 行）**，其中 27 处是"不同值、后者覆盖"的演进式写法（如 `.dock-fav` 在 654/1160 两处）。合并收益约 60 行，风险却是逐屏视觉回归——**收益/风险不成立，保持现状**；此前“双套定义可减 500 行”的估计来自目测，作废。
- **新增 `docs/14-真机复测单.md`**：把散在 `docs/13` 各小节的真机项按场景收敛为一份可勾选清单——A 音频 9 项（假播放/弱网首播/锁屏回环/来电恢复/悬浮 X/继续上次/连播/删缓存）、B 熄灯 4 项、C 提醒 3 项、D 统计 3 项、E 分享 2 项、F 部署 1 项；末尾附记录区（不通过项写现象即可回传）。
- **验证**：`npm test` 392 项 / 391 通过 / 0 失败 / 1 skip；`npm run check` 通过（636.4 KB）。

## 2026-10-26 · 1 年视图渲染懒加载（420 节点 → 首屏 210）

- **背景**：上一轮已把 1 年视图的**计算**缓存到 1ms，但 12 个月 × ~35 格 ≈ **420 个节点**仍是一次性 `setData`，真机切到「1 年」会有一次可感知的顿挫。
- **实现**：`calendar-strip` 组件内维护渲染窗口——初始只渲染**最近 6 个月**（约 210 节点）；横向滑到最左（`bindscrolltoupper`，阈值 80px）再渲染全部，并把视口钉回「追加前最旧的可见月份」（`scroll-into-view`），**不跳位**。同月份的数据更新（打卡/补记）只刷新可见格子、不重置滚动位置；切周期/月份范围变化才重置窗口并滚回最新月份。
- **实测**（模拟器）：`months=12 / visibleBefore=6 / onLoadEarlier→visibleAfter=12 / scrollTarget=cs-2026-05`；截图 `docs/assets/l4-stats-year-lazy.png`（5/6/7 月网格与色阶正常）。
- **验证**：`npm test` 392 项 / 391 通过 / 0 失败 / 1 skip；`npm run check` 通过（主包 **636.4 KB**）。

## 2026-10-26 · 提醒瞬时失败限次重试（加法迁移 attempts/retry_at）

- **缺口**：`services/reminders.js` 原来把非 43101 的发送失败一律标 `failed`——微信接口抖动、access_token 竞态、网络超时等瞬时故障会让**已到点的提醒永久丢失**，用户只看到“没响”。
- **修复**：`sleep_reminders` 加法迁移 `attempts INTEGER DEFAULT 0`、`retry_at BIGINT DEFAULT 0`（SCHEMA 与 `001_init.sql` 同源）；发送失败时 `attempts+1` 并按 `attempts×60s`（1/2 分钟）退避，**最多 3 次后标 failed**；43101（用户未订阅）仍直接 `cancelled`；用户重建任务（cancelled/failed/expired → pending）时预算重置；发送成功清零。`dueReminders`（memory + PG）都尊重 `retry_at`，退避期内不会重复发送。
- **测试**：`reminders.test.js` 新增「连续三次失败 → failed；退避期内不重复发送；attempts 递增可见」（14/14）。
- **注意**：线上 PG 需要跑一次 `001_init.sql`（或重启服务端让 `init()` 自动 `ALTER ADD COLUMN`）后新列才存在。
- **验证**：`npm test` **392 项 / 391 通过 / 0 失败 / 1 skip**；`npm run check` 通过（主包 **635.0 KB**）。

## 2026-10-26 · 音源链路诊断 · 标题收缩 · 分享归因校验

- **「后台多条、模拟器只显示 1 条」定位并恢复**：此前调试时给模拟器写入过一次性覆盖 `sleep:dev-api = https://sleep.qfmaster.com`，但开发者工具走系统代理对该域请求失败（`status 0`）→ 降级到 fallback（仅 1 条）。清除该覆盖、重启后回退本地 `127.0.0.1:3100`，抽屉恢复 **6 条**。**注意**：`sleep:dev-api` 是仅 develop 读取的调试开关，指向线上时会被系统代理拦截，本地联调不要设置它。
- **三端一致性验证**（本地 server + 后台账号）：`GET /api/admin/login`（Cookie 会话）→ `GET /api/admin/config` 返回 **6 条**，与 `GET /api/config`（version 13→14）和小程序抽屉完全一致。
- **顺手修正一条数据**：本地第 1 条音源标题被误填成了后台密码（`getsleep-local-admin-2026`），已通过后台 API 改回「雨声」并补齐副标；`/api/config` 已返回新值。
- **结果面标题收缩（视觉 A 项）**：翻面后 Hero 标题 `72rpx → 40rpx`、副标折叠（max-height 0 + opacity 0），给结果卡让出约 90px；截图 `docs/assets/l4s-result-hero.png`（23:45 主卡 + 3 行完整可见）。回正面有 0.2–0.28s 过渡。
- **分享归因链路校验（D 项）**：`utils/launch-source.js` 把冷启动 `query.from` 归一化进 `app_open` 的 target（`scene|pages/index/index|share`）；配合分享方的 `events.track('share')`，看板 `topSources` 可见 share 来源；`tests/launch-source.test.js` 已覆盖。链路完整，无需新代码。
- **验证**：`npm test` 391 项 / 390 通过 / 0 失败 / 1 skip；`npm run check` 通过（**635.0 KB**）。

## 2026-10-26 · 逐页视觉巡检（首页/入睡页/统计页/结果面）

- 巡检范围：首页默认态、入睡页 A 态、统计页当月、结果面正常态（截图 `docs/assets/l4s-*.png`）；共发现 2 处值得修的问题，其余（时间轮、圆球、日历色阶、结果面 3 行布局）未溢出、层级正常。
- **首页脚注两段粘连**：`按 90 分钟周期计算，仅作时间参考` 与 `为什么是 90 分钟？` 间距只有 8rpx，真机上几乎贴在一起 → `.calc-note-more` 改 `display:inline-block` + `margin-left:16rpx`。
- **统计页空态与日历易误读**：`本周还没有完整记录 / 打一次卡…` 与下方「本月已记录 18 天」同屏，文案改为「本周打一次卡，这里就会出现 3 个核心数字（下方是本月日历）」。
- **记录一个瞬态**：重编译后立即调 `onCalc` 会出现一次空白页（页面栈为空，console 无错误），`reLaunch` 后恢复；属开发者工具重编译时序，不是代码缺陷。
- **验证**：`npm test` 391 项 / 390 通过 / 0 失败 / 1 skip；`check` 通过（634.5 KB）；截图 `l4s-home-fixed.png`、`l4s-stats.png`、`l4s-result.png`。

## 2026-10-26 · 1 年视图缓存 + 更正上一轮的组件误删

- **P0 更正（自引入缺陷）**：上一轮把 `components/calendar-strip` 当“零引用”删掉，实际 `stats.wxml` 仍在用（3/6/12 月视图），结果 1 年视图**整块空白**。根因是当时用 `Select-String -Path miniprogram` 扫目录**没有递归**，只匹配到根目录（无 js 文件）→ 恒为 0 命中。已从 `dd4cceb` 恢复组件并在 `stats.json` 重新注册；复验 12 个月 × 35 格正常渲染（截图 `docs/assets/l4-stats-year-view.png`）。
- **同类复查**：`utils/stats.js` 的 `levelOf/heatLevelOf/factsOf/factSignature/localFact/heatmapCells/monthsSpan/summaryPayload` 经**递归**搜索确认仍被 `stats.test.js`、`stats-calendar.test.js` 与统计页使用，**不是死码，全部保留**（上一轮结论作废）；`fetchSummary`、`regularity` 复查确认确实零引用（保持删除）。
- **1 年视图性能**：`stats.refresh` 增加日历缓存——`recordsStamp(records)`（天数 + 各段起止/更新时间和）+ 视图参数（span/monthOffset/todayKey/partialDay）组成 key，命中则复用 `calendarMonths`，数据一变自动失效。模拟器实测：同一数据下第二次 `refresh` **1ms**（此前每次都要重算 12 个月 × ~35 格）。
- **测试**：`stats-page` 新增「同数据命中缓存 / 数据变化必须重算」（monkey-patch `calendarMonths` 计数）。
- **验证**：`npm test` **391 项 / 390 通过 / 0 失败 / 1 skip**；`npm run check` 通过（22 JSON / 17 WXML / 19 WXSS，主包 **634.3 KB**，含恢复的组件）；截图 `l4-stats-year-view.png`（9/10 月网格、色阶与 23 天记录）。

## 2026-10-26 · 统计页 → 计算器：按本周均值定今晚入睡点

- **把“回顾”变成“今晚的行动”**：统计页在指标下方新增「按本周均值（07:22）定今晚入睡点 →」。点击把本周平均入睡分钟数写入一次性 `meta.prefillSleepMin` 并 `switchTab` 计算器；首页 `onShow` 消费后立刻清空（不重复触发），切到「想几点睡」模式、预填时间并**直接展示结果面**——少一步点击。
- **数据来源**：`utils/stats.metricsOf` 新增 `avgBedMin/avgWakeMin` 输出（空数据返回 null）；本周时间分散、算不出圆均值时入口不渲染，点击兜底 toast「本周还没有可用的平均入睡时间」。
- **测试**：`stats-page` 新增「写入 1395 并跳转 / 无法计算时不跳转」；`index-page` 新增「预填消费后 `mode=sleep`、`sleepTime` 正确、`flipped=true`、`prefillSleepMin` 清空」。
- **顺带修掉一个测试挂起**：首页用例调用 `onShow()` 会启动 60s 时钟 `setInterval`，导致 `node --test` 不退出（本轮两次“卡住”的原因）。测试末尾补 `page.onHide()` + `events.clearQueue()`；验证 `npm test` 13.9s 正常结束。
- **验证**：`npm test` **390 项 / 389 通过 / 0 失败 / 1 skip**；`npm run check` 通过（主包 **627.2 KB**）；模拟器截图 `docs/assets/l4-stats-plan-entry.png`（入口与指标同屏，平均入睡 07:22）；点击链路实测 `mode=sleep / flipped=true / prefillSleepMin=null`（已消费）。**未机验**：真机点击后的翻面动画与时间轮定位。

## 2026-10-26 · 体验版 P1：迷你条“显示正在播放却没有声音” · 列表图标去框

- **根因（真机复现）**：`BackgroundAudioManager` 在**没有 src 时 `paused` 是 `undefined`**，调用方写 `!audio.paused` 得到 `true`；再叠加 `player-surface` 旧逻辑用 `lastTrackPlaying` 兜底，于是体验版一打开就显示「正在播放」，实际没有任何音频在播。
  - 修复：`resolvePlayerSurface` 改为严格布尔（`playingNow === true` 且 `hasSrc === true` 才算播放中），`cold` 判定放宽为「没在出声且本进程无会话」；
  - `audio-dock` / `now-playing` 传参改为 `!!audio.src && audio.paused === false`，双保险；
  - 模拟器复现验证：`src:false / paused:undefined` → 修复后 `playing:false`、副标「已暂停」、`currentId` 保留（入口在，点按可续播）。
- **视觉（按反馈）**：已缓存的 `⤓ + 圆框` 改为**纯粗箭头 ↓**（无边框、无圆角、34rpx/700）；列表最右侧播放/暂停按钮**去掉圆形描边框**，三角形与双竖线各放大一档，与迷你条右侧图标统一为“无框、够粗、够简约”。
- **验证**：`npm test` **388 项 / 387 通过 / 0 失败 / 1 skip**（新增「无音源时 playingNow 传 true 也必须暂停」与「本次进程用户暂停不判冷启动」两条）；`npm run check` 通过（主包 **624.3 KB**）；模拟器截图 `docs/assets/l4-audio-visual-v4.png`（无框 ↓ 与 ▷、顶部「已暂停」）。
- **未真机**：体验版冷启动/锁屏/打断恢复、悬浮 X 停止后续播仍需真机复测（本轮只证明“状态判定不再误报”）。

## 2026-10-26 · 环境音运营可读化 · 单曲缓存可发现删除 · 趋势分享柱

- **后台环境音管理（用户反馈“莫名其妙”）**：图标下拉从单字「雨 / 浪 / 火 / 噪 / 夜」改为 **🌧 雨声 / 🌊 海浪 / 🔥 炉火 / 🎚 白噪音 / 🌙 深夜**（对应小程序内置 `icon-*.png`）；分类输入框下方新增**常用分类标签**（自然之声 / 环境音 / 白噪音 / 轻音乐 / 助眠音乐 / 冥想），点一下即填入，datalist 也合并了常用项——不用记名字，也不会因输入法差异产生“环境音 ”这类脏分类。
- **小程序单曲缓存可发现**：已缓存且非当前播放的曲目，右侧新增**绿色 ⤓**（点击 → 二次确认「删除这首的缓存？X MB」），长按走同一套确认；缓存区提示改为「点曲目右侧 ⤓ 或长按，可只删除该曲缓存」。此前只有一行小字提示长按，实际几乎发现不了。
- **看板趋势加分享柱**：`renderTrend` 新增金色分享柱与 tooltip「分享 N」，配合「今日分享 / 本周」卡片形成“分享 → 打开 → 打卡”的可见链路。
- **不再重复讲同一首**：已有当前曲目时隐藏「继续上次」入口（此前冷启动后播放条与“继续上次”会同时出现同一首）。
- **封面图结论：不做**。列表已有 5 个内置图标 + 分类色 + 缓存/收藏标记；封面需要运营逐条上传、增加 CDN 与列表加载，而环境音是“睡前低频浏览”，收益低于成本。若将来要做，建议 96px WebP、单张 ≤15KB，并与 icon 二选一（避免两套视觉）。
- **验证**：`npm test` **385 通过 / 0 失败 / 1 skip**；`npm run check` 通过（主包 **622.1 KB**）；后台 admin.js/css 括号配平；模拟器截图 `docs/assets/l4-audio-list-v2.png`（已缓存项 ⤓、继续上次、分类 chips、单曲循环胶囊）。
- **未机验**：后台分类标签与图标下拉的浏览器点验（需起服务 + 后台账号）；真机点 ⤓ 删除缓存的确认弹窗。

## 2026-10-26 · 真机反馈：切歌播几秒变「已暂停」· 看板分享卡

- **线上配置核实（先排除坏源）**：`GET /api/config` 返回 **8 条**音源（`sleep-10001` 等），逐条 Range 探测均为 `206 / audio/mpeg`、`1.5–11.5 MB`、文件头 `fffbd4`/`ID3` 正常——不是 403/坏文件。
- **成因一（已修）**：自动缓存在 Wi-Fi 下**立即**下载整首（后台素材最大 11.5 MB），与流式播放抢带宽，真机表现为“播几秒被缓冲打断”。`autoCacheDelay`：Wi-Fi `0 → 8000ms`，移动网络 `15000 → 20000ms`，让起播先跑稳。
- **成因二（已修）**：BAM 缓冲触发的 `pause` 在 8s 窗口外被当成用户暂停，直接显示「已暂停，点击继续」。现在缓冲窗口放宽到 30s，命中「缓冲中 + 非用户暂停 + 未停止」时保持连接态并 3s 后 `safePlay()` 重连（最多 2 次），起播后清零；用户主动暂停（`audioSession.isUserPaused()`）与锁屏/通知栏暂停不受影响。
- **开发便利**：`config/env.js` 支持 **仅 develop** 的 `sleep:dev-api` 覆盖，便于模拟器直接用线上配置联调（体验版/正式版永不读取，不会把调试地址带到线上）。
- **看板**：新增「今日分享 / 本周」卡片，配合批次 D 的 `today.shares / week.shares`，分享漏斗的第一段可见。
- **验证**：`npm test` **385 通过 / 0 失败 / 1 skip**；`npm run check` 通过（主包 **620.6 KB**）；线上 8 条音源 URL 探测通过。**模拟器无法直连线上**（DevTools 走系统代理，`/api/config` 返回 `status 0`），因此“切歌播几秒暂停”的真机带宽场景**未能在模拟器复现**；本轮为代码级修复，需真机复测确认。
- **若真机仍复现**：需要 vConsole/真机日志里的 `errCode`（`audio_error` 事件 target 形如 `trackId|10003`）区分是 `onError`（解码/网络）还是 `pause`（缓冲），再按码定位。

## 2026-10-26 · 批次 D：增长闭环 · 后台稳健 · 提醒快照 · 死码清理

- **分享深链（增长）**：`onShareAppMessage` 的 path 从只带 `from=share` 改为携带 `mode/fall/wake|sleep`；首页 `onLoad(options)` 新增 `applyShareQuery`——只读预填、直接算出并展示结果面，**不写本地偏好、不弹权限**。被分享者打开看到的就是分享者的推荐，不再是默认 07:30。
- **share 事件**：首页分享时 `events.track('share', mode)`；服务端 `TYPES` 放行 `share`；看板 `analytics` 新增 `today.shares / week.shares / trend[].shares`，作为“分享 → 打开 → 首次打卡”漏斗的分母。测试覆盖：分享 path 参数、预填不写偏好、看板 shares=1。
- **演示页回流 CTA**：新增 `server/public/site/site-qr.js`（通用 `[data-site-qr]`）与 demo 页尾部区块——有码显示小程序码，无码回退「微信搜索「睡点」」，把“试完就结束”接回小程序。
- **后台稳健性**：配置保存失败时按钮持续显示「保存失败 · 重试」（toast 2.8s 消失后仍可见，`.primary.save-failed` 红色态）；409 冲突自动 `loadAll()` 载入最新版本并提示；「清除小程序码」补二次确认（与删除音频/用户同口径）。
- **统计页性能**：进页不再无条件 `refresh()` 两次——`loadConfig` 回调只在 `version + features.sync` 签名变化时重算（1 年视图一次约 420 格，此前进页算两遍）。
- **提醒模板字段快照**：`sleep_reminders` 加法迁移 `thing_key/time_key`（memory 与 PG 双实现、`001_init.sql` 同步）；创建提醒时写入后台配置的字段名，发送时**优先用任务快照**、缺省回退当前配置——运营换模板后，已排队任务不会因“旧模板 + 新字段”被微信 47003 拒绝。
- **死码清理**：删除 `utils/regularity.js` + 其测试、零引用组件 `components/calendar-strip/`（含 `stats.json` 注册）、零调用 `api.fetchSummary`、统计页未消费的 `streak` 字段。主包 **623.8 KB → 618.6 KB**。
- **国际站**：`site.json` 新增 `legalStatus`，`build-web.mjs` 在未发布时过滤 `/privacy|/terms|/about` 死链（宁可不显示，也不要上线 404）；重建 11 页并 `verify:web` 通过（internal-links=3，无 404）。
- **验证**：`npm test` **386 项 / 385 通过 / 0 失败 / 1 skip**；`npm run check` 通过（3 页面 / 21 JSON / 16 WXML / 18 WXSS，**618.6 KB**）；`npm run verify:web` OK。
- **未做（需你/运营输入或真机）**：D1 真机验收；音源补齐（仓库仍只有 1 条真实 URL，不能编造）；后台看板展示 shares（数据已聚合，UI 追加下批）；国际站真实域名（需你提供）；`utils/stats.js` 六个零引用纯函数与 `audio-dock.wxss` 双套定义保留待评估（删除风险高于收益）。

## 2026-10-26 · L4 模拟器实测：播放状态不一致（P0）· 超期文案 · 日历降噪

- **P0 工具链事实（会阻断整页）**：新增 `utils/player-queue.js`、`utils/player-surface.js` 后只跑 `simulator_refresh` 不会把它们编进包，`audio-dock` 直接报 `module ... is not defined` + `Component is not found`，入睡页整块播放器不渲染。**新增文件后必须 `close_project_window` + `open_project_window` 触发完整编译**；已写入 `docs/13` §1.20 作为后续纪律。
- **P0 播放状态不一致（用户报障根因之一）**：实测修复前 `paused:false`（音频真的在播）但组件 `playing:false`、`playerSub="已暂停"`——`waiting`（缓冲）之后基础库不补发 `play`，旧实现还把 `playing` 置 false。修复：`waiting` 只进「连接中」不改 `playing`；`canplay` / 12s 守卫 / 4s 补播都按播放器真实 `paused` 自愈；`now-playing.handleCanPlay` 同步加自愈。复验 `playing:true`、绿色音符在场。
- **超期态（>24h）**：删除与常驻卡片重复的 8s 一次性 notice；标题由「这一觉开始了」改为「这一觉还没结束」、副标「已超过 24 小时，请结束并校准或丢弃。」（短一行，避免压在圆球光晕上）；熄灯「结束入睡」在 <5 分钟时二次确认，避免误触产生 1 分钟记录。
- **统计页日历降噪**：空格里的「补记」改为轻量「+」（整月 20+ 处重复文案会让日历像一堆按钮），真实入口仍在详情卡与空态。
- **结果面 compact 口径**：主卡是「还能睡」的时长，副标补「已扣 N 分钟入睡」，消除「1 小时 55 分」被读成到起床时长的歧义；「已过」行 opacity 0.55→0.88 并单独提亮标签；「‹ 返回」加宽到 152rpx 平衡底部双按钮。
- **验证**：`npm test` **385 项 / 384 通过 / 0 失败 / 1 skip**；`npm run check` 通过（主包约 **623.8 KB**）；模拟器 iPhone 12/13 Pro 390×844 实测截图 `docs/assets/l4-{calc-home,calc-result-final,stats-calendar,sleep-main,sleep-stale-final,lights-out,lights-out-done,audio-sheet,audio-mini}.png`，console `grep -i error` 为空。**未真机**：弱网首播、悬浮 X 后续播、收藏连播切歌、继续上次、熄灯短时长确认、锁屏回环。

## 2026-10-26 · 批次 C：首播缓冲 · 单曲缓存 · 播放模式 · 继续上次 · 超期段丢弃

- **首次播放被误判为暂停（用户报障）**：BAM 缓冲时会自动 `pause`，原 `pause` 处理把它当用户暂停（冻结定时、收成“已暂停”），弱网首播表现为“刚点播放就暂停”。新增 `waiting` 监听：进入“正在连接”态、重置 12s 守卫、4s 未起播补一次 `safePlay()`；缓冲窗口（8s）内的 `pause` 不冻结定时、不收起播放条。
- **单曲缓存删除**：`audio-cache` 新增 `sizeOf(url)`；抽屉列表项支持长按 → ActionSheet「删除这首的缓存（X MB）」，只删这一首、不影响其它已缓存音源；正在播放的曲目拒绝删除（先切歌）；缓存区文案补「长按已缓存曲目，可只删除该曲」。
- **播放模式**：默认**单曲循环**（最简、不打扰睡前）；抽屉新增「🔂 单曲循环 / 🔁 收藏连播」胶囊，收藏 ≥2 首才可切换。新增 `utils/player-queue.js` 纯函数 + 6 条单测。**刻意不做全列表自动顺序播放**（半夜自动换音色容易吵醒）；解锁是全局 24 小时，与播放多首不冲突。
- **继续上次**：抽屉顶部新增「继续上次 · <曲名> ▶」，冷启动/重进小程序一键接着听（不自动播放，避免半夜突然出声）；点击走与列表一致的解锁校验。
- **超 24h 未结束**：入睡页新增常驻提示卡「这次入睡已超过 24 小时」+ 两个明确出口「结束并校准」「丢弃这段」（丢弃需二次确认，不写记录、不上传云端、同时取消该会话提醒）；原 8s 一次性 notice 保留。
- **验证**：`npm test` **385 项 / 384 通过 / 0 失败 / 1 skip**；`npm run check` 通过（3 页面 / 22 JSON / 17 WXML / 19 WXSS，主包约 **621.1 KB**）。**未机验**：弱网首播不再被误判为暂停、长按删除单曲缓存、收藏连播切歌时的悬浮音符表现、继续上次、超期丢弃——列入 `docs/13` 第 2 区真机验收。
- **未做（下一批）**：提醒模板字段快照（需双 schema + 加法迁移）、统计页 1 年视图性能、`regularity.js`/`--heat-*` 死码清理。

## 2026-10-26 · 环境音专项：播放条常驻口径 · 熄灯一键结束 · 提醒清理补偿

- **播放条常驻（核心体验，按产品口径重写判定）**：新增 `utils/player-surface.js`（纯函数 + 7 条单测），`audio-dock` 与 `now-playing` 共用一套判定。规则：①只有用户在小程序内点“停止”（`markStopped` → `lastTrackActive=false`）才收起入口；②只要有 `lastTrackId` 且未被显式停止，入口就一直在——**冷启动、退出微信、微信悬浮 X 停止后都保留播放条**，只是显示“已暂停”，点按可续播；③冷启动残影只把 `lastTrackPlaying` 归零，**不再清会话**（旧实现会 `markStopped()`，导致重进小程序条子消失）。
- **切歌竞态**：`audio-dock.onError` 记录 `_srcSetAt`，切歌 1.5s 内到达的错误只收 loading、不删缓存不拉黑（`onError` 不带 src，无法精确归属，避免误删新曲缓存）；缓存→远程回退后补 `armLoadingGuard()` + `safePlay()`，与 play/replay 同口径。
- **熄灯一键结束**：熄灯层新增「结束入睡」按钮（`onLightsOutEnd`），一次点击按当前时间落库（超 24h / 重叠 / 容量满时唤醒并打开结束面板手动校准，不静默失败）；入睡中提示词「轻触圆环，记录起床」→「点击圆环、结束入睡」，无障碍 label 同步。
- **提醒清理补偿**：清除数据时在 `clearAll` 前收集 `pending.id` 与 `planReminder.id`，清空后逐个取消；失败的写入 `meta.pendingReminderCancel`，统计页 `onShow` 自动重试（`retryPendingReminderCancel`），兜住“云端 erase 失败 + 从未同步”时仍会收到推送的边角。
- **登录健壮性**：`wx.login` 同步抛错（API 缺失/基础库异常）时走 `done()` 清理 10s 超时定时器，避免测试/异常环境空等。
- **验证**：`npm test` **377 项 / 376 通过 / 0 失败 / 1 skip**；`npm run check` 通过（3 页面 / 22 JSON / 17 WXML / 19 WXSS，主包约 **609.3 KB**）。**未机验**：冷启动保留条、悬浮 X 停止后继续播放、来电/切 App 恢复、锁屏多轮回环、熄灯新按钮手感——全部列入 `docs/13` 第 2 区真机验收。

## 2026-10-26 · 双报告合并审查后的正确性收口（同步 trailing · 提醒可信 · 音频回环熔断）

- **同步 trailing（P1，数据一致性）**：`utils/sync.js` 原来在 `inflight` 时直接返回旧 Promise，本轮快照之后的新增/编辑/删除不会被上传，旧轮却照写 `lastSyncAt` 并回“已同步”。现在在途期间收到新请求会置 `resyncRequested`，当前轮结束后强制再跑一轮（最多 4 轮），`lastSyncAt` 只在“没有 trailing”时落；`whenIdle()` 因 inflight 已包含 trailing 轮，删除云端副本不再漏等在途请求。新增 `tests/sync-trailing.test.js` 3 条（含 deferred Promise 并发验证）。
- **提醒状态可信化（P1，会“显示已开启但收不到”）**：①入睡页 `onReminderTap` 改为**服务端排上后才写本地 `reminderOptIn`**，先挡已过期时间、处理 `skipped`（走日历兜底）、本地写失败时补偿取消；②结果面「已设提醒」点击改为**取消**（原只弹 toast，没有任何撤销出口），设置成功的 toast 提示可再点取消；③结束打卡时若结果面的 `plan-w-*` 正是这一觉的提醒则一并撤销，避免已完成还收到“该起床了”；④`reminder.schedule` 补未来 1 分钟校验。
- **提醒服务端（P1，A→B→A 静默失效）**：`saveReminder` 原遇到 `cancelled/failed/expired` 直接返回（memory）/`WHERE status='pending'` 不更新（PG），用户“设 A → 改 B → 再改回 A”后服务端没有任何待发送任务。现在 sent 保持幂等、其余状态允许恢复为 pending（PG 用 CTE + `status <> 'sent'`）；`/api/reminders` 校验真实写入后才返回 `ok`，否则 503 `REMINDER_NOT_SAVED`。
- **音频回环熔断（P1，整夜约 1Hz 重建音源）**：`audio-dock.replay()` 调 `markUserPlay()`，把刚累计的回环次数清零，导致 10s/8 次上限永远打不满。拆出 `audio-session.markAutoReplay()`（不清预算），回环路径改用它；`player-state.setLoopGuard()` 由 audio-session 注入 `allowReplay`，`seamlessLoop`（前台 timeupdate + 后台 armLoop）也纳入同一预算，duration 略大于 1.2s 的坏源不能靠 `seek(0)` 绕过 `ended` 熔断。
- **P2 收口**：①`utils/login.js` 的 `wx.login` 加 10s 超时（原来既不回调也不失败时会挂住整条身份队列：同步/提醒/事件全部等待）；②`lastTrackActive` 写入收敛回 `audio-session`（`audio-dock`/`now-playing` 的残影清理改调 `markStopped()`，统计页清除数据不再重复 patch）；③解锁到期巡检不再依赖页面可见（锁屏整夜播放会在到期后被收口）；④`/api/events` 改为按条跳过脏数据并返回 `dropped`，一条坏事件不再 400 带走同批 20 条。
- **交互/视觉修正**：圆环中心 `orb-kicker/orb-meta` 提亮并加轻阴影；统计页「点上方数字看说明」去 opacity 提亮（隐藏交互入口）；月历禁用箭头 0.24→0.45、未来日号 0.55→0.7；已过时刻行 0.55→0.72；提醒键 / 底部次按钮 / 周期标签 / 切月箭头 / 列表播放键 / 定时档位热区统一补到 88rpx；补记与结束面板的“假禁用”点击改为 toast 说明；`empty-state` 修正拼错的 `--c-primary-soft`；迷你条层级改 `--z-player`（原 fallback 9999 会压过弹层）；首页 onShow 对齐外部变更的偏好（清除数据后不再显示旧起床时间）。
- **验证**：`npm test` **367 项 / 366 通过 / 0 失败 / 1 skip**（PG 用例无 `PG_TEST_URL`）；`npm run check` 通过（3 页面 / 22 JSON / 17 WXML / 19 WXSS，主包约 **603.0 KB**）；音频四件套 47/47。**未机验**：本轮视觉改动（对比度/热区）未过模拟器截图；提醒的 cold/hot start 落地意图、锁屏到期收口仍需真机。详见 `docs/13-acceptance-checklist.md`。

## 2026-10-25 · 音频体验四项收口（停止防误触 · 回环尾部收紧 · 中断可观测 · 坏源黑名单下沉）

- **停止防误触（P1，真实误触成本）**：`now-playing` 迷你条停止方块与 `audio-dock` 抽屉「结束播放」改为 **3 秒内二次点按**。首点只“上膛”：方块转暖红（`.np-stop.is-armed`）、抽屉文案变「再点一次结束」并 toast 提示；再点才 `markStopped()`。3 秒自动复位；切歌、暂停、关抽屉、组件销毁都会清掉上膛态。睡前误触一次不再导致整夜没声音。
- **回环尾部 2s → 1.2s（P1，听感）**：`player-state` 新增 `DEFAULT_TAIL_SECONDS = 1.2`（原两处硬编码 2），每轮少截掉约 0.8s 尾音；`armLoop` 回调仍用 `tail + 0.5` 接受窗口，锁屏回环兜底不变。`tests/player-state.test.js` 的排程断言按 88800ms 调整。
- **中断可观测（P2，运营）**：`audio-session.setReporter(fn)` 由 `app.js` 接 `events.track`（单测不启动上报定时器）。`audio_interrupt` 上报 `begin|trackId` 与 `end|<秒>s|resume|skip`；服务端 `TYPES` 放行，`analytics` 只把 `begin` 计入 `today/week/trend.interrupts`，后台播放卡副标变「本周 N · 中断 M」、14 天趋势 tooltip 追加中断数。
- **坏源黑名单下沉（P3，可靠性）**：`audio-cache` 新增模块级 `markBad/isBad/clearBad`；`peek()` 命中坏源返回空（组件回退远程、`audio-session` 续播与 `warmup/ensure` 不再反复命中），下载成功 / `remove()` / `cleanAll()` 自动解禁。`audio-dock` 删除私有 `_badUrls`，错误路径统一写缓存模块。
- **配套**：`index.wxml` / `stats.wxml` 的 `<now-playing id="np" />` 补 id（自动化取证需要；无视觉变化）。
- **文档铁律**：`AGENTS.md` §5 与 `docs/12` §10 新增「音频播放铁律」（状态单写入口 / 可见性 / 中断恢复 / 回环 / 停止二次确认 / 坏源与错误 / 可观测 / 回归门禁），`context.md` 与 `docs/13` §2.1 加指针；违反任一条视为回退已验收的真机行为。
- **验证**：`npm test` **355 项 / 354 通过 / 0 失败 / 1 skip**（新增中断上报 1 条、坏源黑名单 1 条、服务端白名单 1 条、analytics 1 条）；`npm run check` 通过（3 页面 / 22 JSON / 17 WXML / 19 WXSS，主包约 **593.6 KB**）；模拟器 390×844 实测：抽屉首点 `stopArmed=true` 且仍在播、二点停止（`currentId=''`）；迷你条首点转红不停止、二点停止且 `lastTrackActive=false`（截图 `docs/assets/l4-audio-stop-armed.png`、`l4-audio-stop-np-armed.png`）。
- **未机验/非代码**：真机的暖红上膛视觉与 3s 手感、1.2s 回环点听感；后台看板中断数需起服务 + 事件数据；多音源内容供给需运营素材；定时淡出受 `BackgroundAudioManager` 无 `volume` 限制，平台不支持。详见 `docs/12-sleep-audio-refresh.md` §9.6、`docs/13-acceptance-checklist.md` §2.1。

## 2026-10-25 · 环境音外部中断自动恢复 + 迷你条会话口径 + 后台曲末回环

- **根因（改前代码事实）**：①全仓没有 `wx.onAudioInterruptionBegin/End`，来电/闹钟/其他 App 抢占后只有底层 `pause`，没有任何续播入口；②`lastTrackActive` 有 8 个写入点，其中 `audio-dock.onError` 终态分支**不调用 `stop()` 就清会话**、`now-playing.handleError` 的 300ms 兜底同样清会话——网络/解码抖动时音频仍在出声，页面却把迷你条收掉；③`audio-dock.syncFromAudio` 在 `src` 为空时只信 `meta.lastTrackPlaying`，忽略真实 `paused`，外部中断后入睡页显示“已暂停”；④回环依赖 `onTimeUpdate`（官方口径：只有小程序在前台才回调），锁屏后只剩不可靠的 `onEnded`，且 `audio-timer.restore()` 的“无活音频”分支会 `stopAudio()` → `lastTrackActive=false`，把外部中断误判成用户停止；⑤`now-playing.handleEnded` 无“会话已终止”守卫，两组件谁先抢到 `claimEnded` 不确定。
- **新增 `utils/audio-session.js`（会话状态机，唯一写入口径）**：`markStopped()`（用户停止/定时到点/权益到期/清除数据）之外一律不清 `lastTrackActive`；`wantPlaying + userPaused` 区分“外部中断”与“用户在小程序内暂停”，800ms 宽限拦住停止/暂停后迟到的 `play`；`init()` 幂等注册 `wx.onAudioInterruptionBegin/End`，`App.onHide/onShow` 补偿“切到其他 App”场景；续播时 `src` 被清空则按 `lastTrackId` 重建（优先缓存），已到曲末先 `seek(0)`，`canPlay()` 与组件同口径（到期不靠中断恢复续播）；`allowReplay()` 给坏源/极短源 10s 8 次的重播上限。
- **可见性**：`now-playing.sync` 改为“仍在出声即显示”（`active = meta.active || !paused`），冷启动幽灵才隐藏；`audio-dock.syncFromAudio` 用 `!paused` 优先；`now-playing.handleStop` 补落 `lastTrackPlaying:false`（否则 `src` 被系统清空时会显示“正在播放”、点暂停反而起播）。两个组件的 `ended` 都先检查 `audioSession.isActive()` 再抢 claim。
- **回环兜底**：`player-state.armLoop()` 把“距曲末 tail 秒”换成 `setTimeout`，前台由 `onTimeUpdate` 每秒校准，锁屏后无 timeupdate 也能 `seek(0)`；`markUserPause/markStopped` 会清定时器；回环成功后立即重排，个别基础库 `seek` 后 `currentTime` 未刷新时补 800ms 重试。
- **配套修复**：`now-playing.toggle` 在重建 `src` 前先确定续播意图（BAM 赋 `src` 会自动起播，旧代码随后读 `audio.paused` 可能把刚重建的播放再暂停）；`audio-timer.stopAudio()` 统一走 `markStopped()`；统计页“清除数据”同步关闭自动恢复意图。
- **验证**：`npm test` **351 项 / 350 通过 / 0 失败 / 1 skip**（新增 `tests/audio-session.test.js` 13 条、`player-state` armLoop 3 条、`audio-timer` 2 条）；`npm run check` 通过（3 页面 / 22 JSON / 17 WXML / 19 WXSS，主包约 **588.1 KB**）；wechatide 模拟器 390×844 实测四条：外部暂停后迷你条保留 / 回前台自动续播（37s 继续）/ 应用内暂停不复活 / 应用内停止后迷你条消失且回前台不复活。
- **未真机**：来电/闹钟真实 interruption 回调顺序、锁屏多轮回环与微信悬浮音符、耳机拔出、通知栏暂停（API 无原因字段，当前按“外部中断可恢复”处理）。详见 `docs/12-sleep-audio-refresh.md` §9、`docs/13-acceptance-checklist.md` §2.1。

## 2026-10-25 · 全局按钮与文字触控弱状态反馈（计算器 · 入睡 · 统计全页面落地）

- **背景与目标**：解决真机轻触、快速点击、弱网交互时用户反映“不知道是否点击成功、缺乏按压弱状态反馈”的问题。采用微信小程序原生 `hover-class` 配合 `hover-stay-time="100~120ms"` + CSS `:active` 双层保障，确保轻触也能稳定展现轻柔弹性缩放与半透明确认。
- **计算器页 (`miniprogram/pages/index`)**：
  - 顶部模式切换胶囊（`.mode-capsule`）：增加 `hover-class="mode-capsule--tap"`，点击触发 `opacity: 0.76; transform: scale(0.97)`。
  - 正面输入区：文字链接「用现在的时间」（`.now-link`）配置 `opacity: 0.52; transform: scale(0.97)`；入睡耗时档位（`.fall-chip`）补充 `:active` 与弹性 `scale(0.94)`；正面主按钮「计算我的睡点」（`.calc-action`）配置 `transform: scale(0.96); opacity: 0.82; box-shadow` 紧贴微收。
  - 结果面背面：入睡耗时切换（`.result-fall`）与「提醒我入睡/起床」（`.result-remind`）配置 `opacity: 0.62~0.65; transform: scale(0.96)`；主 CTA「去入睡打卡」（`.result-go`）配置 `transform: scale(0.96); opacity: 0.82`；底部轻量药丸「‹ 返回」与「换成我想几点睡/起」配置物理下凹背景加深与微缩；脚注「为什么是 90 分钟？」（`.calc-note`）配置 `opacity: 0.55; transform: scale(0.98)`。
- **入睡页 (`miniprogram/pages/sleep`)**：
  - 中央主呼吸环（`.sleep-orb`）：配置 `transform: scale(0.96); opacity: 0.88`；顶部通知条（`.notice`）配置轻按反馈。
  - 进行中态（B态）：弱实心胶囊「到点提醒我记录起床」（`.sleep-reminder`）配置 `opacity: 0.65; transform: scale(0.97)`；超时卡片（`.sleep-overdue`）配置 `transform: scale(0.98)`；次级文字链接「点错了？撤销本次入睡」（`.undo-bed`）配置 `opacity: 0.52; transform: scale(0.97)`。
  - 空闲与完成态：居中主按钮「补记入睡」（`.manual-entry`）配置实底缩放与阴影贴紧；睡眠段操作「修改/删除」（`.session-op`）配置 `opacity: 0.5; transform: scale(0.94)`；完成态双按钮「继续入睡/补记入睡」（`.cta-mini`）配置 `transform: scale(0.96)`；文字链接「记录有误？撤销当天记录」（`.undo`）与底部统计轻量条（`.stats-strip`）均补齐触控反馈。
- **统计页 (`miniprogram/pages/stats`) 与公共组件**：
  - 统计页核心区：3 个指标卡（`.metric`）增加 `scale(0.97)` 弹性点击感；周期切换选项（`.span-tab`）配置 `opacity: 0.65; transform: scale(0.95)`；详情卡补记入口「补记一段 ›」（`.dd-add`）配置 `opacity: 0.52`；海报生成按钮（`.poster-btn`）配置柔和微缩。
  - 低频设置区：数据与备份「展开/收起」（`.settings-head`）、云备份「同步」（`.sync-btn`）、独立入口「删除云端副本」（`.cloud-del`）与「清除数据」（`.danger-entry`）全面添加触控弱状态。
  - 公共弹层面板（`styles/sheet.wxss`）：关闭叉号（`.end-close`）、醒来日选择行（`.end-date-row`）、时间项（`.end-time-item`）、主次保存按钮（`.end-btn`）统一定义并在三页弹层通用。
  - 空态组件（`components/empty-state`）：主按钮「去入睡」与次按钮「补记睡眠」增加触控下按弹性与透明度反馈。
- **验证**：`npm test` **333 项 / 332 通过 / 0 失败 / 1 skip**；`npm run check` 检查通过（3 页面 / 22 JSON / 17 WXML / 19 WXSS，主包约 **561.9 KB**）。

## 2026-10-25 · 结果面主按钮实底化 + 统计页 0 数据补记入口（Review P2-3 / P3-5 收口）

- **P2-3 结果面主 CTA 实底化与视觉呼吸空间拉开**：计算器背面「去入睡打卡」改为实底主药丸按钮（`background: var(--btn-primary-bg)`，文字与右箭头为 `var(--btn-primary-fg)` 纯白，字重 600，`box-shadow: var(--btn-primary-shadow)`，去边框），与正面主按钮规则严格对齐；主推荐卡拉高呼吸距离（内边距 26rpx，外边距 20rpx）；次级动作「提醒我入睡/起床」字号由 22rpx 扩大至 26rpx、图标 25rpx，颜色提亮为高对比柔白，与上方列表间距由 6rpx 拉大至 24rpx，消除原先紧贴压迫感；4 行 dense 依然紧凑 0 溢出（截图 `docs/assets/l4-calc-result-breathing.png`、`l4-calc-result-sleep-breathing.png`）。
- **入睡页视觉精简与层次提升**：①移除圆环下方冗余文案「只记录时间，不做睡眠评价」，页面更加纯净安宁；②「补记入睡」由小下划线文字链接升级为居中小实底主药丸按钮（`height: 64rpx`，`--btn-primary-*`），与打卡主色调呼应；③底部「分享这一段睡眠」由纯文本升级为带矢量分享图标（`variant="icon"`），全页呼吸感与质感显著提升（截图 `docs/assets/l4-sleep-visual-refined.png`）。
- **P3-5 统计页 0 数据态补记入口与视觉优化**：①通用组件 `empty-state` 扩展支持 `secondaryText` 属性与 `secondary` 事件抛出；空态主按钮「去入睡」升级为小实底主药丸按钮（`--btn-primary-*`），与次级「补记睡眠」形成分明主次；点击「补记睡眠」直接打开预填今天的手动补记底面板，新装用户白天进入统计页也可直接录入既往睡眠；②底部「数据与备份」标题由 24rpx 放大至 28rpx，右侧「展开/收起」字样由 20rpx 放大至 26rpx，层级与易读性显著提升（截图 `docs/assets/l4-p3-5-stats-empty.png`、`l4-stats-visual-refined.png`、`l4-stats-settings-open.png`；新增单测 `tests/stats-page.test.js`）。
- **统计页有数据态视觉优化（指标隔离微光竖线 · 主次分层 · 时间跨度弱背景 · 图例居中微透）**：①指标区隔离由生硬的整列边框升级为垂直居中、上下两端淡出的微光弱竖线（`linear-gradient`，64% 适中高度），通透晶莹；②核心指标主次强化：主指标「平均睡眠」放大为 52rpx / 700 纯白高亮并带微光阴影，次级「平均入睡 / 平均起床」收敛至 44rpx / 500 次白（`rgba(225,235,255,0.82)`），避免三指标等大导致视觉发散；③时间跨度选项紧凑化（间距收至 10rpx），当前项增加 `rgba(255, 255, 255, 0.12)` 简洁无边框弱背景胶囊，选中态自然温润；④日历图例由居左排布改为居中排布（`justify-content: center`），字号微调并降低透明度至 0.8，优雅不抢主表格（截图 `docs/assets/l4-stats-data-refined.png`）。
- **计算器结果面动作精简与去线框化（「‹ 返回」· 去掉按钮边框）**：①「重新选择」精简为「‹ 返回」，与卡片 3D 翻转返回正面的导航心理模型精准契合，字数减半，左右主次分明，与右侧 `⇄` 形成方向符号呼应；②`.result-reset` 与 `.result-switch` 移除 `border`，采用柔和弱背景胶囊（白柔光 `0.08` 与紫柔光 `0.10`），消除生硬 1px 线框感（单测 `tests/calc-copy.test.js`）。
- **入睡页进行中态（B态）视觉优化（弱实心提醒按钮 · 撤销与分享同行并排）**：①「到点提醒我记录起床」升级为简洁无边框弱实心胶囊按钮（`rgba(255, 255, 255, 0.08)`，开启态弱紫微光 `0.22` 高亮）；②次级动作行重构为左右并排：左侧「点错了？撤销本次入睡」，右侧「分享这一段睡眠」，居中 560rpx 优雅两端对齐，消除层叠孤行感，底部 `sleep-share` 仅在非 sleeping 态显示避免重复。
- **验证**：`npm test` **333 项 / 332 通过 / 0 失败 / 1 skip**（PG 用例无 `PG_TEST_URL` 时跳过；新增统计页空态双 CTA 及唤起补记单测 1 项、返回文案断言 1 项）；`npm run check` 检查通过（3 页面 / 22 JSON / 17 WXML / 19 WXSS，主包约 **555.9 KB**）；微信开发者工具模拟器交互及控制台复核通过（0 error）。
- **文档与工程化**：`07-code-review.md` 开放项收口并标注解决状态；`13-acceptance-checklist.md` §1.14 补齐证据链条；`context.md` 与 `AGENTS.md` 门禁基线同步。

## 2026-10-25 · 修复轮模拟器复核 + 文档工程化整理（无代码改动）

- **模拟器复核**（`wechatide` CLI，iPhone 12/13 Pro 390×844）：结果面两种模式 4 行 dense 不溢出；未配模板点「提醒我」直接弹日历兜底、不先弹订阅授权；**计算→打卡闭环运行时取证**——入睡模式算出 20:22 →「去入睡打卡」→ `meta.planTarget.wakeAt` 同值 → `markSleep()` 后 `pending.expectedWakeAt = 20:22`（白天默认应为 now+90min ≈ 14:10）、`planTarget` 已清；熄灯/结束面板/C 态/统计/清除确认顺带回归正常；console `grep -i error` 为空。「✓ 已设提醒」态需配置模板，**未验**。详见 docs/13 §1.14。
- **文档**：①2026-10-25 审查报告入库为 [07-code-review.md §B](07-code-review.md)（逐条状态 + 提交号 + 开放项），修复 context/changelog 中指向仓库外「review 报告 P2-3」的悬空引用；②`context.md` §7 第 29–33 条从 §8 之后归位、重复编号第二个 23 改 `23b`（外部按编号引用，不整体重排）、混合换行统一 CRLF、ADR 数 18→27；③`context.md` §8 补模拟器取证命令与截图约定；④`AGENTS.md` §3-6 补截图命名规则。
- **仓库卫生**：`.gitignore` 新增 `logs/`、`.agents/`、`wechatide-tools/`、`wechatide-skill/`（Agent 技能已装在用户全局目录，不入库）与 `docs/assets/review-*.png`、`docs/assets/test-*.png`（临时探针图）；本轮 19 张临时截图已删除。
- 验证：`npm test` 332 / 331 / 0 fail / 1 skip（PG）；`npm run check` 552.4 KB。部署：无。

## 2026-10-25 · Code Review 修复轮（提醒落地页 · 计算→打卡闭环 · 提醒按钮 · 自动缓存）

- **P1 提醒落地页**：结果面计划提醒此前与打卡会话共用 `pages/sleep/sleep?end=1`——「该睡了」点进来若已打卡会**直接弹出结束面板**（易误存十几分钟的一段），未打卡则提示「这次入睡已经结束过了」。现在 `services/reminders.pageFor` 按前缀改写：`plan-s-` → `?remind=sleep`、`plan-w-` → `?remind=wake`，**保存与发送两处都改写**，上线前已排队的旧行在发送时同样被纠正（无需迁移）。入睡页 `consumeLaunchIntent()` 统一消费 `end`/`remind`：`remind=sleep` 永不开面板；`remind=wake` 在计时则结束、否则引导「补记入睡」。
- **P2 计算→打卡闭环**：「去入睡打卡」把算出的起床时刻写入 `meta.planTarget`（本机、不同步），打卡时作为 `expectedWakeAt`（只消费一次；算完 >12h 或不在 16h 窗口内丢弃）。此前入睡模式算出 06:45、打卡仍按偏好 07:30 判超时与发提醒。
- **P2 提醒去重**：结果面提醒写 `meta.planReminder`；入睡页若已有落在预计起床的「提醒我起床」，直接显示「已开启」，不再引导二次订阅。改时间重设时撤掉旧的那条；本地「清除全部数据」同时取消。
- **P2 提醒按钮**：先本地挡「已过/已设/未配置」再申请订阅（此前先授权才告知不行）；`mainPassed` 改用真实当前时刻（原用最多落后 30 分钟的锚点）；设置后显示「✓ 已设提醒」（薄荷色）并防连点；模板未配置/拒绝授权时与入睡页一致走「加入手机日历」兜底。
- **P3**：朋友圈单页模式（scene 1154）隐藏「去入睡打卡 / 提醒我」；自动缓存改为播放时实时取网络类型（离线不排队）、并受 `maxMB` 容量闸（`cache.canAutoCache`）约束；`getNetworkType` 异步回调前已停止播放不再排队；删除死样式 `.result-action:active`。
- 验证：`npm test` **332 项 / 331 通过 / 0 失败 / 1 skip**（PG，无 `PG_TEST_URL`；新增服务端 2 条（另改 1 条原把 `?end=1` 当正确结果锁住的断言）、入睡页 6 条、计算器 5 条、缓存 1 条）；`npm run check` 通过（主包约 552.4 KB）。**视觉/真机未验**：「已设提醒」态、单页模式隐藏、订阅点击落地分流，见 docs/13 §1.14。
- 部署：仅需重建 api（`docker compose up -d --build --no-deps api`），无 DB 变更；小程序需发新版本才有 `remind` 分流（旧版本收到 `?remind=` 会停在入睡页、不开面板，已比原行为安全）。

## 2026-10-25 · 播放后自动缓存（非 Wi-Fi 也不再重复下载）

- **问题**：普通播放只 `peekCached`（命中用本地、否则流式），**从不写缓存**；非 Wi-Fi 用户听完一首、切歌再切回或杀进程重进，都会重新拉流，重复耗流量。此前只有「看广告解锁并行下载」「Wi-Fi 预热前两条」会落盘。
- **改动**：`play()` 起播后排队自动缓存——**Wi-Fi 立即**、**移动网络延迟 15 秒**（`cache.autoCacheDelay`，避免点开听两秒也下整首）；`detached` / `stopPlayback` 清理定时器；`refreshCache` 文案补「首」。
- **同时修一个重播 bug**：`play()` 原先先 `peekCached` 再清 `_badUrls`，导致上一轮播放失败拉黑后，即使文件已下载好，重播仍走远程；现在**先清黑名单再取缓存**。
- **代价与取舍**：小程序无法复用 `BackgroundAudioManager` 的流缓存，首次播放会与后台下载并行（约多耗 1 倍流量），换来之后每次播放都走本地、0 流量；按「平均听 2 次以上」即净省。Wi-Fi 下无感。
- 验证：`npm test` **318 项 / 317 通过 / 1 skip**（新增 `autoCacheDelay` 用例）；`npm run check` 通过（543.0 KB）；模拟器实测——清缓存后 `0/1 · 0.0MB` → Wi-Fi 播放 → 25s 后 `1/1 · 5.4MB` → 再次播放 `_expectSrc = http://usr/sleep-audio/…`、`_playingFromCache=true`、正常播放，console 无 error。

## 2026-10-25 · 结果面视觉细化：推荐卡呼吸 · 提醒入口放大 · 底部动作分层 · 分享升级

- **「15 分钟入睡」胶囊**：高度 64→56rpx，与 46rpx 主时间同排时不压过主信息。
- **主推荐卡上下呼吸**：常规 padding 22→26rpx（dense 16→20、compact+dense 16→18），说明行与时间不再贴边；4 行 dense 仍不溢出。
- **提醒入口放大**：「提醒我入睡 / 提醒我起床」21→24rpx（dense/compact 22rpx）、字重 500、图标 20→22rpx，与右侧主 CTA 同一视觉重量，不再像小字注释。
- **主 CTA 收窄靠右**：「去入睡打卡」不再 `flex:1` 拉满整行，改为 `flex:none + margin-left:auto + padding 0 34rpx`，宽度按内容，左侧留给提醒入口。
- **底部动作分层**：「重新选择」「换成我想几点睡/起」升级为一对轻 pill——左侧实底浅色、右侧描边主色，字号 24rpx、高 72rpx（dense 64）；层级仍低于上方主 CTA。
- **分享升级**：「分享给朋友」由纯蓝链接改为图标 + 文字（`share-btn` 的 `icon` 变体支持自定义文案），图标 32rpx、文案 23rpx，视觉更精致且弱于两个 pill。
- 验证：`npm run check` 通过（主包约 540.8 KB）；模拟器实测起床模式（2 行）与入睡模式（4 行 dense）——胶囊高度、主卡呼吸、提醒字号、CTA 靠右、两个 pill、分享图标均符合预期，底部无溢出，console 无 error（截图 `docs/assets/l4-v2-result-wake.png`、`l4-v2-result-sleep.png`）。

## 2026-10-25 · 结果面「到点提醒我」+ 入睡页文案澄清 + 推荐列表呼吸

- **入睡页文案**：「到点提醒我结束」→「**到点提醒我记录起床**」，已开启态为「已开启 · 到点提醒记录起床」。原文案的“结束”指代不明（结束睡眠？结束计时？），而实际动作是“回来记录起床”。
- **结果面主推荐提醒入口**：与「去入睡打卡」同一行加次级按钮「提醒我入睡」/「提醒我起床」（按模式切换），不额外占纵向预算；仅当主推荐时间仍在 1 分钟之后时显示。点击 → 一次订阅授权 → 成功后提示「已设置提醒」；未配置模板/拒绝授权给出可行动提示。
- **服务端按来源发不同文案**：`plan-s-` 前缀 → 「该睡了」，`plan-w-` → 「该起床了」，打卡会话仍为「结束入睡」；前缀编码在 sessionId，避免给 `sleep_reminders` 加列迁移。结果面提醒不依赖 pending，sessionId 用 `plan-<kind>-<fireAt>`。
- **推荐列表呼吸**：行上下 padding 16→20rpx（dense 9→12、compact 10→13），主推荐与列表间距 16→20rpx；4 行 dense 仍不溢出（截图验证）。
- 平台口径不变：一次性订阅，**一次授权一条**，不承诺“每天”，也不当起床闹钟（文案只写“提醒”，并提示可先用系统闹钟）。
- 验证：`npm test` **317 项 / 316 通过 / 1 skip**（新增结果面文案按来源发送的断言）；模拟器实测两种模式入口、4 行 dense 布局、入睡页新文案，console 无 error（截图 `docs/assets/l4-remind-wake.png`、`l4-remind-sleep.png`、`l4-remind-sleep-page.png`）。

## 2026-10-24 · 订阅消息支持模板字段映射（适配 time1/thing2 类模板）

- **问题**：发送端把字段名写死为 `thing1`/`time2`。公共模板库里可选的「睡觉到点提醒」（编号 26461）字段是 `time1`（提醒时间）+ `thing2`（超时惩罚），直接使用会返回 `47003`，提醒永远发不出去。
- **后台**：「小程序与提醒」新增「模板字段映射」两个输入（提醒事项字段名 / 提醒时间字段名），保存即生效；校验 `^[a-z]+\d{1,2}$` 且两者不能相同。
- **服务端**：`config-schema` 的 `reminder` 增加 `thingKey`/`timeKey`（默认 `thing1`/`time2`）；调度器按当前映射动态构造 `data`，不再写死键名。
- **文档**：`docs/10` §3.2.1 增加字段映射表与「睡觉到点提醒」的具体填法，并标注该模板第二个字段展示为「超时惩罚」，睡前措辞偏负面，正式版建议申请 `thing`+`time` 模板。
- 验证：`npm test` **316 项 / 315 通过 / 1 skip**（新增 `time1`+`thing2` 发送键与内容断言、非法/重复字段名校验）；`node --check` 后台脚本通过。

## 2026-10-23 · 国际站阶段 2–4：匿名同步 · 付费墙 · 广告位

> 承接阶段 1。原则不变：**不复制算法**，Web 只消费 `miniprogram/utils` 的纯函数。

- **匿名身份（阶段 2 硬门槛）**：`/api/records/sync` 与 `/records/erase` 新增 `deviceToken` 通道——客户端生成 32 字节随机串，服务端只存 `d_` + `sha256` 前 40 位（库泄露也拿不到原 token）。小程序 `code → openid` 通道保持不变，两条通道共用同一套 LWW / 墓碑 / erasure 水位；限流维度仍是 subject。
- **记录级时区落库**：`validateRecords` 接受 `tzOffsetMin`（clamp −720..840），`day` 按记录自身时区计算；缺省/非法值回退北京口径。**未加 DB 列**——`day` 已在写入时算好，等需要追溯再加（加法迁移）。
- **付费墙（阶段 3 骨架）**：`web.freeLimit`（0=不限）+ `web.proUrl`；超出免费额度且配置了购买链接时，保存按钮禁用并展示升级卡。无 `proUrl` 时不限制（避免没有支付通道就锁死用户）。
- **广告位（阶段 4 骨架）**：`adsenseClient` 非空时才注入 AdSense 脚本与槽位，并在 `_headers` 放开对应 CSP；默认关闭，零请求。
- **自检工具**：`tools/verify-web.mjs` 起临时静态服务，逐页校验 200 / lang / title 唯一 / canonical / hreflang / JSON-LD / 资源可达，当前 `pages=11 OK`。
- **验证**：`npm test` **315 项 / 314 通过 / 0 失败 / 1 skip**（新增 `server/test/validate-tz.test.js` 3 条）；`npm run check` 通过；`build:web` + `verify-web` 通过；内存模式实测 `deviceToken` 同步 `synced=1 dropped=0 day=2026-10-22`、云删除 `deleted=1`、CORS 与缓存头正确。

## 2026-10-23 · 国际站阶段 1：core 复用 + 时区模型 + 静态站 + 后台可视化

> 来源：商业化讨论（小程序广告依赖单一平台，出海 H5 做 SEO + 订阅）。PRD 见 `docs/14-intl-prd.md`。

- **时区模型（已拍板：记录级时区，默认 +480）**：`utils/time.js` 新增 `dayKeyOf(ts, tzOffsetMin)`，`calendarDayKey` 改为其包装（不传时区时行为与历史完全一致）；`sessions.sessionDay` 增第二参数。小程序全链路仍走 +480，零回归。
- **core 复用（不复制算法）**：`tools/build-web.mjs` 直接读取 `miniprogram/utils/{time,format,sessions,plan}.js` 打包成浏览器 bundle。此前 `server/public/site/demo.js` 已经复制过一份 `sleepDayOf`，本轮确立「Web 只引用、不重写」的规则。
- **国际站静态站（零第三方依赖）**：`web/content/{site,i18n,pages}.json` + `web/assets/{app.js,app.css}` → `npm run build:web` 产出 11 页（en 8 / es 3）、sitemap、robots、`_headers`（CSP + 长缓存）、favicon，总 104KB。每页含 canonical、hreflang、JSON-LD（WebApplication + FAQPage）。
- **配置下发**：`config-schema.js` 新增 `web` 段（brand/tagline/ctaUrl/adsenseClient/analyticsId/locales/disclaimer），带 https 与 `ca-pub-` 校验；`app.config.json`、`miniprogram/config/fallback.js` 同步默认值；`GET /api/config` 由 `no-store` 改为 `max-age=30, stale-while-revalidate=300`。
- **跨域**：`app.js` 增 `WEB_ORIGINS` 白名单 CORS（不带 Cookie，仅 GET/POST/OPTIONS），未配置时行为不变。
- **后台可视化**：新增「国际站」面板（启用开关、品牌、标语、订阅入口、AdSense ID、分析 ID、免责声明），与其它面板同一套保存/校验链路。
- **验证**：`npm test` **312 项 / 311 通过 / 0 失败 / 1 skip**（新增 `tests/web-intl.test.js` 5 条：时区、core 无平台依赖、双向计算、内容完整性）；`npm run check` 通过（主包 536.1 KB）；`build:web` 产出 11 页、104KB。

## 2026-10-23 · 代码审查修复轮：播放器停止入口 · 令牌签名派生 · 补记默认值 · 音频配置自愈

> 来源：外部审查报告（2 P1 / 9 P2 / 约 20 P3）。逐条对照源码核验：P1 全部属实，P2 九条中八条属实、P2-3 属结构隐患（历史模拟器实测未溢出），P3 择要修复；本轮**未改**的项见文末。

- **P1 修复：迷你播放器补「停止」**：`now-playing.wxml` 的 `.np-ctrls` 此前只绑 `toggle`，`close()`/`goSleep()` 零绑定 —— 首页/统计页只能暂停，无法结束会话。补 76rpx 停止钮（`catchtap="close"`，伪元素外扩 88rpx，`aria-label="停止播放"`），`catchtap` 阻止冒泡到 `openAudio`。
- **P1 修复：改密后令牌签名密钥不再恒定**：未配 `ADMIN_SECRET` 的部署里 `secret` 就是 `ADMIN_PASSWORD`，改密只让 version +1，旧密码持有者可离线签名并枚举 1..N 个 version 伪造 Cookie。`admin-auth.sign()` 改为经 `signKey()`：有库凭据时用 `HMAC(secret, 'cred.'+salt+'.'+hash)` 派生，改密即换密钥。**副作用：升级后现有后台会话失效一次（重新登录）**。新增 `server/test/admin-auth.test.js` 3 条锁定。
- **P2 修复：入睡页 tabBar 单一裁决**：新增 `syncTabbar({dim,endShow})`，替换 6 处零散 `tabbar.show/hide`。此前 `closeSheet`/`onEndCancel` 无条件 `show()`、`onDockSheetClose` 只在 `dim` 时补 `hide()` → 结束面板与声音抽屉同开时，关抽屉会把独立 root 的 tabBar 翻到面板之上。`onHide` 改为无条件 `show()`（离开页面不带走 hidden 态）。
- **P2 修复：入睡页「补记入睡」默认值必红字**：C 态刚保存的段结束时间就是现在，`defaultTimesFor(preset:false)` 的「30 分钟前→现在」必然重叠；`napTimesFor` 的候选又全在 10:00–17:30，清晨全部 future 后仍回退到重叠值。改为：当天已有记录时走 `napTimesFor(..., {recent:true})`，新增 `recentFreeSlot()` 从“现在”往前按 30 分钟找第一个已结束且不重叠的空档（最多回溯 24h）。统计页不带 `recent`，保持「优先下午小睡」原语义。新增 3 条单测（含清晨 07:05 场景）。
- **P2 修复：计算器结果面纵向预算**：`.result-row-time` 显式 `line-height:1.15`（不再继承 page 的 1.6，三行省约 51rpx）；`.is-dense` 的压缩从父容器 `min-height` 改到子项（父级 min-height 不会缩子元素，旧写法的 22rpx 余量实际不存在）；`.result-note` 固定两行 clamp。注：历史模拟器实测（390×844）本无溢出，本条属结构性加固。
- **P2 修复：横滑月历可读性**：未来日去掉整格 `opacity:.5`（40rpx 格上会把日号压到不可读），改为只降文字色；日号 16→18rpx；`.is-selected` 由 `box-shadow` 改 `outline`（原写法被后面的 `.is-partial` 覆盖，选中「今天」看不到反馈）。
- **P2 修复：时间轮支持点击选值**：两列行加 `data-col/data-value + bindtap="onItemTap"`，命中后走与 `settle` 相同的 `scrollToValue` 落位/回中路径并 `triggerEvent('change')`，与滑动手势不冲突。
- **P2 修复：圆均值无解时的病句**：`circularMeanMinutes` 在记录分散到表盘两端时返回 null，`clockText(null)` 得 `--:--`，detail 直接拼成「本周 N 天平均 --:-- 入睡」。`metricsOf` 的入睡/起床与 `factsOf` 改为「算不出平均」+ 原因说明，sub 显示「时间分散，算不出平均」。
- **P2 修复：音频配置自愈 + 兜底免费态**：`audio-dock` 此前只在 attached 拉一次配置（tab 页常驻不重建），首拉失败整场会话钉死在内置兜底（仅 1 条雨声、空广告位=免费）。`pageLifetimes.show` 补 `loadConfig(false)`（10 分钟 TTL，不增请求），指纹变化才 `applyRemoteConfig`；同时处理“当前曲目已下架”。`config.merge` 新增 `degraded` 标记区分「后台就是免费」与「配置没拉到」；从 degraded 恢复到真实配置时权益中断文案改为「网络已恢复，解锁后可继续播放」，不再误报「解锁已到期」。
- **P2 修复：now-playing 不再误删健康缓存**：本地源报错分支补 `cache.isUsable()` 判断，与 audio-dock 同口径（原写法一次网络/解码错误就删掉好文件）。
- **P3 修复**：广告「失败→load→show」重试链重置 90s 总超时（原首轮超时继续计时，广告在播也会被判 error 并按 grant 放行）；`routes/admin.js` 审计 catch 用兜底后的 `log`（未注入 logger 时 `logger.error` 会 TypeError，密码已改却返回 500）；`/api/reminders` 的 DB 异常改为 503 + 日志（原 500 无日志）。
- **跨工具冷启动入口（AGENTS.md）**：此前仓库没有 `AGENTS.md` / `CLAUDE.md`，README 只是产品说明，新会话没有任何"先读什么"的约定——本轮部署误用模板默认端口与臆测路径，根因就在这里。新增根目录 `AGENTS.md`：阅读顺序（context.md → DECISIONS.md → docs/13 → docs/10 §3.0 → 源码）、事实优先级（**现场实测 > 代码 > 文档 > 模型记忆**）、门禁命令与当前基线、六条防误导纪律（第一轮只取证 / 线上结论必须取现场证据 / 报告不是事实 / 断言结构与位置 / 部署最小动作 / 结论可复现）、生产红线与改动入口地图；`CLAUDE.md` 为薄壳指向它，README 顶部与 `context.md` 头部各加一行指路；另补 `.github/copilot-instructions.md` 与 `.cursor/rules/agents.mdc` 两个纯指针，覆盖只认自己文件名的工具。规则单源在 `AGENTS.md`。
- **部署现场回写文档（2026-10-23 实测）**：`docs/10-operations.md` 原写 `/opt/getsleep`、代理 `3000`，与生产不符（实际 `/opt/1panel/www/sites/sleepDS/index`、`HOST_PORT=3004`，反代指向 3004）。已补「生产现场事实」表与三条红线——禁止 `docker compose down` / `--remove-orphans` / 改项目名（三站点目录末级都叫 `index`，Compose 项目名撞成同一个，`down` 会连带停掉 fde 与 mmreen；改项目名会换命名卷，等于连到空库）；迭代部署改为 `docker compose up -d --build --no-deps api`；新增「备份产物 → 代码/compose/数据库还原 → 部署后必查」runbook。
- **迷你播放条折叠口径统一**：`.np-shell` 原为 `position:fixed; left:0; right:0` 且 `pointer-events:auto`，外壳铺满整行，播放条左侧留白把点击吞掉，导致「点条外空白不折叠」；入睡页 dock 只锚右所以能折。改为只锚 `right:0` 由内容撑宽、`.now-playing` 给确定宽度 `480rpx`（`max-width: calc(100vw - 24rpx)`），行为与入睡页一致。
- **备份脚本不再吞失败（部署侧，直接关系大改数据库前的退路）**：`deploy/backup.sh` 原写法 `docker compose exec ... pg_dump | gzip > x.gz` 在 `sh` 下退出码取管道末端的 gzip，`pg_dump` 失败也会留下一个空 `.gz` 并打印 `backup ok`。改为先写临时 SQL 再压缩，并校验「非空 + 含 `PostgreSQL database dump complete`」，任一不满足即非零退出；失败时清理临时文件，成功时打印压缩包字节数。
- **核验后不改**：①`<custom-tab-bar />` 是微信特殊组件，`tools/check.mjs:124-126` 明确禁止写进 `usingComponents`、由目录自动注册，页面挂载是门禁要求，删改需同时改门禁并真机验证；②统计页 0 数据不渲染日历属产品空态决策（保留）；③`.metric-sub` 18rpx、`.action-arrow` 硬编码、`--heat-*` 死 token、`posterPath` 无消费方、`001_init.sql` 与运行时 DDL 分叉、备份脚本管道退出码等 P3 记录在案，未在本轮动。
- 验证：`npm test` **307 项 / 306 通过 / 0 失败 / 1 PG skip**；`npm run check` 通过（3 页面 / 22 JSON / 17 WXML / 19 WXSS，主包约 535.2 KB）；全部改动文件 `node --check` 通过。**视觉项未做模拟器复验**（打开开发者工具窗口被取消），已登记 docs/13 第 2 区。

## 2026-10-23 · 提审前收口：改密闭环 · 看板补记 · 编辑守卫修复 · 死组件清理

> 上一轮推荐方案的代码事实核实与落地。四项全部属实；另发现并修复一个时间敏感的 P1。

- **P1 修复：编辑跨午夜段被误判**：`computeEndSheet` 的编辑守卫按「入睡 ≥ 起床」一律报错，但跨午夜段（23:30→00:30）本应交给 `rangeForDay` 回退一天——导致这类段完全无法编辑，且 `sleep-page.test.js` 用例在凌晨时段随机失败。改为先查原段是否跨午夜（新增 `editingSessionOf()`，先查页面 record 再回退扫存储），同日段仍拦截（防午休静默变 23.5 小时跨天段），跨午夜段放行；补「同日段仍被拦」回归用例。
- **死组件清理**：删除零引用的 `components/heatmap`（旧横向热力图，git 跟踪）与 `components/sleep-trend`（旧 14 天柱状趋势，**git 从未跟踪的本地残留目录**，仅影响本地包体）；`npm run check` 组件引用校验与全量测试均绿，目录文档同步。实测 `git ls-files` 已无这两个组件。
- **看板补记聚合**：`analytics.js` 增加 `manualSleeps`（today/week，与 checkins 同口径），后台概览新增「今日补记」卡片（周合计副标），`.stats` 网格改 `auto-fit minmax(150px)` 以容纳第 5 张卡；`admin.test.js` 断言补记计数进看板。补记埋点至此才有运营出口（只打卡不补记 vs 高补记率是判断打卡闭环的关键信号）。
- **后台改密闭环（ADR-013 兑现）**：
  - `admin-auth`：密码改存 scrypt（随机 16 字节盐、64 字节 key），env 密码仅首次引导；令牌升级 v2，格式 `v2.<凭据版本>.<exp>.<sig>`，改密版本 +1 → 所有旧 Cookie 立即失效（免重启）。
  - 接口：`GET /api/admin/security`（来源 db/env、上次修改时间、是否持久化）、`POST /api/admin/password`（校验当前密码 → 新密码 ≥8 且 ≠ 旧密码 → 落库 → 清 Cookie → 审计 `admin_password_change`，不落明文/哈希）；改密有独立限流桶（5 次/分），不挤占登录额度。
  - 启动：`index.js` 启动时读 `admin_credentials`（**坑：`db.getSetting` 返回 `{value, updatedAt}` 包装，必须取 `.value`**，否则重启后改密丢失、静默回退 env），读失败不阻断启动并告警。
  - 后台 UI：左菜单新增「安全」面板（当前/新/确认 + 来源徽标 + 上次修改时间 + 内存模式提示）；改密请求走原生 fetch（不用 `api()`，避免 401 被当成"登录过期"弹登录框）。
  - 测试：错旧密 401、弱密码 400、改后旧会话失效、env 密码失效、新密码可登、审计留痕且不含密码材料、用库内凭据重建 app 后新密码仍可登（持久化契约）。
- 验证：`npm test` **300 项 / 299 通过 / 0 失败 / 1 PG skip**；`npm run check` 通过（22 JSON / 17 WXML / 19 WXSS，主包 525.3 KB）；五个改动文件 `node --check` 通过；真实进程冒烟（`PORT=3199 DB_MODE=memory`）：`/api/ready` 200、`/admin` 含安全面板、`admin.js` 含改密逻辑。**后台「安全」面板的浏览器点击未做人工验收**（API 已全测），见 docs/13。

## 2026-10-22 · 评审整改：结果面锚点 / 统计口径 / 同步上限 / 提醒水位 / 音频权益

> 来源：对当前工作区代码的 6 路线评审（计算器 / 统计 / 入睡 / 音频 / 服务端后台 / 视觉）。本轮先修 P1 与高价值 P2，P3 中需要产品拍板或真实设备的项仍留在验收清单。

- **计算器结果面跨夜失效（P1）**：`calc()` 增加 30 分钟锚点寿命（`RESULT_TTL_MS`）；超过后切回/停在结果面都按当前时刻重算，避免次日仍把 06:15 标成「明天」的过期推荐。删除 `onShow` 里重复的第二次 `calc(true)`。
- **统计日详情口径（P1）**：主行改为「首段入睡 → 末段起床 · 共当天总睡眠」，副行改为「N 段 · 最长一段 X · 其余 Y · 按醒来日归档」，不再把主段区间与总时长拼成一句，也不再把单段午睡硬叫「夜间」。
- **统计日历刷新（P2）**：刷新签名纳入每格 `durationMin`；同档内的补记/编辑不再让格子数字停在旧值。
- **云端删除失败闸门（P2）**：`cloudPendingErase` 进页面 data，「删除云端副本（保留本机）」入口改为 `hasCloudCopy || cloudPendingErase`；删除失败选「稍后重试」也 refresh，选「只清本机」保留闸门，避免开关与 storage 分叉。
- **同步 64KB 上限（P2）**：客户端 `chunkRecords` 按「60 条 + 40KB」双上限分片，首片先扣墓碑字节；服务端 `express.json` 提到 256KB；`cd server && npm test` 脚本改为 `node --test test/*.test.js`。
- **订阅提醒补发（P2）**：发送前把迟到超过 15 分钟的 pending 标记 `expired` 不调用微信；清理移到 `enabled` 判断之前。
- **音频解锁有效期（P2）**：dock 的 `onPlay`、跨页 now-playing 的 `onTimeUpdate`（15s 低频）与 dock 的 `timeupdate` 都复检权益，堵住「无缝回环绕过 onEnded 后一直播」的漏口。
- **音频加载幽灵态（P2）**：12s 超时复位 `playing/loading`、展开播放条显示「连接超时，点按重试」并回写 `lastTrackPlaying:false`；`play()` 末尾补 `safePlay()`。
- **tabBar owner（P2）**：sleep `onShow` 在 `dim || endShow` 时 hide；audio-dock 的 `pageLifetimes.show` 不再无条件 `tabbar.show()`；抽屉关闭在熄灯态补一次 hide。
- **入睡页降级与热区（P2/P3）**：`recordView=null` 时 done 分支显示可撤销提示；相邻段不再被算成一次醒来；时间轴段加 `min-width:6rpx`；CTA 88rpx、修改/删除间距 16rpx、命中区 88rpx。
- **统计/视觉细节**：统计页底部清场改为单源 `300rpx + safe`（原 `.page` 200 + spacer 180 叠加成 380 + 双 safe）；月历 `‹` 到边界有禁用态；未来日期去掉整格 opacity；选中态改 outline；已记录日详情加「补记一段」；跨月 tab 热区与按下态。
- **结果面布局（已机验）**：`is-dense` 不再排除 compact，dense 间距再收一档，`result-note` 行高收紧。模拟器 390×844 实测：compact 与「补觉行 + 两行 note」的 `.result-share` 底 ≈ 612px，与 `.calc-back` 底 612px 齐平，脚注顶 646px，无溢出。
- **统计日详情（走查修正）**：多段主行改为「首段 22:57 入睡 · 末段 03:03 起床 · 共 …」，不再用箭头暗示连续区间；详情卡渲染后 `wx.pageScrollTo` 滚到可视区，避免被浮动 tabBar 盖住；已记录日「补记一段」默认给第一个不与已有段重叠的下午小睡（13:00→13:30 被占用则 14:00→14:30），不再一打开就是重叠红字。
- **v1 迁移数据完整性**：`storage.saveSession` 若目标日挂着一条“实际醒来日是次日”的旧 v1 夜间记录，先把该记录迁到真实醒来日再聚合，避免生成跨两个醒来日的记录（服务端 `validateRecords` 会整条丢弃）。新增回归覆盖该场景。
- **测试稳定性**：入睡页「完成态文案中性」用例冻结时间，避免跨午夜后因“记录日 ≠ 今天”变红。
- **模拟器走查（2026-10-23 00:00，390×844）**：结果面 rect、统计底部 190px（300rpx + safe）、月历未来日号（原图可读）、日详情/补记默认/自动滚动、结束面板 tabBar 隐藏、熄灯层「已入睡」、音频抽屉播放、真实 tab 切换后的跨页音符/播放条、console 无 error/warn 均已过；测试数据已清理。**未验**：320/360 宽、弱网 12s 超时、1 小时 TTL、落地页、真机音频/订阅、PG。
- **落地页**：≤900px 改为文案/CTA 在前、手机在后；无小程序码时空态文案改为「微信搜索」，与页脚一致。
- 验证：`npm test` **297 项 / 296 通过 / 0 失败 / 1 skip**；`npm run check` 通过（3 页 / 23 JSON / 18 WXML / 20 WXSS，主包约 530.5 KB）。
- 本轮未做（仍在 docs/13 跟踪）：周对比样本量披露、非 UTC+8 的 dateKey/归档日统一、时间轮点选、事件幂等、`001_init.sql` 单源、后台「事实回顾」死开关、截图重拍。

## 2026-10-22 · 空态去月牙只留日历格 · 同步按钮改「图标 + 同步」

- **空态（截图反馈「像上下两个图标」）**：上一轮把 3×3 网格放在月牙下方，实际渲染被读成两个并列图标。两种收敛方案中选了「只留日历格」——把 9 格塞进 49px 的月牙会与月牙缺口打架。现在：柔光保留作夜色氛围，3×3 格居中、单格 30rpx、描边 0.22，左上第一格呼吸；删掉 `.es-moon` / `.es-moon-wrap`，空态场景高度由 224rpx 收到 164rpx。
- **同步按钮（截图反馈「去掉矩形框，图标+同步」）**：`.sync-btn` 去掉边框与底色，改为 CSS 画的开口圆 + 箭头（避免 emoji/字体字形漂移）+「同步」文字；高度 52rpx 与开关轨道齐平，忙碌时图标 0.9s 匀速旋转、文案「同步中…」，`::after` 把触控高度补到约 43px。
- 验证：`npm test` **286 项 / 285 通过 / 1 PG skip**；`npm run check` 通过（513.9 KB）；模拟器空态与同步常态/忙碌态实测，console 无 error（截图 `docs/assets/l4-empty-grid.png`、`l4-sync-btn.png`、`l4-sync-btn-busy.png`）。

## 2026-10-22 · 入睡完成态：时间轴改为按本日睡眠段分段

- **问题（截图反馈）**：完成态时间轴是一条 00:09→00:39 的直线，暗示连续睡了 30 分钟；但大数字是总睡眠 26 分钟（中间有 1 分钟 + 3 分钟清醒），两者对不上，也看不出「本日睡眠段」列表与时间轴的关系。
- **修复**：`buildRecordView` 按 `[首段入睡, 末段起床]` 的比例给每段落位（`timeline: [{ key, left, width }]`，最小宽度 0.8% 保证极短段仍可见），WXML 用绝对定位亮条画在轨道上，缺口即清醒；多段时轨道下补一行段间说明（`segmentsText`），单段不显示以免噪音。
- **措辞二次修正（同日，截图反馈「看不明白」）**：摘要原为「N 段 · 清醒 X 分钟」，没说清是哪段时间、醒了几次。改为按间隔分流——间隔 < 90 分钟写「N 段 · 中间醒了 M 次（X 分钟）」，≥ 90 分钟（夜间+午休这类分次睡）写「N 段 · 相隔 X」，零间隔只报「N 段」；说明行字号 19→20rpx。
- **顺带**：段列表渲染条件从 `recordView.sessions.length` 改为 `recordView.sessionCount > 0`（值等价，少一层嵌套取值）。
- 验证：`npm test` **286 项 / 285 通过 / 1 PG skip**（新增三段分段轴与单段整条断言）；`npm run check` 通过（513.7 KB）；模拟器三段记录实测，截图 `docs/assets/l4-sleep-segments.png`，console 无 error。

## 2026-10-22 · 统计页「同步」按钮瘦身：与开关轨道同高，热区仍 76rpx

- **问题（截图反馈「按钮高度看起来有些大」）**：`.sync-btn` 用 `min-height: 80rpx` + 左右 26rpx 内边距，2 个字被撑成约 50×40px 的空心胶囊，比右侧 52rpx 高的开关轨道高出一截，视觉重心偏重。
- **修复**：视觉高度 `80 → 52rpx`（与开关轨道 88×52rpx 完全对齐），内边距 `26 → 28rpx` 让横向比例回到约 2:1 的胶囊；补 `rgba(129,140,248,.14)` 淡紫底与 `line-height: 1`；80rpx 触控热区改用 `::after` 外扩 12rpx（约 76rpx），不缩小可点范围。
- 验证：`npm test` **285 项 / 284 通过 / 1 PG skip**；`npm run check` 通过（511.5 KB）；模拟器打开设置区实测按钮与开关同高、文字居中，console 无 error（截图 `docs/assets/l4-sync-btn.png`）。

## 2026-10-22 · 统计页空态插画重做：月牙 + 3×3 网格同轴居中，亮起左上第一格

- **问题（截图反馈「像没设计好」）**：原空态把 3×3 网格缩到 20rpx、底色 `rgba(167,164,255,.06)` + 描边 `.12`，贴在月牙右下角并旋转 -6°，深底上只能看见两三个格子；亮的是**右下角第 9 格**，而文案是「长出第一格」，位置与语义相反。
- **修复**：①构图改为月牙在上、网格在下同轴居中（新增 `.es-moon-wrap`，`.empty-scene` 改 flex column），去掉旋转；②格子 20→24rpx、圆角 7→8rpx，底色 .06→.10、描边 .12→.22，9 格全部可辨；③亮起格 `index === 8` → `index === 0`（左上第一格），保留呼吸光；④柔光 160rpx 重新对准月牙中心。
- 验证：`npm test` **285 项 / 284 通过 / 1 PG skip**；`npm run check` 通过（511.2 KB）；清空存储后统计页空态实测，console 无 error（截图 `docs/assets/l4-empty-redesign.png`）。

## 2026-10-22 · 计算器结果面留白修正：分享行不再越出卡片，脚注留出呼吸距离

- **根因**：结果背面是固定 712rpx 的翻转舞台（3D 翻转不能自适应高度）。加入第 4 个「补觉」档后内容超长，`.result-share` 的 88rpx 热区溢出卡片约 37px 并压在脚注上；同时脚注 `margin-top` 只有 24rpx，视觉上两行几乎贴在一起。
- **修复**：①新增 `.calc-back.is-dense`（`!view.compact && view.rows.length >= 3` 时启用）压缩纵向节奏——行内边距 16→10rpx、主卡 22→18rpx、`result-extra / result-go / result-actions` 各收 8~12rpx，分享行回到卡片内；②脚注 `margin-top` 24→48rpx，与分享/主按钮拉开呼吸距离；③紧凑态（全部周期已过）保持原有 `.is-compact` 规则，不与 dense 叠加。
- 实测（375 基准）：分享热区底部 613px、卡片底 622px、脚注顶 646px——热区不再与脚注相交，视觉留白约 33px。
- 验证：`npm test` **285 项 / 284 通过 / 1 PG skip**；`npm run check` 通过（主包约 510.9 KB）；模拟器入睡/起床两方向与正面截图核对（`docs/assets/l4-calc-note-gap.png`、`l4-calc-note-gap-sleep.png`、`l4-calc-note-front.png`）。

## 2026-10-22 · 订阅消息后台可视化配置（模板 ID 不再依赖 .env）

- **后台新增「小程序与提醒」面板**：启用开关、订阅消息模板 ID、点击跳转路径；附「去哪里拿模板 ID」步骤（公众平台 → 功能 → 订阅消息 → 公共模板库 → 模板详情复制 43 位 ID；字段需含 `thing1`/`time2`）与一次性订阅规则说明。
- **只读运行环境**：同面板展示 AppID / AppSecret 是否已配置、`TRUST_PROXY` 层数、`DB_MODE` / 存储模式；新增 `GET /api/admin/env`（需登录），只返回布尔与枚举，不返回任何密钥值。密钥仍只存在服务器 `.env`。
- **服务端改造**：`config-schema` 增加 `reminder` 段（`enabled/templateId/page`，模板 ID 与跳转路径严格校验）；`/api/config` 下发改用「后台配置优先，env 兜底」；`/api/reminders` 与调度器从“启动时读一次闭包”改为**每轮读当前配置**——此前后台保存模板必须重启容器才生效，等于假承诺；后台关闭后已排队任务也不再推送。
- **客户端**：`fallback.reminder` 增加 `enabled`；`utils/reminder.js` 在 `enabled=false` 时直接走“加入手机日历”兜底，不再弹订阅授权。
- **兼容**：`WX_REMINDER_TEMPLATE_ID` 保留为历史部署兜底，不再要求新部署填写；`docker-compose` 与 `.env.example` 注释同步。
- 验证：`npm test` **285 项 / 284 通过 / 1 skip**（新增：模板 ID/路径非法拒绝、后台配置优先于 env、关闭后 503、环境面板不含密钥）；`npm run check` 通过（510.0 KB）；真实实例（memory 3199）登录 → 保存 → `/api/config` 下发 → `/api/admin/env` 全链路通过。操作指引见 `docs/10-operations.md` §3.2.1。

## 2026-10-22 · 计算器脚注可点：新增「为什么是 90 分钟」说明层（事实口径 + 免责）

- **入口**：脚注整行可点，追加紫色「为什么是 90 分钟？›」；打开底部说明层（复用 `styles/sheet.wxss` 的遮罩/圆角/抓手参数），打开时 `tabbar.hide()`，关闭 / 点遮罩 / onHide / onUnload 均恢复。
- **内容（已按事实校正）**：①一轮睡眠常见 70–120 分钟、平均约 90 分钟（强调是均值，不是精确值）；②8 小时 = 5.33 个周期，并明确“8 小时本身没问题”，被叫醒的昏沉感与“深睡集中在前半夜、后半夜以 REM 为主”一并说明；③5 个周期 = 7.5 小时，周期末尾醒来通常更清爽，但总时长仍以成人常见 7–9 小时为准，不必为凑周期刻意少睡；结尾「不构成医疗建议」。
- **刻意不采用**原拟稿的「8 小时大概率在第 6 个周期深睡期被暴力叫醒」「少睡半小时反而更精神」——前者与睡眠结构不符（深睡集中在前半夜），后者容易被读成“少睡更好”，违反“只陈述事实”原则。
- **护栏**：`tests/calc-copy.test.js` 锁定入口、70–120 区间、免责声明，并断言「正好是 90 分钟」「第 6 个周期的“深睡期”」不出现；`tests/index-page.test.js` 锁定打开 / 关闭 / onHide 复位。
- 验证：`npm test` **281 项 / 280 通过 / 1 PG skip**；`npm run check` 通过（主包约 509.8 KB）；模拟器实测入口、说明层、tabBar 开关均正常，console 无 error（截图 `docs/assets/l4-calc-note.png`、`l4-calc-why-sheet.png`）。

## 2026-10-22 · 计算器增加 6 个周期「充足/补觉」附加档（5 个周期仍是主推荐）

- **产品口径（ADR-027）**：结果面保留 5/4/3 三档主推荐（5 = 推荐），新增 6 个周期（9 小时）作为「充足/补觉」附加行。9 小时是成人常见区间 7–9 小时的上限，时长标签用「充足」，不与 5 个周期的「推荐」撞标签；附加档**永远不参与主推荐**，上床时刻已过时不渲染（避免推荐赶不上的选项），入睡推起床方向始终给出。
- **实现**：`plan.js` 新增 `EXTRA_CYCLES = 6`，`bedtimesForWake` / `wakeTimesForSleep` 返回值新增 `extra`（与 slots 同结构，含 passed / dayLabel / durationMin）；`index.js` 抽出 `slotRow()` 统一两个方向的行 VM，起床模式在 `!extra.passed` 时追加、入睡模式始终追加；`sleep-guide.js` 对恰好 9 小时返回 `tone:'ample' / label:'充足'`（>9 小时仍是「偏长」）。
- **视觉**：补觉行放在列表末尾，虚线分隔 + 薄荷色「补觉」标签与「充足」文字；不与「推荐」紫色并列，读起来是“想多睡一会儿”的备选。
- **验证**：`npm test` **279 项 / 278 通过 / 1 PG skip**；`npm run check` 通过（主包约 505.7 KB）；模拟器实测起床结果 23:45 主推荐 + 22:15 补觉、入睡结果 06:45 主推荐 + 08:15 补觉，console 无 error（截图 `docs/assets/l4-calc-wake-recovery.png`、`l4-calc-sleep-recovery.png`）。

## 2026-10-22 · 同步合并：erasure 分支对本地脏条目容错

- **问题**：`mergeServerRecords` 的 erasure 分支直接读 `local[day].updatedAt`。本地原始表混入 `null`/字符串（历史脏数据、外部工具写入）时抛 `TypeError`；调用处没有兜底，而脏条目会一直留在表里 → **每次同步都失败**，用户看到“备份失败”且无法自愈。
- **修复**：分支内先判 `item && typeof item === 'object'`；`doSync` 的合并调用包 `try/catch`，异常只标记 `partial`（下一轮重试），不再阻断同批其它分片。
- 新增 `tests/sync-merge.test.js` 用例（null + 字符串条目 + erasure 水位）。验证：`npm test` **276 项 / 275 通过 / 1 skip**；`npm run check` 通过（504.1 KB）。

## 2026-10-22 · 计算器入睡模式：时间轮下陈述选中时刻 · 结果头按方向换日月

- **入睡上下文**：此前入睡模式在时间轮下显示「当前 15:41」，与正在选的时间无关，用户无法确认 22:30 指今天还是明天。新增 `plan.sleepContextText`（与 `wakeTimesForSleep` 共用新抽出的 `sleepAtOf`，超 30 分钟宽限按次日），显示「今天 晚上 22:30 入睡」/「明天 早晨 08:00 入睡」，翻日行为与结果面完全同源；页面新增 `sleepContext`，在 onLoad / onShow / 时间轮改动 /「用现在的时间」/ 切模式 / 每分钟刷新时同步，同时删除只服务旧提示的 `nowText` 死状态。
- **结果图标**：结果头此前固定月牙。现在随计算方向切换：入睡点（起床模式结果）用月牙，起床时间（入睡模式结果）用太阳；`.result-moon` 拆为 `.result-ico.is-moon` / `.result-ico.is-sun`，太阳沿用卡顶胶囊「实心核 + 8 光点」画法（不用 emoji，避免机型字形漂移）。
- **护栏**：`tests/plan.test.js` 新增入睡上下文/宽限边界/与 `wakeTimesForSleep` 同口径 2 条；`tests/index-page.test.js` 新增页面级 1 条；`tests/calc-copy.test.js` 新增提示绑定与图标契约 1 条。
- 验证：`npm test` **275 项 / 274 通过 / 1 PG skip**；`npm run check` 通过（主包约 503.7 KB）；模拟器实测选 22:30 显示「今天 晚上 22:30 入睡」、入睡结果 `is-sun`、起床结果 `is-moon`，console 无 error（截图 `docs/assets/l4-calc-sleep.png`、`l4-calc-sleep-result.png`）。
- **踩坑记录**：改 `utils/*.js` 后仅 `simulator_refresh` 可能仍加载旧模块（页面已新、依赖模块仍旧，表现为 `P.xxx is not a function` 并静默吃掉 onLoad）。需先 `debug_clear_cache --action cleanCompileCache` 再 refresh；不是产品缺陷。

## 2026-10-22 · 计算器口径修正：Hero 标题改为「你要选的时间」，与卡顶胶囊同侧

- **问题**：Hero 标题描述的是**结果**（起床模式问「想几点入睡？」，胶囊却写「选择起床时间」），输入与提问反向配对——用户按标题理解去选入睡时间，得到的会是反的方向；「想几点入睡？」+「选择起床时间」+「计算我的睡点」三处分别指向两个方向。
- **修正**：标题与胶囊统一到**输入侧**，副标与 CTA 指向**输出侧**——起床模式「想几点起？」/「选一个起床时间，找到适合你的睡点。」/「计算我的睡点」；入睡模式「想几点睡？」/「选一个入睡时间，找到适合你的起床时间。」/「计算我的起床时间」。结果面切换文案「换成我想几点醒」→「换成我想几点起」，与新标题同词。
- **不变**：算法与分支完全未动（`utils/plan.js` 的 `bedtimesForWake` / `wakeTimesForSleep`），结果标签「推荐入睡时间 / 推荐起床时间」、5/4/3 档周期、锚点语义、「现在睡」兜底均保持原样；两个方向仍不写「今晚/明早」。
- **同步**：落地页手机演示 app-head「想几点入睡？/设定起床点，算出最佳上床时刻」→「想几点起？/设定起床点，倒推你的入睡点」；分享兜底标题改为模式中立的「按 90 分钟睡眠周期，算出你的入睡点」（转发/朋友圈一致）。
- **护栏**：新增 `tests/calc-copy.test.js`（5 条）锁定标题/副标/胶囊/CTA/结果切换五处同侧，并断言旧文案零残留；改回反向配对会红。
- 验证：`npm test` **271 项 / 270 通过 / 1 PG skip / 0 失败**；`npm run check` 通过（主包约 501.4 KB）；模拟器 390×844 实测——起床模式四文案 + 结果「推荐入睡时间」、入睡模式四文案 + 结果「推荐起床时间」、结果面双向切换文案同步，console 无 error（截图 `docs/assets/l4-calc-wake.png`、`l4-calc-sleep.png`）。

## 2026-10-22 · 文案中性化：睡眠提示不再预设夜间

- **原则**：描述**睡眠事件本身**（入睡/起床/这一段）的文案一律中性，不写「今晚/明早/夜色/晚安/昨晚/早睡」——白天补觉、午休、跨时区使用时同样成立；只有描述**此刻**的问候（早安/页脚）按设备本地时区时段切换（新增 `format.daypartOf`：morning 5–11 / day 11–18 / evening 18–23 / late 23–5）。
- **入睡页**：sleeping 标题「夜色正浓」→「这一觉开始了」，副标「明早醒来…」→「醒来后记得回来记录起床。」；done 标题非早晨时段「今晚的记录完成了」→「这一觉记下了」，副标「…已经记下」→「…都已保存」；页脚深夜「晚安，明天见。」→「夜深了，明天见。」（深夜刚醒不再出现“晚安”）、sleeping「夜色正安」→「放轻松，慢慢睡。」、idle「愿今夜好眠」→「愿这一觉安稳」；orb「今晚」→「等待入睡」；eyebrow「TONIGHT」→「SLEEP LOG」；熄灯层「晚安」→「已入睡」；分享「分享今晚的睡眠」→「分享这一段睡眠」，转发标题「我昨晚 X 睡…一起早睡」→「我 X 入睡、X 起床，一起好好睡」。
- **计算器页**：hero「今晚，几点睡？」→「想几点入睡？」（与「想几点起？」对称），分享标题同步。
- **环境音解锁文案**（fallback/种子配置/config-schema/H5 demo）：「解锁今晚的环境声音」→「解锁环境声音」；`AUTO_UNLOCK_DESC` 模板兼容历史两种旧形态（带/不带「今晚的」、带/不带空格），读取路径自动把旧默认文案迁移到新口径并跟随 ttlHours，运营自定义文案不动。
- **落地页**：hero「今晚，几点睡？」→「想几点入睡？」、「今晚推荐」→「推荐入睡」、「今晚的上床时刻」→「推荐的上床时刻」、「今晚就试试」→「现在就试试」；demo 打卡 toast「晚安」→「已记录入睡」。
- 验证：`npm test` 264 项 / 263 通过 / 1 PG skip（新增 `daypartOf` 边界 9 断言、入睡页三态文案中性 2 条、服务端旧文案迁移 1 条）；`npm run check` 通过。模拟器 390×844 实测：idle「等待入睡/SLEEP LOG/记录入睡这一刻…」、熄灯层「已入睡」、sleeping「这一觉开始了/醒来后记得回来记录起床。」，console 无 error。

## 2026-10-22 · L4 阶段 C：部署护栏 · openid 限流 · 固定 +8 归档 · 音频错误可观测

> 定位：发版前的工程护栏与跨时区正确性。C4（换号归属）/C5（音频签名）/C6（订阅召回）需要产品与运营输入，未在本轮改动。

- **生产 TRUST_PROXY 强校验（C1）**：此前只在生产 `console.warn`。现在**显式未设置即拒绝启动**（`TRUST_PROXY` 缺省会让 `req.ip` 恒为代理地址，全站共用 120/min 的 sync 桶）；显式 `TRUST_PROXY=0` 表示确认直连，允许启动并保留告警。`docker-compose.yml` 的 api 环境补 `TRUST_PROXY: ${TRUST_PROXY:-1}`，已有 1Panel 部署升级后不会被挡在启动前；`docs/10` 的 `.env` 模板本就有 `TRUST_PROXY=1`。
- **/records/sync 增加 openid 维度限流（C1）**：IP 桶 120/min 之外，按 openid 30/min（400 天用户一次完整同步 7 片，余量充足）。顺序在 `codeToOpenid` 之后、写库之前；坏请求只消耗 IP 桶。
- **归档日固定北京时间（C2）**：新增 `time.calendarDayKey(ts)`（固定 +8，与服务端 `calendarDayOf` 同源）。`sessions.sessionDay`、`sync` 合并的 `localDay`、`sleepDayOf`（v1 入睡日）、容量预检的 dayKey、补记/结束面板的日期文案与编辑校验全部改用它。修的是：设备出境/改时区后本地 `dateKey` 与云端 day 分叉，同一段睡眠被算成两天，同步时互相写墓碑并回填。`dateKey` 仍跟随设备本地时区，只用于“今天/昨天”等 UI 文案（时间显示本来就是本地时间）。
- **音频错误可观测（C3）**：`audio_error` 加入服务端事件白名单；`audio-dock` / `now-playing` 的 `onError` 上报 `target = trackId|errCode`（1s 内去重）。此前 errCode 被直接丢弃，线上无法区分网络/解码/坏缓存。
- 验证：`npm test` **260 项 / 259 通过 / 1 skip**（新增：TRUST_PROXY 三态、sync 第 31 次 429、calendarDayKey 固定 +8、sessionDay 跨时区、audio_error 白名单）；`npm run check` 通过（主包约 498.4 KB）；模拟器三页无回归、console 无 error。

## 2026-10-22 · L4 视觉批次：主按钮/弹层单一来源 · 底部安全区 · 空态去星点 · 年视图可读性

> 定位：上一轮刻意延后的观感统一。原则是“参数单源、视觉可验收”，不做结构重写。

- **主按钮一套化**：`app.wxss` 新增 `--btn-primary-bg`（亮紫渐变）/ `--btn-primary-fg`（深字 `#141B45`）/ `--btn-primary-shadow`；计算器 `.calc-action`、入睡页 `.cta-mini.is-primary`、结束/补记面板 `.end-btn.primary`、解锁面板 `.sheet-primary` 四处统一引用。此前是 3 套紫 + 2 种文字明暗逻辑（解锁面板还暗一档）。
- **底部弹层参数统一**：圆角 36rpx、底色 `rgba(16,22,40,0.98)`、抓手 64×5rpx、遮罩 `rgba(4,7,15,0.62)` + `blur(8rpx)`。`styles/sheet.wxss`（结束/补记）、`unlock-sheet`、`background-picker` 三处对齐；因小程序组件样式默认隔离，跨组件不复用类名，改为统一参数并在三处注释互相指向（避免下一次再漂移）。
- **底部安全区**：`.page` 的 `200rpx` 与入睡页 `190rpx` 改为 `calc(... + env(safe-area-inset-bottom))`。修 iPhone 14 上内容底边与 tabBar 只剩约 7rpx 的挤压（统计页此前已是 180rpx + safe）。
- **空态去星点**：删除 `empty-state` 的四颗装饰星（wxml 4 个节点 + wxss 5 条规则）。全局视觉基线是“深空 + 呼吸月晕、无星点”，空态是全页最亮区域，装饰星会分散月牙焦点。
- **年视图可读性**：`calendar-strip` 的 `.cs-cell` 14→16rpx、`.cs-week-cell` 12→14rpx（40rpx 格内仍能放下两位日号）。
- **刻意不做**：三页主标题 72 / 72 / 56 维持现状。计算器与入睡页是 Hero 标题（72rpx），统计页是页面标题（56rpx），属层级差异而非缺陷；统一会挤压统计首屏的 3 列指标，收益低于代价。
- 验证：`npm test` **254 项 / 253 通过 / 1 skip**；`npm run check` 通过（主包约 496.1 KB）；模拟器截图——首页主按钮、背景选择器（36rpx/深底/blur 遮罩/抓手）、补记面板（深字主按钮）、解锁面板（`观看视频` 深字主按钮）、统计空态无星点（`docs/assets/l4-v-*.png`）；console 无 error。

## 2026-10-22 · 口径确认落地：醒来日 / 1 分钟精度 / 旧对象回收 / 时间校验提示

- **记录口径（确认）**：一律按“醒来日”。已全链路核对：`storage.saveSession` 用 `sessions.sessionDay`（醒来日）；入睡页 `todayKey = dateKey(now)`、统计页 `partialDay = dateKey(now)`、热力图/日历格均为日历日；`sleepDayOf` 只保留给兼容旧 `bed-v1` 记录（`sync.js`）。服务端 V2 记录由 `calendarDayOf(primary.endAt)` 重算 day，不信任客户端日期。
- **时间轮（确认）**：保留 1 分钟精度。核对实现后无需改：144 行只渲染一次，滚动时仅对可视窗口 ±3 行重算 `transform/opacity`（`buildDrumPatch` 路径式 setData），不存在全量节点重排。
- **COS 旧对象回收（新）**：新增 `server/src/lib/cos-keys.js`（纯函数：URL→Key 反推 + 差异计划）与 `cos.deleteObject`；保存配置成功后异步删除「上一版引用、新版不再引用」的自家对象。安全边界：只允许删 `backgrounds/`、`site/` 两个白名单目录；域名/桶地址必须匹配当前存储配置；音频不参与（可能共用或来自历史 CDN）；上传后未点保存不会删除，避免线上 404；删除失败只记日志不回滚保存。
- **时间/时区校验（新）**：墓碑日期增加“不得晚于北京时间明天”的上限（`validate.js`，保留 1 天时区容差，UTC+14 客户端不会误伤）；客户端同步前先过滤未来墓碑并提示“删除日期异常（请检查手机时间），已跳过”；同步被云端拒收时的 toast 与统计页状态行改为说明具体原因“时间重叠或超出范围”（重叠/越界本来就会被服务端拒绝，这次把原因说清楚）。
- **验证**：相关子集 77/77（cos-keys 2 组、validate 3 组、config、admin 审计、plan 进度时钟、config-inflight、stats、manual-sleep）；`npm run check` 通过。全量 `npm test` 唯一失败来自另一路并发改动的统计文案断言（实现 `stats.js:314` 为“与上周同期持平”，`tests/stats-calendar.test.js:145` 仍断言“与上周持平”），与本轮无关，未擅自改他人口径。

## 2026-10-22 · L4 阶段 A/B：容量预检 · 脏记录兜底 · 墓碑时钟 · 缓存替换 · 同期对比 · 背景确认 · 停靠 · 可读性

> 定位：发版前的正确性与体验收敛（P2 中的高价值项）。视觉大改（主按钮/弹层三件套、三页标题音量）仍需逐项截图验收，未纳入本批。

- **结束/补记容量预检（A）**：新增 `manual-sleep.capacityErrorOf`——按「当天段数 ≤8 / 当天总时长 ≤24h」在保存前给可行动错误（编辑先扣掉旧段）；`evaluateManualRange` 与入睡页 `computeEndSheet` 共用。此前 `storage.saveSession` 对超限静默返回 false，结束面板只能弹「记录未完整写入，请重试一次」，用户无任何出口。同时在有错误时清空 `_endBedAt/_endWakeAt`，避免某条路径只看 `endError` 被清后误落库。
- **空 `sessions` 脏记录兜底（A）**：`sessionsOf` 在 `sessions: []` 或全部非法段时回退 `bedAt/wakeAt` 合成 v1 段；`buildRecordView` 无可用段返回 null，`refreshAll` 给「这条记录缺少可用的睡眠段，可撤销后重新记录」。此前完成态直接取 `sessions[0].startAt` 抛 TypeError，入睡页会整页无法渲染（同步合并/历史脏数据可达）。
- **墓碑时间防回灌（A）**：`storage.tombstoneTime(record)` = `max(now, record.updatedAt+1)`，用于 `removeRecord`、`updateSession` 迁日、`saveSession` 合并 v1 三处。云端删除条件是 `updated_at <= deleted_at`，跨设备删除或本机时钟偏慢时旧实现会删不掉，下次同步把「已删除」的记录回填并清掉本地墓碑。
- **音频缓存原子替换（A）**：`audio-cache.download` 在 rename 无法覆盖时不再 `unlink(dest)`，改为把 dest 改名备份 → 换入新文件 → 删备份；换入失败还原备份。避免 TTL 重下/预热撞上正在播放的文件时，把 BackgroundAudioManager 正在读的源删掉（表现为 seek/循环重开失败 + 一次静音跳变）。
- **「比上周」改同期（B）**：`weekly` 的上一周只取与本周已过天数相同的一段（周一 1 天比 1 天），文案统一「比上周同期…」/「与上周同期持平」/「上周同期没有记录」。原实现注释写「避免周一拿 1 天比 7 天」，但代码实际是部分周对完整周。
- **背景切换确认（B）**：`onBgSelect` 统一为——只要当前有一张有效付费背景且目标不同（默认图 / 另一张付费图都算），先弹「当前付费背景还剩约 X 小时，切换后会结束本次解锁」；确认后才应用或进入解锁流程。原实现只在切回默认图时提示，A→B 会静默作废 A 的剩余时长。
- **日历停靠（B）**：`calendar-strip` 的去重键由「最后一个月 key」改为「月份数 + 首月 + 末月」，3/6/12 切换后重新 `scrollTarget`，切到 1 年不再停在最旧的月份。
- **可读性（B）**：四处关键提示去掉外层 opacity、字号提到 20rpx——熄灯「轻触任意处唤醒」（原 17rpx/0.42，约 2.4:1）、月历「补记」（原 15rpx/0.62）、日历图例（原 18rpx + 整块 0.6）、「时间不准可修正」（原 17rpx/0.3）。
- **audio-dock 样式单源（B）**：`.dock-mini` / `.dock-fab` 此前各定义两次，前段的定位/尺寸/底色被文件末尾覆盖。现前段只保留动画与布局（display/flex/transition），定位与玻璃底只由末尾覆盖块提供；顺带消掉全项目唯一裸 `z-index: 40`。
- 验证：`npm test` **254 项 / 253 通过 / 1 skip**；`npm run check` 通过（主包约 495.6 KB）；模拟器实测——统计页指标副标「与上周同期持平」、月历「补记」与图例可读、12 个月视图停在 2026-10（`docs/assets/l4-b-calendar-12m.png`）、入睡页 C 态提示可读且音符位置正确（`docs/assets/l4-b-sleep-done.png`）；注入 `sessions: []` 脏记录后正常回退渲染，注入无可用段记录后 `recordView=null` + 可行动提示、页面不崩；console 无 error。

## 2026-10-22 · L4 Code Review：P1 七项修复（切月死锁 / 熄灯闭环 / 编辑区间 / 补记进行中 / 跨日文案 / 清除提醒 / 音频归属）

> 起因：六域子代理全量审查 + 主代理逐条复核，确认 7 条 P1（无 P0）。本轮只修 P1，P2/视觉收敛留待下一阶段。

- **统计页切月死锁（P1）**：`refresh()` 的签名数组补 `monthOffset` 与 `calendar.monthKey`。此前签名只含色阶序列，空月之间（如 2026-09 与 2026-10 都是 35 格全 `'0'`）完全相同 → 按 `‹` 后 `setData` 整块被跳过：标题/格子/`canNextMonth` 全不更新，而 `monthOffset` 已变 → 既看不到历史月、也回不去。新增 `tests/stats-page.test.js` 页面级用例（切 9 月 → 标题变化、`canNextMonth=true`、切回 10 月）。
- **熄灯两处闭环断裂（P1）**：①`openEndSheet` 的「刚睡下，再等等」早退分支此前只 toast + return，熄灯定时器已被清掉且不重排 → 页面一直亮到下次触碰；补 `scheduleLightsOut()`。②`enterLightsOut` 因声音抽屉打开而跳过时，定时器已在回调里置空；`closeSheet()` 新增 `triggerEvent('sheetclose')`，入睡页 `onDockSheetClose` 在睡梦中且无面板时重排 30s 倒计时。`tests/sleep-page.test.js` 新增 2 条。
- **编辑面板区间语义（P1）**：编辑既有段没有日期选择器，`rangeForDay` 的「入睡 ≥ 起床 → 回退一天」会把一段午休（13:00–13:30）的入睡改成 14:00 时静默存成 23.5h 跨天段。现在 `endMode==='edit'` 且 `bedMinutes >= wakeMinutes` 直接给出 `order` 文案（「入睡时间需早于起床时间」），并清空 `_endBedAt/_endWakeAt` 防止旧值落库。新增页面级用例。
- **补记与进行中睡眠互斥（P1）**：`manual-sleep.evaluateManualRange` 新增 `pending` 参数，把进行中的一段按「打卡时刻 → 现在」折算后与补记区间比对，命中给专用文案「与你正在进行的睡眠重叠，请先结束计时或调整时间」；统计页补记传 `storage.getPending()`。此前补记能保存成功，之后结束计时反被这段补记挡住（互为死结）。新增 3 条纯函数用例（相交/不相交/脏数据）。
- **计算器结果面跨日（P1）**：`onFallAsleepTap` / `cycleFall` 不再清零 `_anchorAt`。此前结果面停留跨过 30 分钟宽限后点「N 分钟入睡 ⇄」，锚点重置会让整组推荐静默推后一天，而界面上只有「早晨 06:45」这类时段词。同时主推荐与 `late` 分支补日期前缀（`P.dayLabel`），凌晨场景渲染为「明天 早晨 08:45」+「明天 01:00 上床；…」。新增 `tests/index-page.test.js` 2 条（锚点不清零 / 跨日文案）。
- **「清除全部数据」漏删订阅提醒（P1，服务端）**：`db.eraseUserData` / `eraseCloudData`（memory 与 PG 各两处）补删 `sleep_reminders` 并返回 `reminders` 计数。此前清除后云端提醒行仍在，到点仍会推送，且 `openid/session_id` 明文留存至 7 天清理。`server/test/reminders.test.js` 新增 2 条（全量清除 / 只删云端，均断言 `dueReminders` 为空）。
- **音频 onError 归属校验（P1）**：`player-state.isCurrentSourceError(eventSrc, expectedSrc)` 新增；`audio-dock` 与 `now-playing` 的每次赋 src 收敛到 `setAudioSrc()` 并记录 `_expectSrc`，error 首行比对播放器真实 src，已切走的旧源错误直接忽略。缓存失效改为 `cache.isUsable(url)` 先判磁盘：文件正常时只做本会话黑名单（`_badUrls`）不删文件，用户主动重播时清黑名单——避免切歌竞态误删新曲缓存。新增 `isUsable` 与 `isCurrentSourceError` 单测各 1 条。**已知限制**：BAM 的 onError 不带 src，此判据无法覆盖「新旧 src 已同步后旧源错误才到达」的极端竞态，已在文档标注。
- 验证：`npm test` **239 项 / 238 通过 / 1 skip**；`npm run check` 通过（主包约 488.4 KB）；模拟器实测——统计页空月 `‹` 切到「2026年9月」且 `canNextMonth=true`（截图 `docs/assets/l4-p1-stats-prev-month.png`）、计算器凌晨 2 点选 01:00 渲染「明天 早晨 08:45」+ 日期 note（`docs/assets/l4-p1-result-tomorrow.png`）、入睡页打卡→唤醒→60s 内点圆环（早退不开面板）→ 32s 后自动回熄灯；console 无 error。

## 2026-10-22 · code review 逐项核实与修复（配置/审计/广告/反馈）

- **配置**：`config/index.js` 的 `app` 补 `site` 透传——此前文件配置里的 `site` 段会被 `normalizeConfig` 静默丢弃，空库首次部署时落地页拿不到二维码；`unlockDesc` 命中自动模板正则则随 `ttlHours` 重新生成（改时长后不再残留“24 小时”）。
- **审计**：`db.readAdminAudit`（memory/PG）+ `GET /api/admin/audit?limit=`；后台新增「操作日志」面板（空态/失败可见）；音频、背景图、小程序码三个上传端点补 `logAdminAction`（限流 `gateUpload` 核查后本已存在，未改）。
- **广告解锁**：`ad.show()` 在已有广告在播时返回 `'busy'` 而非 `'error'`，背景解锁与环境音解锁都不再把“忙”当作加载失败放行（此前可绕过观看直接解锁）；`showBackgroundAd` 入口补 `bgBusy` 守卫。
- **结果面**：`plan.bedtimesForWake` 增加独立进度时钟，结果页每分钟重算“还能睡多久/哪些档位已错过”，推荐时间仍锚定计算时刻不漂移。
- **反馈补齐**：同步本机落盘失败（`writeFailed`）与声音抽屉打开失败都会提示；音频失败改为按 track 记录并支持再点重试（不再一条失败全部永久降级），文案去掉“防盗链”确定归因。
- **站点/后台**：`site.css` 补全局 `[hidden]`（`.qr-empty` 空态不再依赖 overflow 裁切）；落地页空态文案改为“微信扫一扫 打开「睡点」”；后台 Logo 换成与落地页一致的圆+月牙；H5 演示补 30 分钟档、解锁确认/取消按钮读取后台文案、移除 `/admin` 入口与 COS 运维说明、已完成打卡点大钮给 toast；`llms.txt` 入睡耗时档位修正为 5/10/15/20/30，`sitemap.xml` 补 `lastmod`。
- **可读性/可达性**：`--dim` 提到 `#7C8BA1`、placeholder 提到 `#64748B`；站端/后台补 `:focus-visible`；自定义 tabBar 补 `hover-class` 按压态；空态按钮、热力图格子、解锁抽屉按钮、背景选择关闭钮补 `aria-role/aria-label`；入睡耗时档位触控高度扩到 88rpx；background-picker 删除被 flex 覆盖的死 `height:52vh`。
- **核实后判定“不属实/已修复”**：`--color-primary-soft` 已在 app.wxss 定义；熄灯遮罩进入时 `tabbar.hide()` 已调用；超 24h pending 不再静默清除（提示+手动校准）；上传限流已存在；tabBar/now-playing 已有 aria；sleep-guide 文案已按周期动态生成；热力图“今天”按醒来日口径正确（记录按 `sessionDay` 归档）；备案号已换成真实号；audio-dock 的 `.dock-fab/.dock-mini` 两段规则是叠加（前段提供定位/flex），不是死代码。
- **验证**：`npm test` 227 pass / 0 fail（+1 PG skip，新增审计闭环、site 透传、进度时钟 3 组用例）；`npm run check` 通过；四个 CSS 文件花括号配平；浏览器实测——后台 Logo 为圆+月牙、操作日志能显示“保存配置 · 版本 v4 · 环境音 1 条”、落地页空态 `img` 为 `display:none` 且文案正确、演示页无 `/admin` 入口且五个耗时档齐全。

## 2026-10-22 · L4 评审整改：补记编排单源 · 事件白名单 · 弹层样式共享

> 起因：代码评审指出统计页补记与入睡页「补记一段睡眠」是两套复制实现（约 130 行 JS + 53 行 WXML + 180 行 WXSS 近同构）。

- **抽出共享编排模块 `miniprogram/utils/manual-sleep.js`**（纯函数，不读写 storage）：
  - `defaultTimesFor(dayKey, now, { preset })`：预设=整夜 23:00→07:00（当天 07:00 未到才下压到 now-10min，至少 1 分钟）；`preset:false`=30 分钟前→现在（入睡页「补记入睡」语义）；
  - `errorTextOf(code)`：future/short/order/long + overlap 五类文案唯一出口；
  - `evaluateManualRange({records, dayTs, bedMinutes, wakeMinutes, now})`：`rangeForDay` + 跨天 `findOverlap` + 文案；
  - `buildSaveArgs(bedAt, wakeAt, now)`：`saveSession` 入参（source=manual、id 带时间戳）；
  - `minDayKey(now)` + `EDIT_WINDOW_DAYS=400`：可补记下限对齐**云同步窗口**（`utils/sync.js` 的 `SPAN_DAYS`，服务端同界）——同步只上传最近 400 天，窗口外的补记会变成"只存本机、永远不上云、换机即丢"的静默丢失；新增 `limitCanAdd(cells, minDay)` 把日历空格的补记入口按窗口收口（日历仍可翻 24 个月看历史，窗口外空格点击给说明「超出可补记范围」）。改动任一侧必须同步另一侧，`sync-chunk.test.js` 有跨模块一致性守卫。
  - 两页改为调用：入睡页 `openManualSheet` 默认值、`computeEndSheet` 错误文案、`saveManualSession` 入参；统计页同。新增 `tests/manual-sleep.test.js` 9 条（默认值三态/跨午夜/五类文案/区间与重叠/入参/回溯范围）。
- **修复既有埋点缺陷（P1）**：`manual_sleep` 不在服务端事件白名单 `TYPES`，入睡页每次补记都会让整批事件被 400 拒绝、客户端按永久脏数据**整批丢弃**（含同批 app_open/checkin）。已加入白名单并在 `server/test/admin.test.js` 锁定可接受；统计页补记也补上 `events.track('manual_sleep')`，两页口径一致。
- **弹层样式单源**：新增 `miniprogram/styles/sheet.wxss`（`.end-*` 全套），入睡页与统计页 `@import` 引入并删除各自副本（净减约 260 行重复样式）；统计页面板类名由 `manual-*` 统一为 `end-*`。
- **交互加固**：两个面板遮罩与面板本体加 `catchtouchmove="noop"`（阻止穿透滚动）；面板 `aria-role="dialog"` + 关闭按钮 `aria-role="button"` + 文案标签。
- **口径记录**：统计页允许在「正在入睡中」补记历史日（数据模型支持多段，历史段与进行中会话不冲突）；入睡页仍只在 idle/done 提供入口——属刻意差异，不是缺口。
- 验证：`npm test` **218 项 / 217 通过 / 1 PG skip**；`npm run check` 通过（3 页面 / 23 JSON / 18 WXML / **20 WXSS**，主包约 477.1 KB）；CLI 模拟器回归——统计页点空格弹面板→保存落库（10-16 480 分钟 source=manual）→格子变色/本月 +1；入睡页「补记入睡」（03:41→04:11 30 分钟）→保存后 C 态；2 小时 pending 结束面板正常打开且重叠校验走共享文案；console 无 error。

## 2026-10-22 · 计算器页 Hero 文案随计算方向切换 +「换背景」移入顶栏右侧

- **Hero 文案跟随模式**：标题/副标改为 `mode` 三元——「选择起床时间」问「今晚，几点睡？」；切到「选择入睡时间」改为「想几点起？」/「选一个时间，找到你的起床时间。」。原实现是静态文案，切模式后仍在问“几点睡”，与实际计算方向相反。
- **刻意不写「明早」**：白天小睡（如 14:00 选 14:00 入睡，结果落在当天下午）时「明早，几点起？」属错误陈述，与「只陈述事实」的产品原则冲突；「想几点起？」任何时刻成立，且不需要按小时切换文案的条件逻辑。
- **「换背景」归位顶栏右侧**：`components/top-bar` 新增可选 `actionText` 属性 + `action` 事件（沿用项目 `triggerEvent` 约定，未用 slot），按钮贴微信胶囊安全距离（复用组件已测量的 `capsuleGap`）右对齐；页面级工具动作回到导航栏，同时解除 Hero 大标题 `padding-right: 148rpx` 的让位，标题恢复满宽。未传 `actionText` 的入睡/统计页零渲染、零交互变化。
- **删除死代码**：`index.wxss` 的 `.hero-tools` / `.hero-bg-btn` / `::after` / `:active` / `.hero-bg-arrow`（−43 行）；360px 断点内的 `padding-right: 132rpx` 同步删除。
- 验证：`npm run check` 通过（3 页面 / 23 JSON / 18 WXML / 20 WXSS，主包约 478.5 KB）；`npm test` 224 项 / 223 通过 / 1 PG skip；CLI 模拟器 390×844 实测——两模式文案与顶栏按钮、**真实坐标点击命中**（`app.globalData` 存活标记确认本轮无重编译：标记存活 + 路由不变 + `bgOpen: true`）、统计页顶栏无动作按钮、console 无 error。**待真机**：胶囊安全距离的贴合度（DevTools 与真机胶囊位置可能不同）。
- **工具事实（便于复用）**：wechatide CLI 的 `automation_element_action --x/--y` 是视口 CSS 像素、顶左原点；若点击后路由莫名漂移，先排查是否因并发保存触发重编译导致页面恢复（用 `getApp().globalData` 存活标记区分）；自定义组件内部节点无法被 automator 选择器命中，需 `selectComponent + SelectorQuery.in()` 量出 `boundingClientRect` 再坐标点击。

## 2026-10-22 · 睡前熄灯（打卡即关灯 · 点触唤醒 · 30s 回熄灯）

- **打卡即熄灯**：点「入睡」后不再只闪 1.6s「晚安」再回到全亮页面，改为进入**持久熄灯**——全屏毛玻璃压暗整页（`rgba(4,7,15,0.84)` + `backdrop-filter: blur(20rpx)`；不支持的机型靠 0.84 深底自然退回“接近关灯”，不会出现半透明花屏），只留熄灭态的入睡时间（`filter: brightness(0.84)`）+ 顶部「晚安」+ 底部「轻触任意处唤醒」。
- **tabBar 同步隐藏**：自定义 tabBar 在独立 root，页面 `z-index` 压不住（项目已知层级事实），熄灯时调 `utils/tabbar.hide()`、唤醒时 `show()`，否则底部会亮着两个 tab 图标破坏关灯。
- **熄灯态 orb 不可点**：任意点触都是“唤醒”，唤醒后再点圆环才进结束面板。理由：躺床误触结束计时会截断入睡时长，代价远高于多点一次。
- **30s 回熄灯**：唤醒后 30s 无操作自动回熄灯（`LIGHTS_OUT_DELAY`），页面根 `bindtouchstart` 任意触摸重置倒计时；`onShow` 若仍熄着则保持（切走再回来不突然变亮）。
- **不熄灯的场合**：结束/补记面板打开时、声音抽屉打开时（`selectComponent('#dock').data.open`）、done/idle 态、页面 onHide；保存或取消面板后恢复倒计时。熄灯层 `catchtouchmove` 阻止滚动。
- 验证：`npm test` 224 项 / 223 通过 / 1 PG skip（新增熄灯 7 条：打卡即熄灯/仅睡梦中熄/面板打开不排定/到点熄灯与唤醒重排/页面触摸与完成后自动亮/抽屉打开不遮）；`npm run check` 通过（主包约 478.4 KB）。**模拟器实测**（390×844）：打卡即熄灯（毛玻璃 + tabBar 隐藏）、点任意处唤醒（恢复全亮与 tabBar、仍睡梦中）、34s 后自动回熄灯且「已睡」随时钟更新；console 无 error/warn；截图 `docs/assets/sleep-lights-out.png`。真机仅剩毛玻璃观感与 Android 降级确认。

## 2026-10-22 · 统计页三轮：日历格尺寸与页内补记

- **日历格改扁格、行列间距不对称**：7 列 × 5 行用 92×76rpx 扁格，列间距 4rpx（收密）、行间距 16rpx（放大）；7×92+6×4=668rpx 仍近满宽（左右各约 9rpx）。星期行列宽同步，保持列对齐。
- **空格恢复「补记」文字**（15rpx / opacity 0.62），替代上一轮的极淡＋。
- **点空格直接在统计页弹补记面板**（不再跳入睡页、不再落到日历下方详情卡）：面板与入睡页「补记入睡」同口径——醒来日（可选最近 400 天、不晚于今天）+ 入睡/起床时间 + 「归入 X（醒来日）· 时长」预览 + 取消/保存补记；校验复用 `sessions.rangeForDay` 与跨天 `findOverlap`（future/short/order/long + 重叠五类错误同文案）；打开时 `tabbar.hide()`、取消/保存/切页（onHide）恢复；保存走 `storage.saveSession({source:'manual'})`，成功后 `_signature` 置空刷新 + toast「已补记 X月X日」+ `syncNow` 云端反馈（跳过/拒收/网络失败分提示）。
- **点格分流**：无记录的过去日 → 弹补记面板；有记录 / 进行中 / 未来日 → 详情卡（选中描边由页面受控）。详情卡内的「补记这一天的睡眠」按钮与 `onAddMissing`（写 meta.manualDay + switchTab）整体删除；入睡页的 `openPendingManual` 保留（兼容任何遗留 meta.manualDay）。
- 测试：`tests/manual-day.test.js` 按新交互重写——新增「点空格弹面板不写 meta 不跳页」「保存直接落 v2 session」「有记录日走详情卡」3 条；旧链路 3 条保留。`npm test` 209 项 / 208 通过 / 1 PG skip；`npm run check` 通过（473.5KB）。
- 模拟器实测：格尺寸/补记文字、点 10月1日空格弹面板（tabBar 隐藏、时长 8 小时 00 分预览）、保存后格变 8.0h 且本月已记录 +1、点 10月20日有记录格出详情卡、console 无 error。

## 2026-10-22 · 曲末无缝回环：修复微信悬浮音符在每曲播完后消失

- **现象**（真机反馈）：锁屏/切桌面后音乐可后台循环，但每一曲播完的瞬间，微信自带的左侧悬浮音符消失且不再出现；小程序内的播放状态正常。
- **根因**：该浮窗跟随「同一次音频会话」；原实现在 `onEnded` 重设 `src` 续播，被微信视为新音频——浮窗在 ended 时被收掉，程序化续播不会让它回来（只有用户主动起播才会再次出现）。
- **修法**：`utils/player-state.js` 新增 `seamlessLoop(audio)` + `claimLoop()`：在 `onTimeUpdate` 检测「距结尾 ≤2 秒」时 `seek(0)`，同一会话永不进入 ended、不换 `src`；1.2s 去重避免 dock/now-playing 双 seek。`onEnded → replay` 保留为兜底（后台节流错过窗口时仍能续播，该轮浮窗会掉）。
- **不改的边界**：暂停仍只 `pause()` 不 `stop()`；定时到点、解锁到期、点微信浮窗 X 的现有行为不变（X 之后小程序内保留「已暂停」条，经运营确认接受——点击即用户主动起播，浮窗会重新出现）。
- 验证：`node --test tests/player-state.test.js` 8/8（新增 3 组：窗口边界/跨组件去重/暂停与非法时长）；`npm test` 205 通过 / 0 失败 / 1 PG skip；`node tools/check.mjs` 通过（主包约 463.0 KB）；改动文件 lint 0 错误。**未真机复验**：连续多轮回环后浮窗是否常驻、回环点听感、低端机 `onTimeUpdate` 节流时退回 ended 的表现。

## 2026-10-22 · 统计页视觉二轮收敛（真机截图反馈）

- **指标区去底去框**：运营判定"背景框"与全局"层级只用字号/颜色/留白"原则冲突，`.metrics` 的淡容器卡（0.035 底 + 描边）整体移除，恢复裸排三列。
- **周打卡行删除**：「本周打卡 N 天 · 连续 N 天」从统计页移除（连续/周计数在入睡页统计行与分享文案仍可用，`weekCount/streak` 数据与 `onShareAppMessage` 不变）；原右侧引导改为整行居中弱色「点上方↑数字看说明」（19rpx、muted、opacity 0.75；指标展开后隐藏）。
- **日历呼吸距**：星期行与格间距 6→18rpx；格宽按内容宽 686rpx 铺满 = 88.5rpx（7×88.5+6×8=667.5rpx，左右各让约 9rpx，回到 PRD 原始 88rpx 规格附近；星期行与网格两处列宽同步改保持列对齐）。**过程记录**：先按"左右大留边"改到 68rpx（左右 ~50rpx），运营澄清"小格子近满宽、只让 8–10rpx"后回调——"留呼吸距离"指边距不要贴页边，不是收窄网格。
- **图例清理**：删「颜色越亮 = 睡得越久」说明句（重复显而易见的读色规则）与「仅入睡」档（仅入睡 = 当天有开始未结束的进行中会话，是瞬时单日状态，真实解释面在点击格子后的详情卡「已记录入睡，还没有结束时间」；且旧图例空心色块与真实 partial 格（档位底色 + 内描边 + 小点）并不同形，反而误导）；剩余 `<4h / 4–6h / 6–8h / 8h+` 整体压弱（`.cal-legend` opacity 0.6）；`is-note`、`is-partial` 两条死规则同步删除。
- **口径澄清（写死防再问）**：日历色阶与格内时长用的是**当天总睡眠**（`totalDurationMin` = 夜间主睡眠 + 午休/间断段之和），不是最长主睡眠；主睡眠（最长段）只用于连续天数与服务端模板。双口径并存见 context.md 第 4 节与 ADR-009，详情卡里拆「夜间 / 午休/间断」。
- 验证：`npm test` 203/202/1 PG skip、`npm run check` 通过（462.9KB）；CLI 模拟器截图复核（网格近满宽、左右 ~9rpx、图例 4 档弱化），console 无 error。**未提交未推送**（等用户确认）。

## 2026-10-22 · 统计页 Hero 与打卡日历重梳（真机截图反馈）

- **指标对比副标补主语与单位**：`少 5h42` → `比上周少 5h42m`、`晚 1h12` → `比上周晚 1h12m`、`持平` → `与上周持平`（`deltaAmount` 补 `m` 后缀，消除 "5h42" 被读成时刻的歧义）；`.metric-sub` 补 ellipsis 兜底。
- **周数据行提级**：`本周记录 N 天 · 连续 N 天`（20rpx 弱灰）→ `本周打卡 N 天 · 连续 N 天`（22rpx 正文色 + 数字加重），右侧补轻量引导「点数字看说明」（展开说明卡后隐藏）——三列指标可点展开是隐藏交互，此前无任何提示。
- **指标区加极淡容器卡**：三列数字成组（`rgba 0.035` 底 + 1rpx 描边 + radius-md），与说明卡/日历拉开层级。
- **日历空格降噪**：逐格「补记」文字（满屏 28 处）改为极淡 `＋`（24rpx、0.32 透明度）；补记动作入口保留在点击后的详情卡（`dd-action`），aria-label 保留"可补记"语义。calendar-strip 长周期视图本就用小点示意，口径一致。
- **图例修正**：`4h 内 / 8h 以上` → `＜4h / 8h+`（与 4–6h、6–8h 区间写法统一）；行首补回 ADR-022 既定的读色说明「颜色越亮 = 睡得越久」（此前实现遗漏）。**坑**：WXML 里 `&lt;` HTML 实体渲染不可靠（真机/模拟器显示字面字符），已改全角 `＜`。
- **底注补月份主语**：`5 天有记录` → `本月已记录 6 天`（长周期仍为 `近 N 个月已记录 X 天`）；空态 `这个月还没有完整记录` → `本月还没有完整记录`。
- **海报按钮动作化**：`✦ 近 30 天回顾` → `✦ 生成 30 天海报`（按钮只说名词不说做什么）；分享标题 `本周记录` → `本周打卡` 与页面用语对齐。
- 验证：`npm test` 203 项 / 202 通过 / 1 PG skip（stats-calendar `持平` 断言同步更新）；`npm run check` 通过（主包约 460.9 KB）；CLI 模拟器 390×844 造数截图复核（本周/上周各 3 天，三种对比副标形态 `多 1h20m / 早 7m / 晚 1h20m` 全覆盖），console 无 error。待真机：图例单行排布在窄屏（375px 以下）是否换行。

## 2026-10-22 · 统计页音符压住「展开」修复（底部清场 + 音符轻玻璃）

- **问题**（运营截图）：统计页 resting 位置下，绿色音符圆底压住「数据与备份」行右侧的「展开」——既挡视线又挡点击。根因：音符/播放条固定在右下带（176rpx 起 + 108rpx 高，浮动动画顶点约 292rpx），而统计页页脚广告位（待载约 100rpx / 实载更高）+ 32rpx 底部间隔只有约 237rpx，把「数据与备份」行顶进音符所在高度。
- **策略**：不移动音符——上移会改压「近 30 天回顾」/日历，左缘会压日历与标题，只是转移碰撞；右下带是浮动播放器的固有位置。改为页面让出这条带：统计页 `.safe-bottom` 32rpx → `180rpx + safe-area`（运营定档；`.stats-page .safe-bottom` 作用域覆盖）。几何真相：音符带顶边约 292rpx 是清场的确定性下限，180rpx 只有配合页脚广告位（约 140rpx）才能把「数据与备份」行抬出音符带；广告位关闭/加载失败（高 0）时行会落回带内重新被压住，广告实载时其下部会被音符遮。要两者都避免需 ≥300rpx，或给 `settings-head` 加右内边距让「展开」避开音符列（待运营取舍）。入睡页经几何复核安全（统计行在 379rpx 以上，高于音符动画顶点）未改。
- **音符轻玻璃**：三处圆底（`audio-dock` 的 `.dock-fab`/`.dock-note`、`now-playing` 的 `.np-float`，同一套值）`rgba(8,11,20,.46)` + `blur(14rpx)` + 重阴影 → `rgba(8,11,20,.30)` + `blur(18rpx)` + `0 8rpx 22rpx rgba(0,0,0,.2)`——本来就是玻璃，但填充偏实；调轻后内容从音符后面穿过时是磨砂通透感而非实心圆盘压住。尺寸/命中区/右缘 26rpx/无边框均不变。
- 验证：`npm test` 202 通过 / 0 失败 / 1 PG skip；`node tools/check.mjs` 通过（主包约 458.9 KB）；改动文件 lint 0 错误。**未真机验收**：统计页底部清场后的留白观感、轻玻璃在亮背景图上的字形可读性、播放条展开态与统计页底部内容的间距。

## 2026-10-22 · 定时关闭默认“关” + 三页音符/播放器整体上移

- **定时关闭默认“关”**：`audio-dock` 打开抽屉时定时胶囊默认选中「关」。原实现会跨会话回忆 `meta.audioTimerMinutes`，而旧版本默认 60 分钟时会把它写进存储——“回忆旧值”让新默认值对老用户失效；现默认值只认内存中实时的 `audioTimer.total()`（有跨进程恢复的运行中/暂停中倒计时时按真实档位回显，没有即为「关」）。
- **起表口径收口**：起播/恢复（含通知栏/锁屏系统恢复）只按本会话已明确选择的档位起表——dock 的 `onPlay` 改读 `data.timerMinutes`，`now-playing`（计算器/统计页）两处改读 `audioTimer.total()`；不再有“上次选过 30 分 → 下次播放静默重新起表”。到点停止、结束播放、终态加载失败都会把胶囊复位到「关」。`utils/audio-timer.js` 持久化口径不变（仍写 `audioTimerMinutes`，仅供跨进程恢复运行中的倒计时），既有单测不受影响。
- **音符与播放器三页上移**：入睡页 `audio-dock`（悬浮音符 / 播放中绿色吸附音符 / 迷你播放条）与计算器、统计页 `now-playing`（`.np-shell` 宿主）的底部安全位统一从 `132rpx + safe-area` 上移 44rpx 到 `176rpx + safe-area`——原位置与悬浮 tabBar（底 16rpx + 高 112rpx，顶边 128rpx）只差 4rpx，几乎贴住；现拉开 48rpx 间距。三页同一基线，展开/折叠动效与玻璃质感不变。
- 验证：`npm test` 203 项 / 202 通过 / 1 PG skip（`audio-timer` 9 条不回归）；`node tools/check.mjs` 通过（3 页面 / 23 JSON / 18 WXML / 19 WXSS，主包约 458.3 KB）；改动文件 lint 0 错误。**未真机验收**：上移后与页面底部内容（入睡页尾注/统计页广告位）的间距观感、320px 小屏播放条与脚注的重叠情况。

## 2026-10-22 · 入睡页：睡眠轨迹圆盘移除（两轮反馈收敛）

- **移除圆盘**：`components/sleep-disc`（canvas 24h 环）与 `utils/disc-geometry.js`、其测试整体删除。原因：sleeping/idle 态下圆盘与入睡圆环表达同一信息（入睡时刻/已睡时长是 orb 的第三个副本）且占空间；评估过的替代内容（环境声音快捷入口 = 与 audio-dock 重复；计算器建议摘要 = 与计算器页功能分裂；睡眠知识 = 与页脚文案重复）均不成立。
- **保留一行轻量统计**：原圆盘区块位置改为「本周 X 天 · 连续 Y 天 · 查看统计 ›」单行（`stats-strip`，顶部分隔线 + 22rpx 弱化文字），0 数据时不渲染；点击仍进统计页。这是入睡页唯一不与任何元素重复的统计信息（打卡心智钩子）。
- **过程记录**：圆盘先因“不能喧宾夺主上方的信息”弱化（去发光/渐变、细弧淡色、中心一行小字），再因与圆环重复被移除——最终形态回到「hero → 圆环（行动）→ 完成态信息 → 一行统计 → 分享」，图表与趋势全部归统计页。
- 验证：`npm test` 203 项 / 202 通过 / 1 PG skip（删除 disc-geometry 与 buildDisc 用例，保留 removeSession 4 条与 sleep 页面级 4 条）；`npm run check` 通过（23 JSON / 18 WXML / 19 WXSS，主包约 457.7 KB）。**未真机验收**：删除确认弹窗手感、同行 CTA 布局、统计行 0 数据分支。

## 2026-10-21 · 入睡页完成态重构（总睡眠口径 + 段删除 + 轨迹圆盘）

- **时间线口径统一**：完成态大数字（当天总睡眠）下方的时间线改为总睡眠口径——多段时「当天首段入睡 → 当天末段起床」，单段时保持「入睡 / 起床」。原来大数字含午休、时间线只显示主睡眠，两套数字对不上。
- **段列表可删除**：每行右侧「修改 / 删除」两个文字按钮（加粗、异色、无矩形边框：修改 = 主色浅紫，删除 = `--color-danger` 低饱和红）。删除弹确认框，明示将移除的时段与时长；当天唯一段时提示“删除后当天记录一起撤销”。删空当天 = 撤销整天（写墓碑防云端回填），剩余段重算主睡眠与总时长（新增 `storage.removeSession`）。
- **主操作同行小按钮**：「再记一段（现在开始计时）」→「继续入睡（开始计时）」，「补记一段已发生的睡眠」→「补记入睡」；两个小型按钮同一行（主按钮渐变底、次按钮玻璃底），下方「记录有误？撤销当天记录」位置不变；A 态补记入口文案统一为「补记入睡」。
- **「最近 7 天」→ 睡眠轨迹圆盘**：新增 `components/sleep-disc`（canvas 2d，24h 环，0 点在正上方顺时针；入睡/起床端点 + 24 根小时刻度 + 0/6/12/18 时刻标注）。三态：done 画当天全部段、sleeping 画进行中的段（30s 时钟推进生长）、idle 空盘 +「入睡后开始绘制」。区块头部「睡眠轨迹 · 本周 X 天 · 连续 Y 天 · 查看统计 ›」，点击仍进统计页；`buildWeekDays`/柱状图删除（与统计页删除 14 天趋势同一逻辑：入睡页首屏回答“我这一觉怎么睡的”，周趋势归统计页）。
- **视觉再弱化（同日，运营截图反馈“不能喧宾夺主上方的信息”）**：圆盘从“发光渐变主角”降为“弱记录底注”——去掉全部 `shadowBlur` 发光与紫→青渐变，弧/刻度/端点统一低透明淡紫（细弧 10px、全部段同色不强调主段），圆盘 500→460rpx；**中心不再重复 hero 的大数字**，只保留一行 24rpx 小字（done=共 N 段、sleeping=入睡时刻、idle=等待文案，单段 done 留白）。同步删除弱化后失效的 `disc-geometry.primaryIndex/lerpColor` 与 `stats.compactDuration` 临时导出。
- **几何纯函数**：新增 `utils/disc-geometry.js`（`splitSpans` 跨午夜拆环绕弧、`polar`/`radOf`、`angleOfMinutes/angleOfTs`）+ 单测。
- 验证：`npm test` 211 项 / 210 通过 / 1 PG skip（disc-geometry 6、storage removeSession 4、sleep 页面级 6：总睡眠口径/单段不换文案/buildDisc 三态/单段中心留白/删除确认与取消/唯一段整天撤销）；`npm run check` 通过（24 JSON / 19 WXML / 20 WXSS，主包约 471.1 KB）。**未真机验收**：弱化后弧与刻度的可见度平衡、sleeping 弧生长、跨午夜接头、360px 小屏缩放。

## 2026-10-21 · 统计页 L4 改版（结论卡 + 近 14 天趋势 + 打卡日历）

- **首屏结论**：三项均值改为「本周平均睡眠（当天总睡眠口径）+ 与上周同口径对比 + 0–12h 参照条（常见成人 7–9 小时）」；平均入睡降为次行，删除「平均起床」主位（入睡 + 时长的派生量，短睡眠/夜班场景会显示「02:38 起床」这种反直觉结果）。
- **热力图 → 打卡日历**：原 3 个月 × 20 列 × 24rpx（真机约 13px）格子难以点中，且 `<6h` 全部同色、图例「少 → 多」被理解成打卡次数。改为当月 7 列 × 5–6 行、88rpx 格、格内日号 + 时长、4 档色阶（<4h / 4–6h / 6–8h / ≥8h）、选中描边、固定详情卡（日期/入睡/结束/时长/夜间与午休/醒来日口径）、左右切月（最早 24 个月前）。旧 `components/heatmap` 保留但统计页不再引用。
- **新增近 14 天趋势**：纯 WXML 柱状图，柱高 = 当天总睡眠（0–12h 轴），柱色 = 入睡时段（23 点前 / 23 点–1 点 / 1 点后 / 白天），7/9h 参考线；点柱与日历共用详情卡。
- **事实回顾不再锁 3 天**：改为 1 天起的三条结构化事实（平均睡眠与上周对比 / 平均入睡与 0 点后天数 / 记录与最短最长），本地生成、零上传；删除统计页对 `/api/summary` 的依赖与 loading/error 状态机（服务端接口与后台开关保留）。
- **口径统一**：Hero、趋势、日历、海报统一用当天总睡眠（主睡眠 + 午休/间断段），详情里拆分夜间/午休；`digest` 新增 `avgTotalMin`、`weekly.delta.total`（纯加法，旧字段与服务端模板不变）。
- **短睡提示**：结束面板在时长 < 4h 时显示中性提示「如果是中途醒来，保存后可以再记一段，不影响这次记录」；仅「结束本次入睡」出现，不判定异常，夜班/白天补觉同样可见。
- **低频操作下沉**：「数据与备份」默认折叠，只露同步状态；展开后才是云备份开关 / 手动同步 / 删除云端副本 / 清除数据。
- **文案**：图例改「颜色越亮 = 睡得越久」；范围由错误的「近 3 个月」改为实际月份；海报改名「近 30 天回顾」。
- **新增纯函数**：`heatLevelOf`（4 档）、`bedtimeBandOf`（入睡时段）、`trendOf`（14 天）、`calendarCells`（月历，含仅入睡格）、`monthLabelOf`、`factsOf`（结构化事实）；`format.fmtHoursShort` 供格内紧凑时长。
- **首屏再收敛（同日反馈）**：结论卡 + 本周事实两块文字墙改为 **3 列核心指标**（平均睡眠 `3h39` / 平均入睡 `23:41` / 平均起床 `06:20`），每列只留「大数字 + 短标签 + 一行变化」；点击任一列展开最多 3 行事实说明，再点收起。平均睡眠下方用**常见 7.5–8 小时**做事实陈述（`在常见区间内` / `比常见少 X` / `多 X`），不足 3 天仍给陈述但标注「按已记录的 N 天算，补记后会更接近真实」。删除独立「本周事实」区块与底部口径长句。
- **近 14 天趋势删除**：运营反馈看不出价值，且与日历的每日状态重叠；移除 `components/sleep-trend`、`trendOf` 与相关测试，首屏只留指标 + 日历。
- **日历长周期**：新增 `当月 / 3 个月 / 6 个月 / 1 年` 周期切换；3/6/12 个月用横向滑动的连续月历（`components/calendar-strip`，格 48rpx、默认停最新月、左右滑动提示），4 档色阶与选中态不变。
- **空格补记**：点击空白天，详情卡显示「这天还没有记录」+「补记这一天的睡眠」；写入 `meta.manualDay` 后切到入睡页，由入睡页打开补记面板并预填该日期（预设日期默认 23:00 → 07:00，入睡页原有「30 分钟前 → 现在」默认保留）。
- **改版后自审修复**：刷新签名补 `todayKey / partialDay / syncEnabled / lastSyncAt`（修跨天不刷新、进行中的「仅入睡」格不出现、删除云端副本后入口残留）；本周 0 条时指标区显示空态，不再误报「上周没有可对比的记录」；今天已有完成记录时，进行中的第二段在格子与详情里显示；清除数据重置月份与选中态；选中态改由页面受控，避免「详情消失、描边还在」；`bedSpreadMin` 为空时不拼 `null`。
- 验证：`npm test` 192 项 / 191 通过 / 1 PG skip（`tests/stats-calendar.test.js` 10 条，覆盖 3 列指标、参照陈述、连续月历与跨年）；`npm run check` 通过（3 页面 / 23 JSON / 18 WXML / 19 WXSS，主包约 458.8 KB）；场景数据脚本复核指标/说明卡/日历输出正确。
- **未完成**：开发者工具截图与真机点击验收。本机 `wechatide` MCP 请求走 `127.0.0.1:7891` 代理、代理未启动（ECONNREFUSED），需要代理可用或关闭工具代理后补 390×844 截图与 20 次点击校验。

## 2026-10-21 · 睡眠段复审修复（结束/补记不可保存 · 跨天重叠 · 超 24h 校准）

- **P0 修复**：`pages/sleep` 结束面板把 `rangeForDay` 写成 `stats.rangeForDay`，而它只在 `utils/sessions.js` 里 → `computeEndSheet()` 必抛 TypeError，`_endBedAt/_endWakeAt` 恒为 0，「记录起床 / 补记 / 修改睡眠段」三条保存路径全部静默失效。改为直接依赖 `sessions`（`rangeForDay/rangeBetween/findOverlap`），并新增页面级冒烟测试覆盖页面真实代码。
- **P1 跨天重叠**：新增 `sessions.findOverlap(records, startAt, endAt, { id })`，`saveSession`/`updateSession`/页面预检都改成按时间区间查全表（导出 `overlaps`）。原来只查“醒来日”那条记录，3/4 22:00–23:30 与 3/4 22:30→3/5 07:00 会分别计入两天；编辑时按 session id 排除自身。
- **P1 忘记结束超 24h**：结束面板的入睡日改为取 `pending.bedAt` 的真实日期，新增 `rangeBetween()` 显式组合“入睡日 + 醒来日”，不再靠“入睡钟点≥起床钟点就回退一天”（两天前 23:00 会被压成昨天 23:00）。超 24h 时显示只读「入睡 10月19日」+ 可选「醒来日」日期行，默认入睡次日 + 常用起床时间（未到则退回当前时间），顺序不对直接报“入睡时间需早于起床时间”，不再静默回退。
- **P1 附带**：`updateSession` 把旧 v1 记录迁到已有记录的醒来日时改为合并（原来直接覆盖，会丢掉那天已有的段）。
- **P2**：`endToday` 随自然日刷新（tab 页常驻跨午夜后补记选不到“今天”）；30 秒时钟拆成 `refreshClock()`（只更新时间/已睡/超时文案），跨自然日才升级为 `refreshAll()`，`pruneStalePending` 复用已读到的 pending；超 24h 提示按 pending 去重，不再每 30 秒消失再出现。
- **P3**：保存收尾抽 `finishSave` + `closeSheet` + `syncAfterSave`/`reportSyncResult`（补记与编辑都能看到“云端校验未通过/稍后重试”）；计时结束的 session `source` 改为 `checkin`（补记仍为 `manual`）；`canOverwrite/onOverwriteTonight` 更名 `canAddSession`/直接绑 `onAddSession`；关闭按钮视觉 56rpx、`::after` 补到 80rpx 命中区；结算行允许换行，避免超时态多一段文案挤压。
- **服务端**：`/records/sync` 的 `includeAll` 类型校验前置到写库（及换取 openid）之前，非法值不再“先写入再 400”。
- 验证：`npm test` 182 项 / 181 通过 / 1 PG skip（新增 sessions 3 条、storage 3 条、sleep 页面级 6 条）；`npm run check` 通过；未真机验证超时 pending 的日期选择与新关闭热区手感。

## 2026-10-21 · 手动补记一段 + 睡眠段修改入口

- 新增「补记一段（已发生）」：完成态和空闲态均可进入；选择醒来日 + 入睡/起床时间，直接落 v2 session，不创建 pending、不启动计时、不触发提醒。
- 补记支持跨午夜（23:00→07:00 自动把入睡落到前一天）、过去日期（最近 400 天）；保存前校验未来时间、1 分钟–24 小时、与已有段重叠、单日 8 段/24 小时上限。
- 抽出 `sessions.rangeForDay()` 纯函数并补单测；保存后刷新本机并走现有 v2 同步。
- 「本日睡眠段」列表改为 88rpx 行高，右侧修改入口改为铅笔图标 + 「修改」，视觉 56rpx、命中区补到 72rpx；行内时间/时长分两行，避免拥挤。
- 验证：`npm test` 170 项 / 169 通过 / 1 PG skip；`npm run check` 通过；未真机验证补记日期选择与列表点按手感。

## 2026-10-21 · 多段睡眠 + 醒来日归属 + 结束提醒

- **归属口径**：新记录按“醒来日”归档（23:30→次日 07:00 算次日），午休/间断段归各自醒来日；旧 v1 记录保留 `bed-v1`，不重排历史。
- **多段睡眠**：`records[day].sessions[]` 支持一天多段；主睡眠取最长一段用于热力图/连续天数，`totalDurationMin` 为当天总睡眠。新增 `utils/sessions.js` 纯函数与 5 条单测，服务端 v2 schema 保存 sessions/night/total，v1/v2 双向兼容。
- **忘记结束**：pending 增加 `expectedWakeAt/id/reminderOptIn`；超过 20h 不再静默清除，24h 内可结束/校准，超过则提示手动校准。结束改为确认面板，可改入睡/起床时间并预览归入日期；完成态可“再记一段”午休，不覆盖旧记录；每条 session 可单独改时间。
- **结束提醒**：睡眠页可申请一次性订阅消息，服务端到点发送“结束入睡”；未配置模板/拒绝授权时回落到手机日历；点击消息直达结束面板；结束/撤销/清数据会取消提醒。新增 `sleep_reminders` 表、调度器、`/api/reminders` 与测试。
- **环境音**：定时关闭默认“关”（用户明确选 30/60/90 才起表）；暂停只 pause、不清 src/不 stop，保留系统媒体控制，便于从通知栏回到小程序。
- **规律性卡片**：统计页新增最近 7 天入睡/起床波动与平均睡眠；使用圆周差，少于 4 晚不展示；新增 `utils/regularity.js` 与单测。
- 验证：`npm test` 169 项 / 168 通过 / 1 PG skip（v2 多段同步、提醒调度/创建取消、规律性、sessions、storage 迁移/编辑）；`npm run check` 通过。未真机验证：订阅模板字段、日历权限、后台媒体通知暂停常驻、微信通知点击直达。

## 2026-10-21 · 时间轮 2 份循环 + 睡眠提示陈述化 + token 清理

- **时间轮减负**：时/分从 3 份循环降到 2 份，分钟列 180→120 行、滚动高度少 1/3，保留 1 分钟粒度；接近首尾 5 行时切到另一份，数字不变、视觉无跳。回中/初始选点抽成 `recenterWheelRow/pickWheelRow` 纯函数并补单测。
- **提示陈述化**：结果页“低于成人 7–9 小时建议”改为“成人常见睡眠时长为 7–9 小时”；晚睡提示去掉“建议保证”，改为“后半夜 REM 更集中，晚睡会压缩恢复性睡眠”；“偏短且入睡较晚”改为陈述句。徽标“推荐/偏短/不足/偏长”保留，仅表达相对区间。
- **token 清理**：删除无引用的 `--bg-aurora-*`、`--bg-night-primary`、`--wheel-fade`、`--color-danger-soft`、`--color-primary-dark`、`--radius-sm/lg`、`--space-*`，以及首页局部 `--c-primary/--c-text/--c-text-2/--c-border`；统一保留在用的 `--radius-md/xl/pill`、`--bg-cosmic`、`--bg-night-surface`、`--scrim`。
- 验证：`node --test tests/time.test.js tests/sleep-guide.test.js` 10/10；`npm test` 155 项 / 154 通过 / 1 PG skip；`npm run check` 通过；未真机验证时间轮 2 份循环的实际滚动手感。

## 2026-10-21 · 落地页备案与主体信息收敛

- **备案**：页脚替换占位号为正式备案信息——工信部备案号 `粤ICP备2026037774号-3`（链接 `https://beian.miit.gov.cn/`）、公安备案号 `粤公网安备44030002013825号`（链接 `https://beian.mps.gov.cn/#/query/webSearch?code=44030002013825`）；均 `target="_blank" rel="noopener noreferrer"`。
- **主体信息**：睡点作为主体公司下的工具产品，公开站点不再展示公司名称——移除页脚公司名、`<meta name="author">`、JSON-LD `author` 组织主体；`llms.txt` 的「主办方」改为「产品 / 睡点（微信小程序）」。
- **排版**：备案号加浅下划线提示可点击；≤600px 页脚纵向堆叠、备案信息逐行展示、长号码 `word-break: break-all`，避免与页脚导航挤压。
- 验证：桌面 1440px / 移动 390px 截图核对；两个 JSON-LD 块 JSON 校验通过；`npm test` 152 passed / 0 failed（1 个 PG skip）。

## 2026-10-21 · 复审补丁（迷你条权益 / 弱网 loading）

- `now-playing.toggle()` 不再在权益校验前写 `audioSession`，只在真正起播时标记会话；播放失败回滚时同步清 `loading`，不再停在「缓冲中…」。
- 入睡页迷你条的播放按钮补解锁校验：到期后允许暂停，但不能从迷你条直接续播，必须回入睡页重新解锁；`replay()` 的到期提示只在当前页可见时弹出。
- `now-playing` 补 12s 加载兜底，与 dock 同口径；`play()` 同步抛错时回到暂停态并提示，不留下假播放态。
- `audio-dock` 的 `play()` 统一走 `safePlay()`，异常时清加载态并提示。
- 验证：`npm test` 153 项 / 152 通过 / 0 失败（1 项 PG skip）；`npm run check` 通过；`node --check` 与 IDE lint 通过。

## 2026-10-21 · 复审修复（权益闭环 / 清除数据竞态 / 音频竞态 / 小屏护栏）

- **P0 权益**：`now-playing` 补 `isUnlocked/isFreeMode`，在 `toggle` 起播、`rebuildSource`、`handleEnded`、系统 `onPlay` 四处前置校验；解锁到期后首页/统计页不能再靠迷你条或系统通知栏续播。dock 的「本会话兜底解锁」通过 `globalData.audioUnlockedSession` 共享，清除数据时同步撤销。
- **P1 数据**：`eraseThenClear` 统一改为「先关同步 + 置 `cloudPendingErase` 闸门 + `whenIdle()` 等在途同步结束 → 再 erase」，修复清除后云端被在途分片重新写回的隐私缺口；未开云备份的分支同样生效。
- **P1 视觉**：≤360px 不再隐藏结果页「推荐/偏短/不足」护栏徽标、不再让主推荐行换行；meta 用 `flex:1 + ellipsis` 收缩，避免背面撑高。
- **P2 音频**：`onError` 回退加 `isFallbacking` 去重；dock `togglePlay` 补 220ms 重入锁；`onTimerTap` 改用真实 `audio.paused`；`now-playing` 补 `loading/onCanplay`、`rebuildSource` 校验 https；两组件 `pageLifetimes.show` 补幂等 `restore()`；定时到点 toast 用 `playerState.claimExpiryToast()` 跨组件去重；解锁 `expireAt` 回退到过去时间时按本地 TTL 兜底。
- **P2/UX**：`--z-overlay` 9999→160，迷你条不再压住背景选择器/解锁面板；`audio-cache.peek` 失效补 notify；广告跳过时取消后台预热下载；`play` 的 meta 写失败提示；云备份开关写失败保持原状态；事件队列丢弃补 `meta.eventDropped` 计数；`now-link/result-fall` 命中区补到 72rpx。
- **P3 清理**：90 分钟常量收敛到 `time.js`；`DEFAULT_FALL` 常量；`prefs.wakeTime` 非法值回退；移除 `time-wheel.getValue`、页面 `view.allPassed`、now-playing 关闭图标死规则；`tw-item` 去掉 font-size 过渡；文档口径同步（时段词/1 分钟粒度/睡眠提示非医疗建议）。
- 验证：`npm test` 153 tests / 152 passed / 1 PG skip；`npm run check` 通过；全部修改文件 `node --check` 通过；IDE lint 0。未真机验证：解锁到期跨页交互、loading 文案、320px 结果面、z-index 浮层层叠、清除数据与在途同步竞态。

## 2026-10-21 · P3 视觉治理 + 后台加固

- **视觉治理**：清理 `audio-dock.wxss` 6 组无 wxml 引用的死样式（旧关闭按钮/解锁条/单曲提示/重复副标题），移除 `ad-slot` 的 `is-settled` 与 `dock-note` 的 `is-playing` 空类；提升“已过”时刻、入睡耗时档位、脚注、背景状态/空态、定时胶囊的可读性；模式胶囊与结果头改用 CSS 日/月图标，不再使用 emoji；删除 custom tabBar 下不再使用的 8 个 tab PNG 与 app.json `iconPath`（主包约 386.3 KB）；`stats.goHome` 更名 `goSleep`；docs/09 同步空态新设计。
- **后台加固**：三个上传端点接入 20/min 限流（在 multer 解析文件前）；新增环境音/背景图 ID 加随机后缀，修复同一毫秒连续新增导致保存报“ID 重复”；`includeAll` 增加严格布尔校验；COS SecretId 回显脱敏，且“留空/保持脱敏值”不修改原值；测试连接按钮按配置状态恢复；落地页/演示页补 CSP，非 API 的 404 返回 HTML；看板事件达到 2 万条上限时显示截断提示。
- **保留**：`/api/admin/stats` 前端虽未使用，但被测试覆盖且 `db.adminStats` 被 analytics 复用，保留为运维诊断端点。
- 验证：`npm test` 152 passed / 0 failed（1 个 PG 集成 skip）；`npm run check` 通过；模拟器复核计算器/结果面/背景选择器/环境声抽屉，console 无 error。

## 2026-10-21 · L4 收口（深审修复 · 视觉治理 · 交付打包）

- **音频状态机（P1）**：`audio-dock` 冷启动不再采信上个进程残留的 `lastTrackPlaying`——与 `now-playing` 统一按「本进程有 `audioSession` / 播放器有 `src`」判定，无会话时清 meta 与迷你条（修复「显示正在播放但无声、点暂停反而起播」）；`attached` 顺序改为 `audioTimer.restore()` 先于 `syncFromAudio()`。`audio-dock` 与 `now-playing` 的 `onEnded` 用新增 `playerState.claimEnded()`（800ms 窗口）去重，每轮循环只有一个组件重建音源，消除同一 `src` 双写 + 双 `play()`。起播新增 12s 加载兜底（超时提示「加载超时，点音符重试」）。
- **计算器**：结果态新增计算锚点 `_anchorAt`，同一次结果内的重算（切后台回来、结果面换入睡耗时）沿用同一「现在」，修复入睡模式被 30 分钟宽限静默推后一天却不提示；入睡结果在非「今天」时把日期写进 note（「明天 19:30 上床，已含 15 分钟入睡」）。同时收紧正面纵向节奏：舞台 780→712rpx、提示行 72→64rpx、耗时行上距 26→10rpx。
- **本地存储/同步**：`saveRecord/removeRecord` 改为基于原始记录表浅合并，`mergeServerRecords` 同样用原始表，避免「读过滤子集 → 整表覆盖」丢掉缺 `day` 的旧条目；同步分片循环内复查云备份开关，关闭后立即停止后续上传/回填。
- **统计页**：`refresh` 增加数据签名（含逐格 level、今天列、同步文案），onShow 的连续两次刷新不再全量 `setData`；热力图只在首次渲染或「今天」换列时 seek，避免把用户左滑查看的历史月份拽回；海报按钮（64→80rpx）与入睡页提示条（59→75rpx）补命中区。
- **后台并发**：配置保存引入乐观并发——后台提交带 `baseUpdatedAt`，服务端不一致返回 `409 CONFIG_CONFLICT`，不再出现两位运营同时保存时后保存者静默抹掉前者新增的环境音/背景图；内存模式在后台来源行明示「重启后会丢失配置」。
- **服务端**：新增墓碑回收（400 天外的 `sleep_record_deletions` 定期清理，避免每次 sync 全量回传且无限增长）；memory 实现补齐 `getRecords` 按日排序、`listEvents` 最新在前 + 20000 上限，与 PG 对齐；补 `unhandledRejection` 日志与 `uncaughtException` 记录后优雅退出。
- **视觉治理**：`app.wxss` 新增 `--hero-scrim`（计算器页与 `hero-backdrop` 共用，消除两页压暗值漂移）、`--color-primary-soft`（此前 16 处引用但从未定义，导致入睡页时间轴起点圆点与音频抽屉电平条透明）、`--color-tabbar-surface` 与 z-index 层级表（`--z-hero` … `--z-overlay`）；熄灯遮罩提到 150；audio-dock / now-playing 的绿音符、月金、危险红与 tabbar 表面色收敛为 token。
- **验证**：`npm test` 148 项 / 147 通过 / 0 失败（1 项 PG 集成 skip），新增 storage 合并 2 条、ended 去重 2 条、配置冲突 2 条；`npm run check` 通过（3 页面 / 21 JSON / 16 WXML / 17 WXSS，396.1 KB）；开发者工具 390×844 三页 + 音频抽屉 + 熄灯遮罩截图复核，console 无 JS 异常；打包 `release-artifacts/getsleep-L4-20261021.zip`（223 文件 / 2.51 MB，含 `RELEASE-MANIFEST.json`）。
- **真机待验**：播放中杀进程重进不出现幽灵播放态、短音源循环只重播一次、时间轮小幅拖动回中、展开迷你条后第一次点 tab 直接切页。

## 2026-10-21 · 深审复核：自定义 tabBar 挂载 + 音频循环/缓存收口

- **P0 导航**：`app.json` 已设 `tabBar.custom=true`，但三个 tab 页均未声明/挂载 `custom-tab-bar`，原生底栏关闭后底部导航整体缺失。已补三页 `usingComponents` 与 `<custom-tab-bar />`，并在 `tools/check.mjs` 增加守卫（custom=true 时逐页校验声明与挂载），防止再次漏挂。
- **音频**：`audio-dock.replay()` 与 `togglePlay()` 的 src 重建分支补 `this._audio.play()`，修复系统侧停止/自然播完后“显示播放中但没声音、需点两次”。
- **缓存**：`audio-cache.peek()` 增加 `keepUrl` 保护，TTL 到期不再删除正在播放的文件；`ensure/cachedCount` 与双端调用点同步传入。
- **睡眠提示**：`sleep-guide` 文案改为按真实小时数生成，并补“偏长”分支；计算器结果面支持 `guide-long`。
- **UX/文案**：删除云端副本弹窗明示“含云端解锁状态与统计数据”；后台启动失败区分网络错误与业务错误；空态亮格移到右下角并补微光/CTA 按压反馈；解锁定时器隐藏页不再 setData，回前台补刷新。
- 验证：`npm test` 148 passed / 0 failed（1 个 PG 集成 skip）；`npm run check` 通过；模拟器 390×844 实测三页 tabBar 渲染/选中/点击切换、统计空态、console 无 error。

## 2026-10-21 · 落地页改版 + 小程序码后台上传 + GEO

- **落地页改版**（`server/public/site/index.html` / `landing.css`）：按 App 简约风重写——层级只用字号/颜色/留白表达，全部去掉背景卡片框；Hero 对齐「睡前 3 秒，算出你的入睡点」口径（入睡点渐变强调），副文案「基于 90 分钟睡眠周期倒推入睡时间…」；下方内容重排为「三件事，做到干净」（入睡点计算 / 打卡与回顾 / 环境声音）与「我们的原则」（01 打开即用 / 02 数据本地优先 / 03 只陈述事实）+ 一行边界小字 + 3 条常见问题。
- **手机演示重做**：旧版手机壳内容难懂，改为按真实计算器叙事分两步——「① 选择起床时间」（模式胶囊 + 时间轮 07:30 选中 + 入睡耗时档位 + 计算按钮）→「② 得到三档入睡时刻」（23:45 主推荐 + 01:15 / 02:45 弱化行），底部说明「拖动时间轮选起床点 → 一键算出今晚的上床时刻」。
- **Logo**：`.logo` 从渐变方块改为「圆形 + 月牙」（内联 SVG data-URI，与小程序图标一致），落地页导航/页脚、手机壳内品牌行、`/demo/` 导航共用。
- **小程序码后台上传**：配置新增 `site` 段（`mpQrCodeUrl` / `mpQrNote`，旧配置自动补默认值）；后台新增「落地页」面板（上传 / 预览 / 清除 / 文案），新接口 `POST /api/admin/site/qrcode`（图片 ≤5MB 进 COS `site/` 前缀，复用图片上传器与鉴权）；落地页通过 `landing.js` 读 `/api/config` 动态展示，未上传时显示深色虚线占位，加载失败回退占位。
- **GEO**：新增 `robots.txt`（放行 GPTBot / OAI-SearchBot / ClaudeBot / PerplexityBot / Google-Extended 等 AI 爬虫，Disallow /admin 与 /api）、`sitemap.xml`、`llms.txt`（面向生成式引擎的产品事实 / FAQ / 链接）；`index.html` 补 keywords、canonical、OG / Twitter 卡、`MobileApplication` 与 `FAQPage` JSON-LD（FAQ 与页面可见内容一致），favicon 换成圆月 SVG。
- **验证**：`npm test` 141 pass / 0 fail（+1 PG skip，新增 site 配置 3 用例、更新落地页冒烟断言）；`npm run check` 通过；内存模式冒烟——`/api/config` 下发 site、GEO 三文件可访问、未登录上传 401、未配 COS 上传优雅 400、http URL 保存被拒、中文文案保存下发无乱码；桌面 + 390px 移动端整页截图核对（`docs/assets/landing.png` 已更新），控制台无 error。修复一处 `img[hidden]` 被 `display:block` 覆盖导致空态渲染破图的问题（同 `.toast[hidden]` 先例）。

## 2026-10-21 · 环境声抽屉收口 + 悬浮 tabBar

- **底部导航**：`app.json` 开启 `tabBar.custom`，新增 `custom-tab-bar/` 悬浮胶囊；实色深蓝、极细描边/轻阴影，中间「入睡」用同色圆凸起 + CSS 月牙，左右为细线时钟/四柱统计；当前页图标、文字提亮并加 `500` 字重，三页 `onShow` 同步 `selected`。
- **布局**：去掉原生 tabBar；播放器、音符统一抬到 `132rpx + safe-area`，给悬浮胶囊让位；`np-host` 与 tabBar 的层级重新排过，抽屉/遮罩/播放器的 z-index 明确分层。
- **环境声抽屉**：分类 `28rpx` 加粗选中、收藏 `36rpx`、播放圆钮 `76rpx` 且可独立点击；定时关闭复用计算器「预计入睡耗时」的 44rpx 小胶囊；移除标题副文案、免费收听提示和列表底部建议卡；去掉搜索与定时之间的重复分隔线，并拉开各区块间距。
- **播放器**：`audio-dock` 与 `now-playing` 统一 108/66rpx 音符、右缘 26rpx、480rpx 右贴边播放条、48rpx 左留白；去掉易误解的关闭 X，点击条打开抽屉、点击外部向右收缩回音符（暂停态也生效），结束播放收进抽屉标题栏；修复 `.np-shell.is-in .now-playing` 权重压过折叠动画的问题。
- **跨页状态**：`lastTrackPlaying` + `audioSession` 兜底 `audio.src` 短暂为空；暂停/恢复/停止/错误/定时到点统一清理会话，冷启动不画残留播放条。
- **统计页**：热力图下方补“少→多 / 仅入睡”图例；点格子从一次性 toast 改为卡片内固定详情行（日期 + 时长/未完成/未到）；危险入口说明改为“会删除什么、不可恢复”，补分享/海报/同步/清除的 ARIA 角色；无数据空状态重做月相 orb（实心月牙 + 细轨道 + 星点）。
- **背景/浮层/玻璃**：统计页接入 `hero-backdrop`，与计算器/入睡共用后台背景；「换背景」缩到 56rpx 高并半透明；环境声抽屉、背景选择器打开时隐藏自定义 tabBar；播放条改半透明玻璃，折叠音符补淡玻璃圆底。
- **文档/验证**：更新 `docs/09-redesign.md`、`docs/12-sleep-audio-refresh.md`、`README.md`；`npm test` 140（139 pass / 1 PG skip），`node tools/check.mjs` 通过（3 页面 / 21 JSON / 16 WXML / 17 WXSS，约 385.0 KB）；开发者工具编译通过，自定义 tab 切换实测可用。

## 2026-10-20 · 结果页时长护栏与晚睡提示

- 新增 `utils/sleep-guide.js`：5 个周期（7.5h）→「推荐」；4 个周期（6h）→「偏短」（低于成人 7–9h 建议）；3 个周期（4.5h）→「不足」（仅作极限参考）。只做解释层，不改变 90 分钟倒推。
- 结果页主推荐右侧的「★ 推荐」徽标改为时长护栏徽标（推荐/偏短/不足），后续推荐行在时长后追加同色提示词；主推荐 <7h 时说明低于建议，入睡时间在 01:00–05:59 时提示后半夜 REM 被压缩。
- 新增 `tests/sleep-guide.test.js`（3/4/5 周期分档、晚睡边界）；结果页文案控制在单行内，避免挤占主卡高度。
- 验证：`node --test tests/sleep-guide.test.js tests/plan.test.js tests/format.test.js` 8/8；`npm run check` 通过。

## 2026-10-20 · 深审第二轮修复（音频闭环 / 同步反馈 / 背景与广告 / 服务端限流）

- **音频**：坏缓存回退远程后立即失效（`cache.remove` + 会话黑名单），修复循环重播每轮卡顿；`now-playing` 补 `rebuildSource` 与 `onEnded`，系统清空 `src` 后可恢复、首页/统计页自然播完能收口；系统侧暂停（通知栏/锁屏/耳机）冻结倒计时；新增 `onCanplay`/`loading`，弱网不再误显示“正在播放”。
- **同步**：服务端 `dropped>0` 不再提示“已同步”，区分全部被拒（检查手机时间）与部分未写入；合并写入失败、墓碑清理失败不再被吞；400 天窗口边界与服务端统一为 `bedAt`；后续分片只回传精简响应；`eraseCloudOnly` 先关同步并置 pending 闸门再删云端。
- **背景/广告/配置**：配置拉取失败不再误报“暂时没有可用的背景图”，提供重试；付费背景到期提示 + 选择器显示剩余小时；激励视频看完但写入失败可原地重试；结果面「换成我想几点睡/醒」保留刚算出的推荐时间。
- **服务端/后台**：`/api/share/qrcode` 增加进程内缓存与 in-flight 去重；erase/qrcode 补 openid 维度限流；erase 能力缺失 fail-closed；生产 `TRUST_PROXY=0` 显式告警；配置保存补审计；默认背景读路径兜底；`unlockDesc` 跟随 `ttlHours`；看板加载失败可见。
- 验证：`npm test` 137 passed / 0 failed（1 个 PG 集成 skip）；`npm run check` 通过（3 页面 / 19 JSON / 14 WXML / 15 WXSS，约 333.2 KB）；全量修改文件 `node --check` 通过。

## 2026-10-20 · 计算器起床上下文 + 结果时段标签

- 起床模式在时间轮下方显示「今天/明天 上午/下午 HH:MM 起床」：与 `bedtimesForWake` 共用新的 `plan.nextWakeAt`（留出入睡耗时后仍来不及才顺延到明天），随当前分钟、所选时间、入睡耗时刷新；入睡模式该行仍显示「当前 HH:MM」。21:50 选 07:30 上午会明确显示「明天 上午 07:30 起床」。
- 结果面的时间前缀从「今天/明天」改为时段词：凌晨（0–4）、早晨（5–8）、上午（9–11）、中午（12–13）、下午（14–17）、傍晚（18–19）、晚上（20–23）。23:45 → 晚上 23:45，01:15 → 凌晨 01:15，消除“明天 01:15”指的到底是今晚还是明晚的歧义。
- 新增 `format.periodLabel` 与 `plan.nextWakeAt`，补时段边界单测（tests/format.test.js）和“今天/明天”判定单测（tests/plan.test.js）。
- 验证：`node --test tests/plan.test.js tests/format.test.js` 6/6；`npm run check` 通过。

## 2026-10-20 · 深审修复（音频状态机 / 统计兜底 / 同步批量化 / 后台合规 / UX）

- **P1 音频**：`audio-dock` 与 `now-playing` 同时监听全局播放器 `onError`。缓存坏文件回退远程时，`now-playing` 原会无条件清 `lastTrackActive` 和定时器，导致音频仍在播但三个页面都没有控件、定时关闭失效。新增 `utils/player-state.js` 标记“正在回退”，`now-playing` 延迟 300ms 等 owner 落定后再判定终态；`audio-dock` 回退分支同步保持 `lastTrackActive=true`。
- **P2 统计**：开启云备份后，`/api/summary` 不可用/网络失败原本只剩“重试”死胡同。新增 `applyLocalFact` 兜底，服务端失败时回退本地模板并标注“仅统计本机记录”，同时保留“重新获取”。
- **P2 同步**：`mergeServerRecords` 改为内存合并、最后各写一次 `records/deleted`，消除逐条全表读写的 O(n²) IO；补 `storage.replaceDeleted`，并确保“本机没有记录、云端只有墓碑”也会落盘。
- **P2 后台**：用户数据面板在云端无数据时仍允许执行删除，以写入全量清除水位；查询接口下发 `erasedAt/deletedDayCount` 并在面板展示。
- **P3 UX/正确性**：海报超时不再丢弃晚到的成功结果（拆 `closeLoading/save` + seq 防旧结果覆盖）；睡眠记录保存后 `clearPending` 失败不再回到 B 态；`env.js` 兜底改 `release`；音频缓存同 URL 去重 + 临时文件原子替换 + 取消下载 + 淘汰保护在播文件；抽屉/背景分类栏拦滚动穿透；广告失败平滑收起；配置未到时不再误报“没有背景图”；解锁下架提示与持久化失败本会话一致性；后台存储接口 DB 异常映射 503 且加载失败可见；默认背景图不得指向停用项；窄屏脏状态保存条常驻；配置 JSON 面板改为展示服务端已生效配置；H5 demo 的“下一晚”提示恢复显示。
- 验证：`npm test` 133 passed / 0 failed + 1 个 PG skip；`npm run check` 通过（3 页面 / 19 JSON / 14 WXML / 15 WXSS，主包约 319.0KB）。
- 待真机确认：锁屏/通知栏停止后 `togglePlay` 重建播放源、同一 `src` 重赋值能否循环、来电/其他音频抢占的倒计时策略。

## 2026-10-20 · 计算器当前时间行防抖动 + 实时分钟

- 「当前 HH:MM / 用现在的时间」行改为两种模式常驻：选择起床时间时只 `visibility:hidden` 右侧动作、保留整行高度；切到选择入睡时间不再把下方「预计入睡耗时」档位顶下去，消除切模式抖动。
- 当前时间改为真实时分，不再按 5 分钟取整；时钟改为对齐下一个整分后每 60s 刷新（原 30s + 取整会让显示最多滞后数分钟）。
- 入睡模式默认跟随真实当前时间（如 21:28 → 09:28 下午），不再读上次保存的入睡时间，也不再白天固定 23:00；用户本轮手动调过则保持，`用现在的时间` 同样精确到分钟。
- 时间轮居中选中光带高度收至行高的 68%，减轻选中行背景块的厚重感。

## 2026-10-20 · 计算器「预计入睡耗时」改为单行档位选择

- 标签与档位合并为一行：左侧时钟图标 + 「预计入睡耗时」，右侧 5/10/15/20/30 分五档靠右排列；默认固定 15 分，旧版本保存的入睡耗时不再作为初值。
- 未选中的档位只显示文字、完全去掉底框；仅当前值（默认 15）是一枚 44rpx 小标签：14% 淡紫底 + 1rpx 淡紫内描边 + 近白 500 字重，不再是整排药丸，避免抢主 CTA。
- 档位固定 72rpx 宽、水平间距 8rpx，视觉高度 44rpx，命中区垂直外扩 14rpx（实际 72rpx），保留按压反馈。

## 2026-10-20 · 迷你播放器图标重绘 + 播放/暂停/定时关闭交互收口

- 图标按参考图重绘（`now-playing` 与 `dock-mini` 同几何）：暂停为两根 6×30rpx 细竖条（gap 9rpx、2rpx 圆角，不再用矮胖胶囊），关闭为 3rpx 中心对齐细 ×（对角约 21rpx），播放三角放大到 30rpx 高；暂停/播放为 92% 白，关闭降为 58% 白；命中区仍 76rpx（伪元素外扩到 88rpx），新增 `hover-class` 按压反馈与图标切换 0.16s 落定动画。
- 交互：`now-playing` 暂停/继续改为乐观更新（先切图标与状态行，再由 `onPlay/onPause` 校准）并加 220ms 重入锁，避免连点抖动；状态行新增定时倒计时（播放中「N 分钟后关闭」、暂停时「定时剩 N 分钟」）；错误/到期提示只在当前可见页弹一次，避免首页与统计页双实例重复 toast。
- 定时关闭可靠性（`utils/audio-timer.js`）：①`restore()` 在“内存 endAt 已过点”时原来只返回 0、不停音频，现立即停止并清运行态；②暂停瞬间恰好到点不再把倒计时静默吞掉；③冷启动没有存活后台音频时不再“复活”上次的运行/暂停倒计时（保留用户偏好）；④自然播完 `ended` 在到点后不再误循环重播；新增 `arm()` 统一“暂停续剩余 / 空闲按偏好起表”，dock 与 now-playing 共用。
- 定时反馈：dock 选择档位时提示「N 分钟后自动关闭」/「已关闭定时」，定时行实时显示剩余（暂停时显示冻结值）；播放条与 dock 均不再每秒 setData（文案未变直接跳过，隐藏页不计算）。
- 定时关闭区块按参考设计稿重做：左侧纯 CSS 秒表图标 + 「定时关闭」，右侧深色轨道内等分胶囊分段（30分 / 60分 / 90分 / 关），选中为浅紫药丸 + 蓝紫字、0.18s 过渡 + 按压反馈；剩余时间降为标签下方的 18rpx 辅助行，避免与档位抢层级。
- 动效：`now-playing` 改为常驻 DOM + `is-in/is-out` 类切换（`wx:if` 硬切会导致折叠无动画）：入场 `translateY(40rpx)→0 + scale(.96→1)`（340ms spring），退场 220ms gentle，隐藏态同时关闭 `pointer-events` 与 `visibility`；`dock-mini` 使用同款进出场，声音 FAB 出现补 240ms 淡入。跨 tab 时页面实例常驻，不会重复播放入场动画；首次进入有音频会话的页面时才播一次。
- 验证：`node --test tests/audio-timer.test.js` 9/9；`npm test` 126 passed / 1 PG skip；`npm run check` 通过；Edge 375px 等比静态稿截图核对播放/暂停/长标题/图标放大四态。
- 未真机验证：`hover-class` 按压反馈与 1rpx 细笔画在 iOS/Android 真机上的实际渲染仍需开发者工具与真机点按确认。

## 2026-10-20 · 统计页热力图改月对齐 + 信息行换行修复

- 热力图范围改为「3 个月前的 1 号 →（今天 + 21 天）所在周的周日」：当前 10 月即 7/1 ~ 11/15，月份标签稳定为 7/8/9/10/11，11 月整段为未来占位。上一版「固定 20 整周」起点落在 6 月初，月份标签会从 6 月开始，不符合运营预期。
- 未来占位提亮：`rgba(255,255,255,0.08)` 虚线在 26rpx 小格上几乎不可见，改为 `rgba(148,163,184,0.32)` 虚线 + 0.03 淡填充，明确区分“还没到”与“没打卡”。
- 格子尺寸改为按列数自适应：`heatmap` 新增 `availableWidth`（默认 602rpx），按可用宽反推 `cellSize`（22~30rpx 夹取），列数在 17~21 浮动时都能铺满，不再依赖固定 20 列。
- 信息行换行修复：左侧文案 `flex: 1 1 auto + nowrap + ellipsis`，右侧 `.section-actions` / `.poster-btn` 设 `flex: none`；分享钮改为「外层定尺寸圆 + 内层绝对定位 button」——button 自带 `width:100%` 会把圆形撑成椭圆；三节点 glyph 移到 button 外层并显式给色（button 默认 `color:#000` 让 `currentColor` 变黑，深底上不可见）。

## 2026-10-20 · 统计页热力图固定 140 天 + 信息行重设计

- 热力图不再提供「近 3 个月 / 近 30 天」切换：固定 20 整周（19 周前的周一 → 本周周日），恒 140 格 / 20 列，末列是本周、含未来虚线板位；新增纯函数 `stats.weeksSpan(now, weeks)`，附 2 条单测（周三/周日两种边界）。
- 格子由 30rpx 缩到 26rpx（间距仍 4rpx）：20 列总宽 `20×26 + 19×4 = 596rpx`，恰好补满卡片内可视宽 602rpx，一屏看全，不再横向滑动。
- 标题右侧选择器换成矮标注「近 140 天」（18rpx 纯文字，不与 30rpx 标题抢层级）。
- 信息行按设计稿重做：左侧「共 N 天完整记录」，右侧圆形分享钮（CSS 绘制三节点 glyph，`share-btn` 新增 `variant="icon"`）+ 淡紫玻璃胶囊「✦ 生成月度海报」；海报内容仍是最近 30 天。

## 2026-10-20 · 迷你播放器视觉重设计（信息层级 + 触控热区）

- 参考效果图重做跨页 `now-playing` 与入睡页 `audio-dock` 的 `dock-mini`（同款结构，双页一致）：
  - 信息两行：第一行「标题 · 分类」（分类由 audio-dock 播放时写入 `lastTrackCategory` 持久化，旧数据无分类时只显示标题），第二行「跳动音符 + 正在播放/已暂停」。
  - **全条只保留一个均衡器**（信息行左侧的大均衡器已删除），唯一动效在状态行：四根音符条 28rpx 高 / 5rpx 宽、0.9s 大摆幅（scaleY 0.3→1）错峰跳动；播放中与「正在播放」文字同着 `--color-primary`，暂停态降为 `--text-muted` 且动效暂停。
  - 右侧控件为**无底框纯图标**（按运营反馈去掉圆形描边/底色）：播放中显双竖条暂停图标、暂停态显三角播放图标，关闭为 CSS 细 ×，全部纯 CSS 绘制无新增位图；76rpx 命中区 + 伪元素外扩 6rpx → 实际可点 88rpx，`:active` 缩放 + 降透明反馈。
  - `dock-mini` 状态行保留定时信息（「N 分钟后关闭」）；「正在播放 · 循环」文案简化为「正在播放」。
- 修复类名冲突：迷你条新控件类原命名 `dock-icon` 与抽屉列表图标（audio-dock.wxml:112）同名，会互相覆盖宽高/背景/伪元素，已重命名 `dmc-*` 前缀；同步删除死亡规则 `.dock-mini-btn:active` 与随大均衡器废弃的 `dock-eq/eq-bar/dockEq`。
- 验证：`npm test` 121 passed / 0 failed + 1 PG skip；`npm run check` 通过；浏览器等比 mock（375px 视口）四态截图核对：播放中 / 已暂停 / dock-mini 定时态 / 超长标题（省略号生效、分类保留、按钮不挤压）；固定条仍位于 tabBar 上方 24rpx。
- 未真机验证：WeChat 内 `::after` 热区外扩与 CSS 三角形的实际命中需真机/开发者工具点按确认。

## 2026-10-20 · L4 深度审查修复（数据闭环 / 可访问性 / 视觉）

### 数据与闭环

- 云备份改为每片 60 条分片，覆盖最近 400 天；每个分片使用独立 `wx.login` code，不再只传 60 天。
- C 态：同睡眠日凌晨 3 小时后允许重新开始并覆盖旧记录；跨睡眠日仍只在 18:00 后提供“再记今晚”，弹窗写明覆盖后果。
- 时间轮新增 `getValue()/flush()`；计算前强制吸附落定，修复“结果翻回正面/用旧时间算”的竞态。
- 音频：定时到点/停止不再清掉用户定时偏好；首页/统计页迷你播放器暂停/关闭同步倒计时；解锁到期停止当前曲目且当前曲目续播重新校验；减少每秒 setData。
- 清除数据：未开云备份时保留云端副本重试入口并阻止同步复活；后台用户删除文案明确会清本机；cloudOnly 删除等待在途同步并换 epoch；`cloudOnly` 非布尔返回 400。
- 后台配置部分保存不再重置 unlock/features/cache/copy；未知 `DB_MODE` 启动失败；数值环境变量非法启动失败。
- 服务端增加 events/summary 总闸；事件插入在事务内重新校验 erasure；iOS 多字节 Cookie 不再触发 500；非法日历日墓碑被丢弃；COS 测试改用 PutObject 探针。
- 后台审计落库 `admin_audit`；用户查询返回解锁/事件计数，无睡眠记录但有解锁/事件的用户也可删除。

### UX / 视觉

- 时段胶囊：点当前上午/下午不再翻转 12 小时；每段 44px 触控高度。
- 迷你播放器下移到 tabBar 上方 24rpx，不再遮挡事实回顾/分享；顶栏加暗色渐隐，滚动内容不再穿到状态栏。
- 热力色阶重做，低强度可见；`--text-muted` 提亮；关键操作触控区 ≥80–88rpx；分享/撤销/重试/海报等不再 14–22px 高。
- 结果面加入“去入睡打卡”和“入睡耗时切换”，减少大片空白；海报改为 600×960 2x，另生成 600×480 5:4 分享卡，二维码完整可见。
- 背景图：切默认前提示会结束付费解锁；free mode 文案与行为一致；缓存淘汰/清除会删除本地文件，坏路径自愈；选择器优先用本地缓存，缩略图走 COS `imageMogr2` 并支持回退原图。
- 后台配置即时刷新：修复 `force` 请求在途时非 force 调用被旧缓存短路的问题；首页/统计/音频抽屉在 onShow 强制刷新，后台保存背景图/广告位后无需等 10 分钟 TTL。
- 3D 正面不再常驻 `perspective`/`translateZ`/嵌套 `preserve-3d`，避免开发者工具里 `scroll-view` 与上午/下午 tap 命中偏移；翻转时仍保留 3D。
- 背景联调：后台 `defaultBG.jpg` 为 1280×720 横图，`widthFix` 下正常显示为顶部条带并渐隐；若需整屏 Hero，应上传 1080×1920 竖图（或用 `aspectFill` 裁切）。
- 首帧测量前移到模块加载，顶栏/时间轮不再先渲染再跳高；熄灯遮罩可拦截/点击提前结束；抽屉非列表区域阻止页面滚动；搜索支持键盘确认。
- H5 首屏空播放条修复；全过期改为“现在睡”；解锁 TTL 读取后台配置；落地页热力范围改为近 3 个月。

### 验证

- `npm test`：119 passed / 0 failed + 1 个 PG 集成用例（未设置 `PG_TEST_URL` 时跳过）。
- `npm run check`：3 页面 / 19 JSON / 14 WXML / 15 WXSS，主包约 285.6 KB。
- 新增：分片同步、时间轮吸附、C 态策略、事实指纹、未来热力格、背景缓存清理、配置并发、广告位重建、`cloudOnly` 布尔、服务端总闸、多字节 Cookie、非法日期、后台用户计数、PG 集成（可选）用例。

## 2026-10-20 · 首页双向计算器重构 + 可配置 Hero 背景图

### 首页

- 计算器从「两张手风琴卡」改为「单卡双面」：默认「我想几点醒」，卡顶 `↔` 切换「我想几点睡」；正面时间轮 + 共享入睡耗时 + 动态主按钮；背面推荐结果，第一推荐突出、其余两行弱化；「重新选择」与「换成另一种算法」都只翻转计算卡。
- 时间轮视觉收敛：当前时间 64rpx、上下 28rpx 渐隐；中心带改为极轻底色，去掉上下描边；首页使用局部 token（`#8B87FF / #A7A4FF / 0.94·0.62·0.36 / 0.07`），不改全局色板。
- `top-bar` 新增 `brandOnly`：首页只显示「☾ 睡点」，右侧交给微信原生胶囊。
- 保留广告位、`now-playing`、`share-btn`、入睡耗时偏好与全部计算算法。

### 背景图

- 后台新增「背景图」：≤20 张、分类、启用、排序、COS 上传（jpg/png/webp ≤5MB）、默认图、解锁时长 1–168 小时。
- 上传前浏览器端压缩：jpg/png/webp → 最大 1440×1920、webp 质量 0.82；webp 反而更大或编码失败时保留原图；服务端仍按上传格式存 COS，不做二次转码。上传处提供「保留原图」开关，默认不勾选。
- 服务端配置新增 `backgrounds` / `defaultBackgroundId` / `backgroundUnlockHours`；图片上传进 COS `backgrounds/` 前缀；后台 CSP `img-src` 允许 https 预览。
- 小程序新增 `background-picker`：分类、解锁状态、使用中；默认图免费并静默缓存；非默认图看激励视频解锁，当前图 `{ id, expireAt }` 到期回退默认；选择默认图结束付费图使用。

### 验证

- `npm test`：96 passed / 0 failed（新增背景图纯逻辑 4 条、后台背景图配置/上传 2 条）。
- `npm run check`：3 页面 / 19 JSON / 14 WXML / 15 WXSS，主包约 245.2 KB。
- 未做真机验证：3D 翻转、时间轮滚动、背景图下载/切换/到期需真机确认。

## 2026-10-19 · 广告观测 / 云端副本 / 页内分享 / 跨页音频

### 广告观测

- `ad-slot` 增加槽位标识与 `bindload`/`binderror` 上报：`ad_show` / `ad_error` 带槽位名；服务端 events 白名单、analytics 聚合与测试同步。
- 后台概览新增「广告位观测」：今日/本周展示与失败、近 14 天填充率、分槽展示/失败；上线清单补验收项。

### 数据与信任

- `/api/records/erase` 支持 `cloudOnly:true`：只删除云端记录/墓碑/解锁/事件，**不写 `user_erasures`**，本机记录不会被下次同步清掉。
- 关闭云备份时若存在云端副本，二次确认「删除云端」；统计页提供独立「删除云端副本（保留本机）」入口。
- 新增 `server/test/erase-cloud.test.js`，锁定「删云端后可再次上传」。

### 分享

- 新增 `share-btn` 组件（`button open-type=share`）；计算器两个结果面、入睡页、统计页海报区共四个入口。
- `onShareAppMessage` 按场景动态生成标题：计算结果、昨晚睡眠、本周打卡/连续天数；统计页补 `from=share`；海报为空时不再传空 `imageUrl`。

### 跨页音频

- 新增 `now-playing` 组件，首页与统计页挂载：声音入口仍在入睡页，播放后其他页出现迷你条，可暂停/继续/停止、点击回到入睡页。
- 只监听 `play/pause/stop`，循环重播仍由 `audio-dock` 负责，避免多实例重复 `replay`。

### 数据本地化收口

- 事实回顾新增客户端 `localFact()`：未开启云备份时本地生成与服务端同口径的模板文案，不再请求 `/api/summary`，功能不降级。
- 新增后台开关 `features.events`（默认开）：关闭后 `events.track` 连本地队列都不写，广告观测与行为统计一并停止。

### 验证

- `npm test`：90 passed / 0 failed（新增本地事实回顾 2 条）。
- `npm run check`：3 页面 / 18 JSON / 13 WXML / 14 WXSS，主包约 229.1 KB。
- 未做真机验证：迷你播放器与原生广告的实际层叠、分享卡片图、广告位填充率需真机确认。

## 2026-10-19 · 深度代码审查修复（广告位 / 云备份 / 打卡闭环）

### P0

- **清除数据不再被云端绑死**：未开启云备份时本地立即清除，云端删除降级为 best-effort；已开启路径失败时给「只清本机」出口（`stats.js`）。
- **后台保存配置未携带 `ads` 不再清零展示位**：`validateConfig(input, base)` 用当前配置兜底，`config-store.save` 传入 `current.config`；补回归测试。

### P1

- `ad-slot` 加载失败后可在回到页面时重试（最多 3 次），`unitId` 变化立即重置；加载中保留最小占位高度，避免下方内容跳动。
- 配置刷新：`ads.apply` 走 `loadConfig(false)` 的 10 分钟 TTL；统计页下拉刷新强制拉取；后台排障文档同步修正。
- 云备份开关反馈：开启后立即显示「正在首次同步」，失败显示「同步失败」；取消开启确保 switch 视觉回滚；`stale` 响应不再误报「已同步」。
- 覆盖今晚写入失败不再假成功：`markSleep()` 返回 boolean，按结果提示；跨日记录区分「覆盖」与「新增」文案。
- 跨午间起床后入睡页不再回退为「未记录」：回看 12 小时内完成记录，跨日显示「已记入 X 月 X 日」。
- 统计页空态：内容位广告与「清除数据」入口按 `hasData` 隐藏；空态云备份改为「从云端恢复」；`onLoad` 先 refresh 避免一帧空态闪烁。
- 服务端 `features.sync` 补为真正的总闸：关闭时 `/records/sync` 返回 403 `FEATURE_OFF`；`/records/erase` 不受影响。

### P2

- 后台展示位复选框不再被 `flex` 拉伸；入睡页广告位与撤销入口增加间距；「用现在的时间」不再写入永久偏好。

### 数据本地化边界

- 事实回顾已改为本地模板生成（见下一段「数据本地化收口」）；打卡事件 `checkin` 不再携带具体睡眠日，只保留「发生了一次打卡」。
- 匿名事件只含类型、音频 id 与时间，不含睡眠明细；后台 `features.events` 开关已在下一段落地。

### 明确未修（下一阶段）

- 关闭云备份后云端历史副本无法单独删除；跨页音频控制缺失；页内无分享入口；广告埋点与看板；计算器 `onShow` 结果过期等。

### 验证

- `npm test`：87 passed / 0 failed（新增同步总闸、ads 兜底两条）。
- `npm run check`：3 页面 / 16 JSON / 11 WXML / 12 WXSS，主包约 216.5 KB。

## 2026-10-19 · 商业口径与页面展示位预留 / 云备份默认关闭

### 对外口径

- 落地页删除“不弹窗”“看广告解锁”等承诺，统一为“零登录、零授权、数据默认只存本机”；不再对外声明有没有广告，给后续广告联盟/广告位留出空间。
- 落地页功能卡与 H5 演示描述同步去掉广告字样；README/context/架构文档口径对齐。

### 页面展示位（ADR-020）

- 新增 4 个可配置广告槽：首页最下方、入睡按钮下方、统计页内容下方、统计页最下方。
- 服务端下发 `ads.{home,sleep,stats,statsFooter}`（`enabled/unitId/type`）；后台“广告与解锁 → 页面展示位”逐槽开关、填 ID、选原生模板/Banner。
- 新增小程序 `ad-slot` 组件：未启用、无 ID 或加载失败时静默不渲染，不留空白。
- 音频解锁继续保留“可选看激励视频解锁”；未配置广告位时直接放行，行为不变。

### 云备份（ADR-019）

- 云备份改为**默认关闭**：`storage.getSyncEnabled()` 默认 false；`syncNow` 在未开启时直接返回 `{ skipped: 'sync_off' }`，一次请求都不发。
- 统计页改为开关 + “开启说明”（匿名标识、仅上传睡眠时间、可随时关闭）；开启后立即同步一次。
- 关闭开关不删除云端历史数据；彻底删除仍走“清除数据（云端+本机）”。

### 验证

- `npm test`：85 passed / 0 failed（新增“启用的展示位缺少广告位 ID 会被拒绝”）。
- `npm run check`：3 页面 / 16 JSON / 11 WXML / 12 WXSS，主包约 211.5 KB。
- 改动 JS 全部通过 `node --check`。

## 2026-10-19 · 分享入口、来源归因与海报小程序码（P6 批次 A/B）

### 分享与增长

- 三页补齐转发入口（原仅统计页可转发）；计算器页开放"分享到朋友圈"（单页模式兜底，入睡/统计页依赖本地存储刻意不开）；分享路径预埋 `from=share` / `from=timeline`。
- 新增 `utils/launch-source.js`：启动来源归一化为 `scene|path|from` 写入 `app_open.target`；后台看板新增"打开来源 Top 5"（scene 码映射可读标签）。
- 新增 `GET /api/share/qrcode`：stable_token（不顶掉线上 token，进程内缓存）+ `getwxacodeunlimit`，code 鉴权 + 3 次/分/IP 限流；月度海报底部画小程序码（4s 拉码窗口，失败自动回退"微信搜索「睡点」"落款）。
- `deploy/dev.ps1` 从根目录 `.env` 增量读取 `WX_APPID/WX_SECRET`（本地不覆盖 dev 参数）；`.env` 已就位真实微信密钥，本地可跑通小程序码链路。
- 决策固化：ADR-017 不做小程序内付费内容；ADR-018 分享只做拉新、不做"分享解锁"。

### 交互

- 时间轮升级为"电表滚筒"立体效果：逐行 `rotateX + perspective` 弧面变形、上下透明度衰减、实时中心高亮 + 状态条，分钟列改 0–59 完整循环（59→00 连续），整体高度 440rpx → 380rpx。

### 验证

- `npm test`：77 passed / 0 failed（新增 launch-source 5 条、analytics 聚合 3 条、wx 小程序码服务 4 条）。
- `npm run check`：3 页面 / 15 JSON / 10 WXML / 11 WXSS，主包约 197.5 KB。
- 内存模式冒烟：`app_open` 归因上报 → 看板 `topSources` 聚合闭环；`/api/share/qrcode` 缺 code 400、密钥不可用 503，均优雅报错。
- 待真机/发布后验收：朋友圈单页打开、激励视频、海报扫码进入小程序。

## 2026-10-19 · 同步/删除/解锁/交互加固

### 功能闭环

- 激励视频 `onError` 结算 + 45s 超时；unlock-sheet 在 loading 时仍可取消；audio-dock 用 `_unlockSeq` 作废在途回调。
- 事件队列每次最多 20 条分片发送，成功按 id 删除；4xx 丢弃本批、网络失败退避；`clearAll`/统计页清除会清空队列。
- 同步改为服务端以 `bedAt` 重算 `day`；单条脏数据（倒挂、>20h、时间戳越界）丢弃并返回 `dropped`，不再整批 400。
- 撤销打卡上传 `deletedDays`；新增 `sleep_record_deletions`。全量清除新增 `user_erasures` 水位；旧设备/在途 sync 不能复活已删数据。
- PG `saveUnlock` 覆盖写（DELETE+INSERT），解锁 TTL 调整立即生效；后台 `activeUnlocks` 改 distinct。
- C 态 18:00 后提供“再记今晚（覆盖今天旧记录）”，解决白天小睡堵住当晚打卡；独立 `nap` 仍是下一迭代。

### 数据与稳定性

- `safeSet`/`saveRecord`/`setPending` 返回写入结果；打卡写入失败保留 pending 并提示，不再假成功。
- `updatedAt` 限定 `[now-400d, now+1d]`；极大时间戳不再触发 `RangeError` 500。
- 定时关闭持久化 `endAt/pausedRemaining`，onShow/onEnded 恢复；暂停/恢复不再重置整段。
- 登录改为 `withLogin` 串行执行“取 code + 业务请求”，避免并发 code；sync/events/unlock/erase 全部接入。
- 配置启动强制拉取，后台保存后重开小程序立即生效。
- 计算器 `nowText` onShow 刷新；事实回顾区分 `unavailable`；热力图默认滚到最新周；海报加防重入和 8s 超时。

### 安全与部署

- compose API 端口改为 `127.0.0.1:3000:3000`，不对公网暴露。
- 未设置 `ADMIN_PASSWORD` 时不再使用 `password123`，改为随机临时密码；`securityReady` 只认显式 secret。
- 畸形后台 Cookie 不再 500；`X-Request-Id` 限字符集；records/sync 使用独立限流桶。
- 后台“用户数据”删除增加“必须重新查询同一 openid”校验。

### 验证

- `npm test`：65 passed / 0 failed（新增 sync-v2、audio-timer、login、sync-merge 等）。
- `npm run check`：3 页面 / 15 JSON / 10 WXML / 11 WXSS，主包约 187.2 KB。
- 本地 PG：`syncRecords` 的 day 归一化/墓碑/erasure 事务、`saveUnlock` 单行覆盖实测通过。
- 开发者工具：三页编译、实际 sync、热力图滚动、C 态按钮、无 console error。

### 未完成 / 已知边界

- 真机锁屏音频循环、JS 完全冻结时的定时精度、激励视频、COS 上传、海报导出仍需真机验收。
- 后台网页改密码仍走 `.env` + 重启。
- 独立 `nap` 实体、H5 新结构、海报 Canvas 2D/DPR 高清未做。
- 常用操作已固化为 [docs/10-operations.md](10-operations.md)。
