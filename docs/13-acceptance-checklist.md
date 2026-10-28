# 睡点 · 验收清单（提审前总表）

> 2026-10-22 建立。本表合并此前散落在 `context.md` 第 5/7 节、changelog 各轮"未真机验收"备注、README「仍未验证」与 PRD 第 8 节的全部验收项，按**能不能在本机做**分三区，每项标注来源轮次。
>
> 判定口径：**机验** = 微信开发者工具模拟器（本机 CLI 已完成）；**真机** = 必须 iOS/Android 真机；**外部** = 依赖服务器/账号/运营输入，不是代码问题。

## 1. 本机已验收（2026-10-22，CLI 模拟器 390×844 实测）

以下项目前已用 `wechatide` CLI 走完，控制台无 error/warn，结论可复用；**真机如发现渲染差异仍可对照本表回查**。

> 截图约定（2026-10-25 起）：登记到本表的证据图一律命名 `docs/assets/l4-*.png` 并入库；`review-*.png` / `test-*.png` 是临时探针图，已 gitignore，**不得作为证据引用**。无图时写明取证命令与返回值。命令清单见 `context.md` §8。

### 1.1 三页基础（PRD 第 8 节）

- [x] 冷启动进计算器页，无授权弹窗、无登录页；390×844 下顶栏/灵动岛/tabBar 渲染正常。
- [x] 计算器：双向模式胶囊、12h 时间轮（07:30 + 上午）、「今天 早晨 07:30 起床」上下文行、5/10/15/20/30 耗时档（默认 15）、CTA「计算我的睡点 →」、脚注非医疗表述。
- [x] 统计页空态：指标区（本周无记录时回退「最近 7 天」并标注周期，见 1.34；仅在无任何完成记录时才是「还没有完整记录」）、当月日历空格可切月、「这个月还没有完整记录」、分享 + 近 30 天回顾、数据与备份折叠（仅存本机）。
- [x] 入睡页 A 态（0 数据）：「我准备睡了」圆环、补记入口、**「本周 X 天 · 连续 Y 天」统计行 0 数据不渲染**（`weekCount=streak=0` 实测隐藏）。
- [x] 三页均挂 `<custom-tab-bar>`，计算器/入睡/统计可点击切换，选中态正确。

### 1.2 入睡页 2026-10-22 改版（context.md 第 19 条）

- [x] B 态 overdue：圆环显示入睡时刻 + 已睡时长；「该结束入睡啦」提示条可点开结束面板。
- [x] 结束面板：可改入睡/起床时间；「归入 10月22日（醒来日）· 时长 2 小时 17 分」预览；短睡提示「如果是中途醒来，保存后可以再记一段」在场。
- [x] C 态：大数字 = 在床时长（2026-10-27 由「当天总睡眠」改名；单段「在床时长」/ 多段「当天在床（含午休/间断）」）；时间线同口径（单段「上床/起床」，多段「当天首段上床/当天末段起床」——多段文案有单测 `sleep-page.test.js` 锁定）。
- [x] C 态同行 CTA：「继续入睡（开始计时）」主按钮 +「补记入睡」次按钮同一行；「记录有误？撤销当天记录」位置不变。
- [x] 段列表：每行右侧「修改 / 删除」两个文字按钮（加粗、异色、无边框）。
- [x] 删除确认弹窗：唯一段时标题「删除当天唯一一段?」+「删除后当天的记录会一起撤销」；取消后记录保留。
- [x] 统计行有数据时渲染：「本周 1 天 · 连续 1 天 · 查看统计 ›」，点击进统计页。

### 1.2.1 睡前熄灯（2026-10-22，context.md 第 20 条）

- [x] 打卡即熄灯：点圆环后整页毛玻璃压暗（背景仅剩模糊轮廓），只留熄灭态入睡时间 + 顶部「晚安」+ 底部「轻触任意处唤醒」，tabBar 已隐藏（底部无 tab 图标）；截图 `docs/assets/sleep-lights-out.png`。
- [x] 点任意处唤醒：恢复全亮与 tabBar，仍处睡梦中（未结束计时）。
- [x] 30s 自动回熄灯：唤醒后实测 34s 重新变暗，orb「已睡」随时钟更新（0→1 分钟）。
- [x] console 无 error/warn。

### 1.2.2 文案中性化（2026-10-22）

- [x] 睡梦中：「这一觉开始了 / 醒来后记得回来记录起床。」；空闲态：「等待入睡 / SLEEP LOG / 记录入睡这一刻，醒来后再记起床。」——全文无「夜色/明早/今晚/今夜」（元素文本读取实测）。
- [x] 熄灯层顶部「已入睡」（原「晚安」）；计算器 hero 去除夜间词（原「今晚，几点睡？」），口径于 1.10 定为「标题=你要选的时间」。
- [x] console 无 error/warn。

### 1.2.3 动作词统一 + 完成态每日一句（2026-10-27）

- [x] 空闲态圆环提示「点击圆环，记录入睡」（原「轻触圆环，记录入睡」），与睡梦中「点击圆环、结束入睡」统一为「点击」；`sleep-page.test.js` 锁定两态文案。
- [x] 完成态页脚改为「每日一句」：按 `dateKey` 取模、同日恒定；带公版出处小字（如「《庄子·大宗师》」）；语录缺失时回落原按时段收尾句。截图 `docs/assets/l4-sleep-quote.png`。
- [x] 入睡页（空闲/睡梦中）页脚仍是固定文案「愿这一觉安稳 / 放轻松，慢慢睡。」，不带出处行——睡前页保持极简。
- [x] 语录库 16 条（`utils/sleep-quotes.js`）全部公版，单测锁定：每条有出处、≤24 字、不含「今晚/今夜/夜色/晚安/昨夜/明早」、整轮不重句、非法日期返回 null。
- [ ] **未真机**：语录在小屏（iPhone SE 375×667）是否折两行、出处行是否与底部迷你播放条重叠——本机 390×844 无播放条时完整可见，播放条展开态会压住倒数两行（属 audio-dock 固定定位，另案）。

### 1.2.4 入睡耗时接入打卡 + 上床/入睡拆分（2026-10-27，方案 B + C 第一步）

- [x] 计算器本次会话选的档位经 `app.globalData.fallMinutes` 交给入睡页（不落 prefs：PRD 定的是「每次默认 15、会话内可调」）；打卡时快照进 `pending.fallMinutes`，存储白名单已放行，第二天冷启动仍有效。
- [x] 入睡页「预计起床」不再写死 15 分钟（`defaultExpectedWake` 读档位）。
- [x] 结束面板三格：上床 / 入睡 / 起床；入睡默认 = 上床 + 档位，放得下才预填。390×844 实测 15 分钟档：`22:51 → 23:06 → 06:06 · 时长 7 小时 15 分`，说明行「入睡按 15 分钟入睡耗时预估，可改成你真正睡着的时刻」。截图 `docs/assets/l4-sleep-onset-sheet.png`。
- [x] 入睡跨午夜（23:45 上床 → 00:00 入睡）时按次日解析，`rangeBetween` 不再算成 31 小时假段（单测锁定）。
- [x] 段太短（放不下一个完整档位）时不预填入睡、不显示说明；补记 / 编辑面板保持两格。
- [x] 保存后 `record.sessions[0].sleepAt` 落库（实测 23:06），完成态时间轴左标签「上床」，并显示「入睡 23:06 · 睡着 7 小时 00 分 · 效率 97%」。截图 `docs/assets/l4-sleep-onset-done.png`。
- [x] 服务端 `validate.normalizeSession` 白名单放行 `sleepAt`（否则云备份回拉丢字段）；越界只丢字段不丢记录。
- [x] **统计口径仍未变**：`durationMin` 仍是 `endAt - startAt`（在床口径）。是否切到 `endAt - sleepAt` 见 1.2.5 的结论：暂不切。

### 1.2.5 口径命名收敛 + 睡眠效率（2026-10-27，L4 交付）

- [x] 完成态大数字标签动态化：单段「在床时长」/ 多段「当天在床（含午休/间断）」，不再写死「当天总睡眠」。
- [x] 睡眠效率（睡着 / 在床，仅主段、仅当有 `sleepAt`）：完成态一行「入睡 23:00 · 睡着 7 小时 00 分 · 效率 97%」；无标记的老记录不显示该行。截图 `docs/assets/l4-sleep-efficiency-done.png`。
- [x] 统计页「平均入睡」→「平均上床」，展开说明补「按上床到起床算」，「0 点后入睡」→「0 点后上床」。截图 `docs/assets/l4-sleep-efficiency-stats.png`。
- [x] 日期详情主行「首段 X 入睡」→「首段 X 上床」，实测「22:45 上床 → 06:00 起床 · 共 7 小时 15 分」。截图 `docs/assets/l4-sleep-efficiency-detail.png`。
- [x] 刻意保留「入睡」的 3 处事件描述：空态「去入睡」、补记面板时间标签、进行中状态「已记录入睡，还没有结束时间」。规则写进 changelog：精确时刻说「上床」，事件说「入睡」。
- [ ] **不做 TST 切换（决策，非遗漏）**：`sleepAt` 默认值 = 上床 + 档位，不改的用户会得到恒等于「在床 − 15 分钟」的假测量；且无法区分「认可默认」与「没看」。待「改入睡时刻的用户占比」数据后再评估。
- [x] 窄屏机验（iPhone 12/13 mini 375×812）：完成态效率行一行放得下（未折行）、统计页三列「7h15 / 平均睡眠 · 22:49 / 平均上床 · 06:04 / 平均起床」不挤压。截图 `docs/assets/l4-sleep-efficiency-mini.png` / `docs/assets/l4-sleep-efficiency-mini-stats.png`。
- [ ] **未真机**：iPhone SE（375×667）高度更矮，完成态需滚动才能看全段列表与语录；效率行文案在 12px 系统字体放大档下是否折行。

### 1.3 统计页 2026-10-21 改版（context.md 第 21 条）

- [x] 3 列核心指标：平均睡眠（在床口径）/ 平均上床 / 平均起床，卡面只有大数字 + 短标签（2026-10-27 起对比副标下沉到点击展开的说明卡）。
- [x] 指标展开卡：点「平均睡眠」展开 3 行——「本周 1 天平均 2 小时 17 分，含午休与间断段」「本周平均比常见 7.5–8 小时少 5 小时 13 分」「每天都是 2 小时 17 分」；再点收起。
- [x] 打卡日历：当月 92×76rpx 扁格（列距 4rpx / 行距 16rpx）、4 档色阶、22 日数据格显示 2.3h、今天内描边；周期切换（当月/3/6/12）可见。
- [x] 空格补记（2026-10-22 三轮改版）：格内「补记」文字直接弹**页内**补记面板（醒来日 + 入睡/起床 + 时长预览 + 保存），不跳入睡页；保存后格子变色、本月计数 +1、tabBar 恢复；点有记录日仍出详情卡（已记录/夜间拆分）。旧链路（写 meta.manualDay 跳页）已移除，入睡页兼容消费逻辑保留。
- [x] 补记双入口一致性（2026-10-22 L4 评审整改）：统计页与入睡页的默认时间/五类错误文案/保存入参/可补记窗口统一走 `utils/manual-sleep.js`，面板样式统一走 `styles/sheet.wxss`；两页实测——统计页补记 10月16日 8 小时落库 source=manual、入睡页「补记入睡」默认 30 分钟前→现在并落库；`manual_sleep` 事件已被服务端接受。
- [x] 可补记窗口收口（评审复审修正）：下限对齐云同步窗口 400 天（`EDIT_WINDOW_DAYS` = `SPAN_DAYS`，sync-chunk 测试锁死）——窗口外空格不显示「补记」、点击详情卡说明「超出可补记范围」，避免补了却永远不上云的静默丢失；模拟器实测 2025-08 全月 canAdd=0、窗口内空格仍可弹面板。
- [x] 云同步/清除数据保持折叠态，只露同步状态。

### 1.4 音频链路（模拟器部分）

- [x] 声音抽屉、迷你播放器、定时关闭、解锁面板：2026-10-20/21 两轮已在模拟器截图核对（见 changelog），本轮未重复。
- [ ] **模拟器无法覆盖**：BackgroundAudioManager 真机行为（见第 2 区）。

### 1.5 计算器页 Hero 文案与顶栏动作（2026-10-22）

- [x] Hero 文案随模式切换：起床模式「想几点起？」/「选一个起床时间，找到适合你的睡点。」；入睡模式「想几点睡？」/「选一个入睡时间，找到适合你的起床时间。」（口径于 1.10 修正为「标题=你要选的时间」；两个方向都不写「今晚/明早」——白天小睡时结果会落在当天，陈述必须始终成立）。
- [x] 「换背景」位于顶栏右侧、贴微信胶囊安全距离（`top-bar` 的 `actionText` 位），Hero 大标题恢复满宽；真实坐标点击可打开背景选择器（`bgOpen: true`，存活标记确认非重编译）。
- [x] 入睡页与统计页共用同一顶栏组件、未传 `actionText` → 只渲染品牌/标题，无动作按钮、无布局位移。

### 1.6 L4 审查 P1 修复（2026-10-22，CLI 模拟器实测）

- [x] 统计页空月切月：`‹` 后标题变「2026年9月」、日历重渲染、`canNextMonth=true`（`‹`/`›` 双向可用）；截图 `docs/assets/l4-p1-stats-prev-month.png`。
- [x] 计算器凌晨跨日：锚点 02:00、入睡 01:00（超 30 分钟宽限）→ 主推荐「明天 早晨 08:45」，note「明天 01:00 上床；后半夜 REM 更集中…」；截图 `docs/assets/l4-p1-result-tomorrow.png`。
- [x] 结果面改「入睡耗时」不清锚点（单测锁定，模拟器走查无跳日）。
- [x] 熄灯早退：打卡 → 点触唤醒 → 60s 内点圆环（「刚睡下」不开面板）→ 等待 32s 自动回熄灯（`dim=true`）。
- [x] 声音抽屉关闭后恢复熄灯倒计时（单测锁定；模拟器抽屉开关无异常）。
- [x] 编辑段入睡晚于起床：面板直接显示「入睡时间需早于起床时间，请检查醒来日」，不能保存（单测锁定）。
- [x] 统计页补记与进行中睡眠重叠：专用错误文案，保存被拦（单测锁定）。
- [x] console 无 error/warn。
- [ ] 待真机：切月连点手感、熄灯早退 toast 与 30s 回熄灯的触感、音频弱网切歌竞态（本次仅单测 + 逻辑收敛）。

### 1.7 L4 阶段 A/B 修复（2026-10-22，CLI 模拟器实测）

- [x] 统计页「比上周同期」文案：本周 3 天、上周同期 6 天造数后显示「与上周同期持平」（同期口径生效，非完整 7 天）。
- [x] 日历 3→12 个月：组件去重签名由 `3|2026-08|2026-10` 变为 `12|2025-11|2026-10`，视图停在最新月 2026-10；截图 `docs/assets/l4-b-calendar-12m.png`。
- [x] 月历空格「补记」20rpx、图例 20rpx 去 opacity：真机尺度下可读（截图 `docs/assets/l4-b-stats-data.png`）。
- [x] 入睡页 C 态「时间不准可修正」可读、音符位于右下安全位（截图 `docs/assets/l4-b-sleep-done.png`）。
- [x] 注入 `sessions: []` 记录：回退 v1 后正常渲染 `firstBed=00:00`，页面不崩。
- [x] 注入「无可用段」记录：`recordView=null` + 提示「这条记录缺少可用的睡眠段，可撤销后重新记录」，页面不崩。
- [x] console 无 error/warn。
- [ ] 待真机：容量预检文案的按钮热区、背景切换确认弹窗（需真实付费解锁态）、墓碑时钟偏差（需两台设备/改系统时间）。

### 1.8 L4 视觉批次（2026-10-22，CLI 模拟器截图）

- [x] 主按钮一套化：首页「计算我的睡点」、补记面板「保存补记」、解锁面板「观看视频」均为亮紫底深字（`docs/assets/l4-v-home.png`、`l4-v-manual-sheet.png`、`l4-v-unlock-sheet.png`）。
- [x] 底部弹层统一：36rpx 圆角 / 深底 / 64×5 抓手 / blur 遮罩；背景选择器与补记面板、解锁面板观感一致（`l4-v-bgpicker.png`）。
- [x] 空态去星点：统计空态只剩 3×3 格（`l4-v-empty.png`；月牙于 1.15 二次修正移除）。
- [x] 底部安全区补 `env(safe-area-inset-bottom)`（模拟器 safe=0 无视觉变化；真机待确认）。
- [x] console 无 error。
- [ ] 待真机：安全区实际数值（iPhone 底部 34pt）、blur 在低端 Android 的降级观感、年视图 16rpx 日号在 OLED 小屏的可读性。

### 1.9 L4 阶段 C（2026-10-22，工程护栏，单测 + 本机）

- [x] 生产环境未设置 `TRUST_PROXY` 启动失败；显式 `0`（直连）与 `1`（反代）均可启动（`server/test/config.test.js`）。
- [x] `/records/sync` 同一 openid 第 31 次返回 429（`server/test/records-sync-limit.test.js`）。
- [x] 归档日固定北京时间：`calendarDayKey` 的 UTC 边界（23:59/00:00）与 `sessionDay` 跨时区用例（`tests/time.test.js`、`tests/sessions.test.js`）。
- [x] `audio_error` 事件被服务端接受，target 保留 `trackId|code`（`server/test/api.test.js`）。
- [x] 模拟器三页无回归、console 无 error。
- [ ] 待真机/部署：`docker compose` 实际启动参数（`TRUST_PROXY` 默认 1）、出境设备实测（改系统时区后记录不再重复）。

### 1.10 计算器文案口径修正（2026-10-22，CLI 模拟器 390×844 实测）

- [x] 起床模式：Hero「想几点起？」/「选一个起床时间，找到适合你的睡点。」+ 胶囊「选择起床时间」+ CTA「计算我的睡点 →」；点计算后结果标签「推荐入睡时间」（截图 `docs/assets/l4-calc-wake.png`）。
- [x] 入睡模式：Hero「想几点睡？」/「选一个入睡时间，找到适合你的起床时间。」+ 胶囊「选择入睡时间」+ CTA「计算我的起床时间 →」；结果标签「推荐起床时间」（截图 `docs/assets/l4-calc-sleep.png`）。
- [x] 标题 / 副标 / 胶囊 / CTA / 结果标签五处同侧；旧文案「想几点入睡？」「换成我想几点醒」零残留（元素文本读取 + `tests/calc-copy.test.js` 5 条锁定）。
- [x] 结果面「换成我想几点起 ⇄」切回起床模式，标题同步「想几点起？」，结果回到「推荐入睡时间」。
- [x] 落地页手机演示同步「想几点起？」/「设定起床点，倒推你的入睡点」。
- [x] console 无 error。

### 1.11 计算器入睡上下文与结果图标（2026-10-22，CLI 模拟器 390×844 实测）

- [x] 入睡模式时间轮下：选 22:30 →「今天 晚上 22:30 入睡」（不再显示「当前 15:41」）；选 08:00（已过 30 分钟宽限）→「明天 早晨 08:00 入睡」，与结果面翻日口径一致（截图 `docs/assets/l4-calc-sleep.png`）。
- [x] 起床模式不回归：仍显示「明天 早晨 07:30 起床」，且随分钟刷新翻日。
- [x] 结果头图标：入睡模式「推荐起床时间」为太阳（`result-ico is-sun`，截图 `docs/assets/l4-calc-sleep-result.png`）；起床模式「推荐入睡时间」为月牙（`result-ico is-moon`）。
- [x] 「当前 HH:MM」提示与 `nowText` 死状态已删除。
- [x] console 无 error。

### 1.12 计算器「充足/补觉」附加档（2026-10-22，CLI 模拟器 390×844 实测）

- [x] 起床模式：主推荐 23:45（5 个周期）不变，列表 01:15 偏短 / 02:45 不足 / **22:15〔补觉〕6 个周期 · 充足**（虚线分隔、薄荷色），截图 `docs/assets/l4-calc-wake-recovery.png`。
- [x] 入睡模式（23:00 上床）：主推荐 06:45，列表 05:15 / 03:45 / **08:15〔补觉〕6 个周期 · 充足**，截图 `docs/assets/l4-calc-sleep-recovery.png`。
- [x] 补觉档不抢主推荐：主推荐仍取 5/4/3 中第一个未过期的档位（`tests/plan.test.js`、`tests/index-page.test.js` 锁定）。
- [x] 上床时刻已过时不渲染补觉行（`tests/index-page.test.js` 23:00 用例；模拟器无法改系统时间，该分支以单测为准）。
- [x] console 无 error。

### 1.13 计算器「为什么是 90 分钟」说明层（2026-10-22，CLI 模拟器 390×844 实测）

- [x] 脚注整行可点：「按 90 分钟周期计算，仅作时间参考　为什么是 90 分钟？›」，点击打开底部说明层（截图 `docs/assets/l4-calc-note.png`、`docs/assets/l4-calc-why-sheet.png`）。
- [x] 内容为事实陈述：一轮常见 70–120 分钟、平均约 90 分钟；8 小时 = 5.33 个周期且注明“8 小时本身没问题”；5 个周期 = 7.5 小时；结尾「不构成医疗建议」。
- [x] 打开时 tabBar 隐藏（独立 root，页面 z-index 压不住），关闭 / 点遮罩 / 页面 onHide 均恢复；实测 `tabHidden: true → false`，`whyOpen` 复位。
- [x] console 无 error。

### 1.10 订阅消息后台可视化配置（2026-10-22，本机 API 闭环）

- [x] 后台新增「小程序与提醒」面板：启用开关、模板 ID、跳转路径、获取步骤、只读运行环境（HTML 结构 + `node --check` 通过）。
- [x] 真实实例（内存模式 3199）走通：登录 → 保存模板 → `/api/config` 下发 `{enabled:true,templateId,page}` → `/api/admin/env` 返回 `appidConfigured/secretConfigured/trustProxy/dbMode`，响应中不含任何密钥值。
- [x] 单测：模板 ID 非法 / 跳转路径非法被拒；后台配置优先于 env；后台关闭后 `/api/reminders` 立即 503。
- [x] 字段映射：后台可配 `thingKey`/`timeKey`，`time1`+`thing2` 发送键与内容正确（`server/test/reminders.test.js`）。
- [ ] 待真机：微信订阅授权弹窗、到点送达、点击直达结束面板（需真实模板 ID 与 AppSecret；建议先用「睡觉到点提醒」模板走通，再换正式模板）。
- [ ] 待浏览器：后台面板视觉过目（本机无 Playwright/agent-browser，已完成 API 与静态结构验证）。

### 1.14 计算器结果面留白（2026-10-22，CLI 模拟器实测）

- [x] 4 行结果（3 档推荐 + 补觉）启用紧凑节奏后，分享行完整落在卡片内（热区底 613px < 卡片底 622px），不再压住脚注。
- [x] 脚注与「分享给朋友」拉开呼吸距离（脚注顶 646px，分享热区底 613px，视觉留白约 33px），入睡/起床两方向一致（截图 `docs/assets/l4-calc-note-gap.png`、`l4-calc-note-gap-sleep.png`）。
- [x] 正面主按钮与脚注间距同步为 48rpx，不显空旷（截图 `docs/assets/l4-calc-note-front.png`）。
- [x] 全部周期已过的紧凑态仍走 `.is-compact`，不与 dense 叠加。
- [x] console 无 error。

### 1.15 统计页空态插画重做（2026-10-22，CLI 模拟器实测）

- [x] 空态只保留 3×3 日历格（月牙移除）：柔光中居中，左上首格亮起，9 格全部可见（截图 `docs/assets/l4-empty-grid.png`；首轮「月牙 + 网格」版本 `l4-empty-redesign.png` 因读成两个图标已废弃）。
- [x] 亮起格为左上第一格（`index === 0`），与「打一次卡，这里就会长出第一格」一致，保留呼吸光。
- [x] 清空本地存储后统计页空态正常渲染，console 无 error。
- [ ] 待真机：呼吸光与小格子在 OLED 暗光下的观感。

### 1.16 统计页「同步」按钮形态（2026-10-22，CLI 模拟器实测）

- [x] 云备份开启后「同步」按钮为「刷新图标 + 同步」的无边框轻量动作，视觉高度 52rpx 与右侧开关轨道（88×52rpx）齐平（截图 `docs/assets/l4-sync-btn.png`）。
- [x] 图标为 CSS 画的开口圆 + 箭头（不用 emoji/字体字形），忙碌态「同步中…」不换行、图标 0.9s 匀速旋转（截图 `docs/assets/l4-sync-btn-busy.png`）。
- [x] 触控热区用 `::after` 外扩到约 43px 高，实际可点范围未缩小。
- [x] console 无 error。

### 1.17 入睡完成态分段时间轴（2026-10-22，CLI 模拟器实测）

- [x] 三段记录（00:09–00:13 / 00:14–00:17 / 00:20–00:39）：轨道按 13.3% / 10% / 63.3% 分段，两处缺口可见，不再是一条连续直线（截图 `docs/assets/l4-sleep-segments.png`）。
- [x] 时间轴下显示「3 段 · 中间醒了 2 次（4 分钟）」，与大数字 26 分钟、首末跨度 30 分钟自洽（原「3 段 · 清醒 4 分钟」因语义不清已废弃）。
- [x] 长间隔（夜间 + 午休）显示「2 段 · 相隔 6 小时 00 分」；零间隔只显示「2 段」（单测锁定）。
- [x] 单段记录仍是一整条轨道，不显示段间说明（`tests/sleep-page.test.js` 锁定）。
- [x] console 无 error。
- [ ] 待真机：短段（1 分钟级缺口）在窄屏上的可见性。

### 1.6 提审前收口（2026-10-23）

- [x] 编辑跨午夜睡眠段（23:30→00:30）可保存：守卫改为按原段是否跨天判断；同日段「入睡≥起床」仍被拦（防午休静默变 23.5 小时）。单测覆盖两向。
- [x] 死组件清理：`heatmap`、`sleep-trend` 删除后全仓零引用，`npm run check`（组件引用校验）与全量测试绿。
- [x] 看板补记聚合：`admin.test.js` 断言 `today.manualSleeps=1 / week.manualSleeps=1`；概览第 5 张卡由 `.stats` auto-fit 网格承载（浏览器点击待人工过一眼）。
- [x] 后台改密闭环（API 全链路已测）：错旧密 401、弱密码 400、改密 200 且旧 Cookie 失效、env 密码失效、新密码可登、审计留痕且无密码材料、库内凭据重建 app 后仍生效。
- [x] 真实进程冒烟：`PORT=3199 DB_MODE=memory` 启动，`/api/ready` 200、`/admin` 含 `data-panel="security"`、`admin.js` 含改密逻辑。
- [ ] **待人工**：后台「安全」面板浏览器点击（填表 → 提交 → 返回登录页）、概览 5 卡在 1280/720 宽度下的换行观感。

### 1.18 代码审查修复轮（2026-10-23，代码 + 单测已验；视觉未过模拟器）

> 对应 [docs/11-changelog.md](11-changelog.md) 顶部「代码审查修复轮」。打开开发者工具窗口被取消，故**视觉项未复验**，统一见 2.5。

- [x] 迷你播放器「停止」接线：`close()` 从死代码变为 `.np-ctrls` 第二颗按钮（`catchtap` 防冒泡），停止会清定时、复位 meta、`audio.stop()`。
- [x] 改密后旧密码不能再伪造管理员令牌：`server/test/admin-auth.test.js` 3 条（旧密码 + 新版本号 401、改密前令牌失效、独立 `ADMIN_SECRET` 行为）。
- [x] 入睡页 tabBar 单一裁决：`syncTabbar()` 覆盖熄灯/结束面板/补记面板/声音抽屉；`onHide` 无条件恢复。单测覆盖熄灯状态机（`sleep-page.test.js` 全绿）。
- [x] 入睡页「补记入睡」默认值：C 态、清晨 07:05、统计页原语义三条单测；默认区间经 `evaluateManualRange` 校验无错。
- [x] 圆均值无解：`metricsOf`/`factsOf` 不再产出「平均 --:-- 入睡」，`tests/stats.test.js` 新增 1 条（00:00 与 12:00 抵消场景）。
- [x] 音频配置自愈：`config.merge` 增加 `degraded`；`audio-dock` 回前台按指纹刷新、下架曲目收口、恢复文案与「到期」区分。
- [x] `now-playing` 缓存误删：补 `cache.isUsable`（与 dock 同口径）。
- [x] 广告重试链超时重置；`/api/reminders` DB 异常 503 + 日志；后台改密审计日志变量兜底。
- [x] 门禁：`npm test` 307/306/1 skip、`npm run check` 通过（主包约 535.2 KB）、改动文件 `node --check` 全通过。

### 1.11 结果面提醒入口与列表呼吸（2026-10-25，模拟器实测）

- [x] 入睡页 sleeping 态文案：「到点提醒我记录起床」；已开启态「已开启 · 到点提醒记录起床」。
- [x] 起床模式结果面：「提醒我入睡」与「去入睡打卡」并排；点击弹订阅授权（模拟器无真实模板时提示“暂未配置”）。
- [x] 入睡模式结果面：「提醒我起床」；4 行（5/4/3 + 补觉）dense 布局不溢出，底部操作与分享行可见。
- [x] 列表呼吸：行 padding 20rpx（dense 12 / compact 13），主推荐与列表间距 20rpx。
- [x] 服务端 `plan-s-` / `plan-w-` 前缀分别发送「该睡了 / 该起床了」（单测）。
- [ ] 待真机：订阅授权弹窗、到点送达、点击进入入睡页（需模板 ID + AppSecret）。

### 1.12 结果面视觉细化（2026-10-25，模拟器截图）

- [x] 「15 分钟入睡」胶囊高度 64→56rpx，与 46rpx 主时间同排不压主信息。
- [x] 主卡上下呼吸：常规 26rpx / dense 20rpx；4 行 dense 底部操作与分享不溢出。
- [x] 「提醒我入睡 / 起床」24rpx（dense 22）、图标 22rpx，与主 CTA 同重量。
- [x] 「去入睡打卡」按内容宽靠右（flex:none + margin-left:auto），不再拉满整行。
- [x] 「重新选择 / 换成我想几点睡·起」为一对实底/描边 pill；「分享给朋友」为图标+文字。
- [x] 截图 `docs/assets/l4-v2-result-wake.png`、`l4-v2-result-sleep.png`；console 无 error。
- [ ] 待真机：图标分享按钮热区、320px 窄屏下 `result-actions` 两个 pill 是否换行。

### 1.13 播放后自动缓存（2026-10-25，模拟器实测）

- [x] 清空缓存后播放：`已缓存 0/1 首 · 0.0 MB`，Wi-Fi 下自动缓存定时器立即排队。
- [x] 25 秒后：`已缓存 1/1 首 · 5.4 MB`（自动下载完成，无需看广告）。
- [x] 再次播放：`_expectSrc = http://usr/sleep-audio/…`、`_playingFromCache=true`、正常播放（不再走远程）。
- [x] 修复重播 bug：`play()` 先清 `_badUrls` 再取缓存，避免失败拉黑后已缓存仍走远程。
- [x] 移动网络延迟 15s（`cache.autoCacheDelay('4g') = 15000`，单测）；Wi-Fi 为 0。
- [x] 停止播放/组件卸载会清理未触发的自动缓存定时器。
- [ ] 待真机：4G 下播放 15s 后开始下载、切歌/杀进程重进命中本地、首次与二次播放的流量对比。

### 1.14 Code Review 修复轮与视觉完善（2026-10-25，代码 + 单测已验；**模拟器已复核取证**，真机未验）

> 审查报告与逐条状态：[07-code-review.md §B](07-code-review.md)。本轮关键改动（P2-3 实底按钮、P3-5 统计页空态补记）已截取模拟器实证图入库（`docs/assets/l4-*.png`），其余项以运行时返回值为证（iPhone 12/13 Pro 390×844，console `grep -i error` 为空）。

- [x] 计划提醒落地页按前缀分流：`plan-s-` → `?remind=sleep`、`plan-w-` → `?remind=wake`，打卡会话仍 `?end=1`；已排队旧行在发送时纠正（`server/test/reminders.test.js`）。
- [x] 入睡页 `consumeLaunchIntent`：`remind=sleep` 已打卡也不开结束面板；`remind=wake` 在计时开面板、未计时引导补记；`end=1` 不变；只消费一次（`tests/sleep-page.test.js` 4 条）。
- [x] 计算→打卡：`planTarget` 只消费一次，>12h 或不在 16h 窗口丢弃；打卡 `expectedWakeAt` 取计算结果（单测）。
- [x] 提醒按钮：已过/未配置不弹订阅授权；已设后不再授权；重设撤旧（单测）。
- [x] 自动缓存容量闸 `canAutoCache`（单测）。
- [x] **P2-3 结果面主 CTA 实底化与视觉呼吸优化**（模拟器实测）：`.result-go` 改为 `--btn-primary-*` 实底主药丸按钮（深绿渐变、白色文字与右箭头、`font-weight: 600`），与正面主按钮规则统一；主推荐卡上下呼吸空间拉开（内边距 26rpx，外边距 20rpx）；「提醒我入睡/起床」字号提至 26rpx、图标 25rpx、颜色提升对比度，与上方列表间距拉大至 24rpx（原 6rpx），消除压迫感；4 行 dense 下依然紧凑且 0 溢出（截图 `docs/assets/l4-calc-result-breathing.png`、`l4-calc-result-sleep-breathing.png`）。
- [x] **P3-5 统计页 0 数据态补记入口与视觉优化**（单测 + 模拟器实测）：`empty-state` 组件扩展双动作支持（`secondaryText` + `onSecondary`）；空态主按钮「去入睡」升级为小实底主药丸按钮（`--btn-primary-*`），与次级「补记睡眠」形成分明主次；底部「数据与备份」标题由 24rpx 放大至 28rpx，右侧「展开/收起」字样由 20rpx 放大至 26rpx，层级与易读性显著提升（单测 `tests/stats-page.test.js`；截图 `docs/assets/l4-p3-5-stats-empty.png`、`l4-stats-visual-refined.png`、`l4-stats-settings-open.png`）。
- [x] **入睡页视觉精简与层次提升**（模拟器实测）：移除圆环下方「只记录时间，不做睡眠评价」冗余文案；「补记入睡」改为精致小实底主药丸按钮（`height: 64rpx`，`--btn-primary-*`），与圆环视觉呼应；底部「分享这一段睡眠」由纯文本升级为带矢量分享图标（`variant="icon"`）（截图 `docs/assets/l4-sleep-visual-refined.png`）。
- [x] **统计页有数据态视觉优化**（模拟器实测）：①核心指标区采用上下渐变淡出（64%高）的微光弱竖线做指标隔离，主指标「平均睡眠」强化至 52rpx / 700 纯白高亮并带微光阴影，次级「平均入睡/起床」收敛至 44rpx / 500 次白，主次清晰；②时间跨度选项紧凑化，当前选中项增加 `rgba(255,255,255,0.12)` 简洁无边框弱背景胶囊；③日历图例居中排布（`justify-content: center`），透明度降低至 0.8，不抢日历主体（截图 `docs/assets/l4-stats-data-refined.png`）。
- [x] **计算器结果面动作精简与去线框化**（代码 + 单测已验）：①「重新选择」精简为「‹ 返回」（`result-reset`），与卡片 3D 翻转返回正面的导航心理模型精准契合，字数减半给右侧长文案留出呼吸空间；②`.result-reset` 与 `.result-switch` 移除 `border`，采用柔和弱背景胶囊（`0.08` 柔白与 `0.10` 浅紫），消除生硬 1px 线框感（`tests/calc-copy.test.js` 锁定）。
- [x] **入睡页进行中态（B态）动作重构与弱实心按钮**（代码 + 结构已验）：①「到点提醒我记录起床」升级为简洁无边框弱实心胶囊按钮（`rgba(255, 255, 255, 0.08)`，开启态弱紫微光 `0.22` 高亮）；②次级动作行重构为左右并排：左侧「点错了？撤销本次入睡」，右侧「分享这一段睡眠」，居中 560rpx 优雅两端对齐，消除层叠孤行感，底部 `sleep-share` 仅在非 sleeping 态显示避免重复。
- [x] 模拟器：结果面起床模式（主推荐 23:45 + 01:15 / 02:45 / 22:15〔补觉〕）与入睡模式均为 4 行 dense，「提醒我入睡/起床」与「去入睡打卡 →」同行，底部「重新选择 / 换成…」与「分享给朋友」完整可见，无溢出。
- [x] 模拟器：未配模板时点「提醒我入睡」→ 直接弹「加到手机日历？订阅提醒暂未开放。…」（「不用 / 加入日历」），**未先弹订阅授权**。
- [x] 模拟器：入睡模式 12:37 计算（入睡 12:37 + 15 分 + 5 周期）→ `view.targetWakeAt = 1792930920000`（20:22）→「去入睡打卡」后 `meta.planTarget = {wakeAt: 1792930920000}`、路由 `pages/sleep/sleep` → `markSleep()` 后 `pending.expectedWakeAt = 1792930920000`（20:22，而非白天默认 now+90min ≈ 14:10），`planTarget` 已清空。注：完成态「继续入睡」的原生确认弹窗不响应 CLI 坐标点击，`markSleep()` 通过 `automation_evaluate` 调用（与圆环/弹窗确认同一方法）；取证后已 `clearStorageSync`。
- [ ] 模拟器/真机：「✓ 已设提醒」薄荷色态——需在后台配好订阅模板并授权成功才会出现，本机未配模板，**未验**。
- [ ] 真机：订阅消息「该睡了 / 该起床了」点击后的落地行为（冷启动与热启动各一次）；朋友圈单页模式下结果面不出现「去入睡打卡 / 提醒我」。
- [ ] 真机：4G 播放 15s 后才开始下载、Wi-Fi→4G 切换后不立即下载。

### 1.19 全局按钮与文字触控弱状态反馈（2026-10-25，代码 + 样式全验）

- [x] **计算器页**：
  - 顶部模式切换胶囊（`.mode-capsule`）：`hover-class="mode-capsule--tap" hover-stay-time="120"`，点击响应 `scale(0.97)` + `opacity: 0.76`。
  - 正面：文字链接「用现在的时间」（`.now-link`）配置 `scale(0.97)` + `opacity: 0.52`；预计入睡耗时档位（`.fall-chip`）补充 `:active` 与 `scale(0.94)`；主按钮「计算我的睡点」（`.calc-action`）配置 `scale(0.96)` + `opacity: 0.82`。
  - 结果背面：入睡耗时切换（`.result-fall`）与「提醒我入睡/起床」（`.result-remind`）配置 `scale(0.96)` + `opacity: 0.62~0.65`；主按钮「去入睡打卡」（`.result-go`）配置 `scale(0.96)` + `opacity: 0.82`；底部双药丸「‹ 返回」与「换成我想几点睡/起」配置物理下凹微缩与底色加深；脚注「为什么是 90 分钟？」（`.calc-note`）配置 `scale(0.98)` + `opacity: 0.55`。
- [x] **入睡页**：
  - 中央主呼吸环（`.sleep-orb`）：配置 `scale(0.96)` + `opacity: 0.88`；通知横幅（`.notice`）配置轻按反馈。
  - 进行中态（B态）：弱实心胶囊「到点提醒我记录起床」（`.sleep-reminder`）配置 `scale(0.97)` + `opacity: 0.65`；超时卡片（`.sleep-overdue`）配置 `scale(0.98)`；次级文字链接「点错了？撤销本次入睡」（`.undo-bed`）配置 `scale(0.97)` + `opacity: 0.52`。
  - 空闲与完成态：实底主按钮「补记入睡」（`.manual-entry`）配置 `scale(0.96)` + `opacity: 0.82`；睡眠段「修改/删除」（`.session-op`）配置 `scale(0.94)` + `opacity: 0.5`；完成态双按钮「继续入睡/补记入睡」（`.cta-mini`）配置 `scale(0.96)` + `opacity: 0.76~0.82`；文字链接「记录有误？撤销当天记录」（`.undo`）与底部统计轻量条（`.stats-strip`）均补齐触控反馈。
- [x] **统计页**：
  - 核心指标卡（`.metric`）：增加 `scale(0.97)` 弹性点击感；周期切换选项（`.span-tab`）配置 `scale(0.95)` + `opacity: 0.65`；详情卡「补记一段 ›」（`.dd-add`）配置 `opacity: 0.52`；海报按钮（`.poster-btn`）配置 `scale(0.96)`。
  - 低频设置区：数据与备份「展开/收起」（`.settings-head`）、云备份「同步」（`.sync-btn`）、独立入口「删除云端副本」（`.cloud-del`）与「清除数据」（`.danger-entry`）全面配置物理轻按弱状态。
- [x] **公共层**：
  - 底部通用面板（`styles/sheet.wxss`）：关闭叉号（`.end-close`）、醒来日选择行（`.end-date-row`）、时间项（`.end-time-item`）、主次保存按钮（`.end-btn`）统一定义。
  - 空态组件（`components/empty-state`）：主按钮「去入睡」与次按钮「补记睡眠」增加触控下按弹性与透明度反馈。
- [x] 门禁检查：`npm test` 333 项通过（332 pass / 1 skip）、`npm run check` 检查通过（3 页面 / 22 JSON / 17 WXML / 19 WXSS，主包约 561.9 KB）。
- [x] 顺带回归（本轮未改动，模拟器走查无异常）：打卡即熄灯、点触唤醒；入睡 <60s 点圆环不开面板；结束面板「归入 10月25日（醒来日）· 时长 3 分钟」保存后 C 态时间轨 + 段列表；统计页当月日历当天格亮起；云备份开关默认关闭；「清除本机睡眠数据」二次确认文案完整。

### 1.20 环境音与超期态 L4 模拟器复验（2026-10-26，iPhone 12/13 Pro 390×844）

- [x] **P0 工具链事实**：新增 `utils/player-queue.js` / `player-surface.js` 后仅 `simulator_refresh` 不会把它编进包，`audio-dock` 报 `module ... is not defined` + `Component is not found`，组件整体不渲染。**必须 `close_project_window` + `open_project_window` 触发完整编译**；重开后 console 干净。后续新增文件一律按此复验。
- [x] **播放状态一致性（本轮修）**：修复前实测 `paused:false`（音频真的在播）但 `data.playing:false` / `playerSub:"已暂停"`，是 `waiting` 后基础库不补发 `play` 所致。改为 waiting 只进「连接中」、canplay 与 12s 守卫按真实 `paused` 自愈、4s 补播；复验 `playing:true`、绿色音符在场。
- [x] 跨页迷你条：入睡页播放「雨声」后切计算器，`#np` `visible=true / playing=true / title=雨声`，右下角绿色音符；截图 `docs/assets/l4-audio-mini.png`。
- [x] 抽屉结构：搜索/分类/全部声音/单曲循环胶囊/曲目（已缓存 · 点击播放）/定时关闭（关为默认）/缓存区（已缓存 1/1 首 · 占用 5.4 MB，长按可删单曲）；截图 `docs/assets/l4-audio-sheet.png`。
- [x] 熄灯态：打卡后 `dim=true`、tabBar 隐藏、圆球「入睡时间 + 已睡 N 分钟」、**底部「结束入睡」按钮**、底部「轻触任意处唤醒」；截图 `docs/assets/l4-lights-out.png`。
- [x] 一键结束：点「结束入睡」→ `state=done`、`pending` 清空、记录 1 分钟（打卡 18 秒后结束），页面显示「早安，睡得好吗 / 1 分钟 / 入睡 05:25-05:25」；新增 <5 分钟二次确认防误触。
- [x] 超 24h：`staleLong=true`、标题「这一觉还没结束」、副标「已超过 24 小时，请结束并校准或丢弃。」、常驻卡片两个出口（结束并校准 / 丢弃这段），**原 8s 一次性 notice 已删除（不再同屏重复）**；截图 `docs/assets/l4-sleep-stale-final.png`。
- [x] 丢弃这段：确认后 pending 清空、不写记录、回到 idle；测试数据已清理（`sleep:pending:v1` 删除、`2026-10-26` 记录删除）。
- [x] 统计页日历：空格由「补记」改为轻量「+」，整月 20+ 处重复文案消失；截图 `docs/assets/l4-stats-calendar.png`。
- [x] 结果面 compact（所有周期已过）：主卡「1 小时 45 分」+ 副标「距 07:30 起床 · 已扣 15 分钟入睡」；三行「已过」整行 opacity 0.55→0.88 且标签单独提亮；「‹ 返回」加宽 152rpx；截图 `docs/assets/l4-calc-result-final.png`。
- [x] console 无 error（`grep -i error` 返回空）。

### 1.21 批次 D（2026-10-26，单测/构建已验；模拟器与浏览器未点验）

- [x] 分享深链：`tests/index-page.test.js` 断言 `applyShareQuery({from:'share',mode:'wake',wake:'08:15',fall:20})` 后 `mode/wakeTime/fallAsleep/flipped` 正确且未写本地偏好；分享 path 含 `from/mode/wake/fall`。
- [x] share 事件：`server/test/admin.test.js` 发 `share` 后看板 `today.shares=1 / week.shares=1`；白名单放行。
- [x] 提醒模板快照：`server/test/reminders.test.js` 断言换模板后旧任务仍用 `thing1/time2` 与 `template_id=tmpl-old`，新配置字段不出现。
- [x] 死码清理后门禁：`npm test` 386/385/0 fail/1 skip；`check` 通过（21 JSON / 16 WXML / 18 WXSS，618.6 KB）。
- [x] 国际站：`build:web` 11 页 + `verify:web` OK（内链 3 条，无 404）。
- [ ] 待浏览器点验：后台保存失败按钮态、409 自动重载、清除二维码确认、demo 页小程序码 CTA（需要起服务 + 有后台账号/二维码）。
- [ ] 待模拟器：分享卡片打开后结果面与分享者一致（需真机转发一次或在模拟器用「编译模式 → 启动参数」注入 `from=share&mode=wake&wake=08:15&fall=20`）。

### 1.22 真机反馈：切歌播几秒暂停（2026-10-26，代码/线上资源已验；真机未复测）

- [x] 线上资源核实：`/api/config` 返回 8 条，逐条 `Range: bytes=0-2047` → `206`、`audio/mpeg`、`1.5–11.5 MB`、MP3 文件头正常；**不是坏源/403**。
- [x] 修复①：`autoCacheDelay` Wi-Fi 8s / 移动 20s（原来 Wi-Fi 0ms 会与流播抢带宽）；单测已更新。
- [x] 修复②：`pause` 在 30s 缓冲窗口内且非用户暂停 → 保持「连接中」+ 3s 后重连（≤2 次），不再直接显示「已暂停」；用户暂停/锁屏暂停逻辑不变。
- [x] 开发版 `sleep:dev-api` 覆盖（仅 develop），用于模拟器直连线上配置；release 不读取。
- [x] 后台看板新增「今日分享 / 本周」（数据来自 `analytics.today/week.shares`）。
- [ ] **未复现**：DevTools 走系统代理，`https://sleep.qfmaster.com/api/config` 返回 `status 0`（network 面板 3.0–3.4s 失败），模拟器拿的是本地旧缓存（6 条）；真机带宽竞争场景无法在模拟器还原。
- [ ] 待真机复测：弱网/正常 Wi-Fi 下连续切 2–3 首（含 11.5MB 的「无损轻音乐」），观察是否还出现「播几秒 → 已暂停」。若仍复现，取 `audio_error` 的 `errCode`（`trackId|10003` 之类）区分 `onError` 与 `pause`。

### 1.23 环境音运营可读化（2026-10-26，模拟器截图已取；后台未点验）

- [x] 后台图标下拉：🌧 雨声 / 🌊 海浪 / 🔥 炉火 / 🎚 白噪音 / 🌙 深夜（对应 `icon-*.png`，5 张均在）。
- [x] 后台分类：常用标签（自然之声/环境音/白噪音/轻音乐/助眠音乐/冥想）可点填入；datalist 合并常用项；空分类提示「点下方常用，或自己填」。
- [x] 看板趋势：新增金色分享柱 + tooltip「分享 N」；`max` 与空态判断纳入 shares。
- [x] 小程序：已缓存且非当前曲目的行显示绿色 ⤓，点击 → 二次确认删除该曲缓存；长按同口径；缓存区提示「点曲目右侧 ⤓ 或长按」。
- [x] 已有当前曲目时不再显示「继续上次」（避免与播放条重复）。
- [x] 门禁：`npm test` 385 通过 / 0 失败 / 1 skip；`check` 通过（622.1 KB）；admin.js/admin.css 括号配平。
- [x] 模拟器截图：`docs/assets/l4-audio-list-v2.png`（⤓ 标记、继续上次、分类 chips、单曲循环胶囊）。
- [ ] 待浏览器点验：分类标签点击后 `collect()` 是否写入、图标下拉渲染、趋势分享柱（需起服务 + 后台账号）。
- [ ] 待真机：点 ✓ 删除缓存的确认弹窗与删除后列表刷新（图标 2026-10-28 由绿色 ↓ 改暗灰对勾）。

### 1.24 体验版 P1：迷你条假播放（2026-10-26，模拟器已复现并修复）

- [x] 根因复现（模拟器）：`wx.getBackgroundAudioManager().stop()` 后 `src=false`、`paused=undefined`；调用方 `!paused` 得 `true` → 修复前 `dockPlaying=true / sub="正在播放"`。
- [x] 修复：`resolvePlayerSurface` 严格布尔（`playingNow===true && hasSrc===true`）；`cold = !playing && !sessionLive`；dock/now-playing 传参 `!!audio.src && audio.paused === false`。
- [x] 复验（同一场景）：`dockPlaying=false / sub="已暂停" / currentId=sleep-10001`（入口保留，点按可续播）。
- [x] 单测：新增「无音源时 playingNow 传 true 也必须暂停」「本次进程用户暂停不判冷启动」；`player-surface` 9/9。
- [x] 视觉：已缓存 `⤓+圆框` → 纯粗箭头 ↓；列表播放/暂停去掉圆形描边、三角形与双竖线放大一档；截图 `docs/assets/l4-audio-visual-v4.png`。
- [x] 门禁：`npm test` 388/387/0 fail/1 skip；`check` 通过（624.3 KB）。
- [ ] 待真机：体验版冷启动、锁屏 3 分钟、来电/切 App 恢复、悬浮 X 停止后点续播、收藏连播切歌。

### 1.25 统计页「按本周均值定今晚入睡点」（2026-10-26 交付，**2026-10-27 已移除**）

- 移除原因（用户拍板）：这是统计页唯一的建议型入口，与「只陈述事实、不评价不建议」的产品立场冲突；且均值可能只由 1–3 天得出，用它定"今晚"代表性弱。原验收记录见 `docs/11-changelog.md` 2026-10-26 条；连带的 `onPlanFromAverage` / `meta.prefillSleepMin` / 首页消费块 / 两条单测已删除。

### 1.26 1 年视图缓存 + calendar-strip 恢复（2026-10-26，模拟器已验）

- [x] **误删恢复**：`components/calendar-strip` 曾被我误判零引用删除（`Select-String -Path miniprogram` 未递归），导致 3/6/12 月视图空白；已从 `dd4cceb` 恢复并在 `stats.json` 注册。模拟器复验：12 个月、每月 35 格、9/10 月网格与色阶正常（截图 `docs/assets/l4-stats-year-view.png`）。
- [x] 同类复查：`utils/stats.js` 八个函数确实仍被测试/页面引用（不删）；`fetchSummary`、`regularity` 确认零引用。
- [x] 缓存：`recordsStamp` + 视图参数为 key，命中复用 `calendarMonths`；模拟器实测同一数据第二次 `refresh` **1ms**。
- [x] 单测：同数据命中缓存、数据变化重算（`stats-page` 9/9）。
- [x] 门禁：`npm test` 391/390/0 fail/1 skip；`check` 通过（22 JSON / 17 WXML / 19 WXSS，634.3 KB）。
- [ ] 待真机：1 年视图横向滚动流畅度、切月/切周期时缓存失效是否正确（单测已覆盖逻辑）。

### 1.27 逐页视觉巡检（2026-10-26，模拟器 390×844 实拍）

- [x] 首页默认态：时间轮 07:30、耗时档位 15 分高亮、CTA、脚注；截图 `l4s-home.png`。
- [x] 入睡页 A 态：圆环「当前时间 15:36 / 等待入睡」、「轻触圆环，记录入睡」、补记/分享入口；截图 `l4s-sleep.png`。
- [x] 统计页当月：指标空态、本月 18 天日历、4 档色阶、今天内描边、图例；截图 `l4s-stats.png`。
- [x] 结果面正常态：23:45 主卡 + 3 行（01:15/02:45/22:15 补觉），未溢出 712rpx 舞台；截图 `l4s-result.png`。
- [x] 修复：首页脚注两段间距 8→16rpx；统计空态文案补「（下方是本月日历）」避免与日历数据误读；截图 `l4s-home-fixed.png`。
- [x] 已知瞬态（非缺陷）：重编译后立即 `onCalc` 会短暂空白页（页面栈为空、console 无 error），`reLaunch` 恢复。
- [ ] 仍可优化（未改）：结果面顶部仍保留「想几点起？」标题，占约 120px；如需给结果更多空间可做成结果态标题收缩——涉及翻转动画，留待设计确认。

### 1.28 音源链路三端一致 + 标题收缩（2026-10-26，模拟器已验）

- [x] 音源三端一致：`/api/admin/config`（后台 Cookie 会话）= `/api/config` = 小程序抽屉 = **6 条**；截图与 evaluate 返回值均已核对。
- [x] 数据修正：本地第 1 条音源标题由误填的后台密码改回「雨声」（后台 API PUT，version 13→14）。
- [x] 结果面标题收缩：翻面后 `72rpx → 40rpx`、副标折叠；截图 `docs/assets/l4s-result-hero.png`（23:45 主卡 + 3 行完整可见）；回正面有过渡。
  - **2026-10-27 已推翻**（用户反馈"高度收紧后整体向上收缩有视觉差"）：改为首行等高——回显时间与问句同字号（72rpx）、`--calc-hero-line` 锁定 83rpx；副标在结果态视觉隐藏但**保留占位**（`visibility: hidden`），翻面时卡片 top 恒为 182.5px。见 `docs/13` §1.38。
- [x] 分享归因：`launchSourceOf({query:{from:'share'}})` → `app_open.target` 含 `|share`（`tests/launch-source.test.js` 通过）；分享方 `track('share', mode)` 已上报；看板 `topSources` 可见。
- [x] 门禁：`npm test` 391/390/0 fail/1 skip；`check` 635.0 KB。
- [ ] 待真机：分享卡片冷启动落地（预填 + 直接展示结果面）、`app_open` 的 `from=share` 是否按预期上报（需真机转发一次后看后台看板）。

### 1.29 提醒瞬时失败限次重试（2026-10-26，单测 14/14）

- [x] 加法迁移：`sleep_reminders` 加 `attempts INTEGER DEFAULT 0`、`retry_at BIGINT DEFAULT 0`（`db/index.js` SCHEMA + `001_init.sql` 同源）。
- [x] 重试语义：非 43101 失败 → `attempts+1`、`retry_at = now + attempts×60s`（1/2 分钟退避）；`attempts>=3` → failed；43101 → cancelled；重建任务重置预算；发送成功清零。
- [x] `dueReminders`（memory + PG）过滤 `retry_at`，退避期内不重复发送；`MAX_LATE_MS`（15 分钟）仍然生效，不会无限重发旧任务。
- [x] 单测：`reminders.test.js`「瞬时失败：进入退避保留 pending，第三次失败才标 failed」（含 attempts 递增与退避时长断言）。
- [x] 门禁：`npm test` 392/391/0 fail/1 skip；`check` 635.0 KB。
- [ ] **部署注意**：线上 PG 需执行 `001_init.sql` 或重启服务端（`init()` 自动 `ALTER ADD COLUMN`）后新列才存在；否则 `scheduleReminderRetry` 的 UPDATE 会因列不存在而失败（已按 `!db.scheduleReminderRetry` 兜底降级为 failed，但 PG 实现存在，列缺失时 SQL 报错——**上线前必须先迁移**）。
- [ ] 待真机/线上：人为断网触发一次发送失败，观察 1 分钟后自动重发成功、看板无 failed 残留。

### 1.30 1 年视图渲染懒加载（2026-10-26，模拟器已验）

- [x] `calendar-strip` 初始只渲染最近 6 个月（`visibleMonths`），滑到最左（`bindscrolltoupper`，阈值 80px）渲染全部 12 个月。
- [x] 追加后视口钉回追加前最旧可见月份（`scroll-into-view = cs-2026-05`），**不跳位**；同月份数据更新只刷新可见格子、不重置滚动位置；切周期/月份范围变化才重置窗口并滚回最新月份。
- [x] 模拟器实测：`months=12 / visibleBefore=6 / visibleAfter=12 / target=cs-2026-05`；截图 `docs/assets/l4-stats-year-lazy.png`。
- [x] 门禁：`npm test` 392/391/0 fail/1 skip；`check` 636.4 KB。
- [ ] 待真机：横向滑动加载更早月份的流畅度与无跳位确认。

### 1.31 部署前 code-review 修复（2026-10-26，范围 1b1371d..ade0da5）

- [x] **P0 提醒字段快照断链**：`routes/reminders.js` 的 `currentReminder()` 少返回 `thingKey/timeKey` → 落库空串 → “换模板后旧任务按创建时字段发送”实际失效（旧任务仍会 47003）。修复：抽出 `server/src/lib/reminder-config.js`（`reminderConfigOf`），route 与 service 共用；新增 3 条单测（缺省 `thing1/time2`、后台自定义原样带出、空配置与 env 兜底）。
- [x] 分享漏斗补齐：统计页、入睡页的 `onShareAppMessage` 补 `events.track('share', …)`（此前只有计算器页上报，看板系统性低估）。
- [x] `fallback.js` 补 `reminder.thingKey/timeKey`（AGENTS.md 五处同改）。
- [x] 删除 `audio-dock` 错误路径冗余 `lastTrackActive` 写入（AGENTS.md §5.1：播放错误只改 `lastTrackPlaying`）。
- [x] `scheduleReminderRetry` 两端统一：只写 `attempts/retry_at`，不再写 `cancelled_at`/`lastErrorAt`。
- [x] 注释漂移修正：`audio-dock` ×2 + `audio-cache` ×1（15s → Wi-Fi 8s / 移动 20s）。
- [x] 门禁：`npm test` 395/394/0 fail/1 skip；`check` 636.8 KB。
- [ ] 部署后验证：后台改一次提醒模板的字段名（如 `thing3/time4`）→ 用旧模板创建的提醒仍能发出（查 `sleep_reminders.thing_key` 非空）。

### 1.32 复核后收口（2026-10-26，模拟器 + 单测）

- [x] 热启动订阅意图：`getApp().onShow({query:{remind:'sleep'}})` 后切入睡页，`notice` 为「到点了，准备好就轻触圆环记录入睡」，`_autoEnd=false`、`_remindKind` 已清空；截图 `docs/assets/l4-hotstart-remind.png`。
- [x] 单页模式：`singlePage=true` 后 `onShow`，底栏隐藏、顶栏「换背景」隐藏；console 无 error。
- [x] 云副本删除后的本地提醒状态：`planReminder=null`、pending `reminderOptIn=false`，本机会话保留。
- [x] 未开启云备份时 erase 失败：`cloudPendingErase=true`，统计页保留重试入口。
- [x] 门禁：`npm test` 405 / 404 通过 / 0 失败 / 1 skip；`npm run check` 642.1 KB。
- [ ] 真机：订阅消息冷/热启动、单页模式朋友圈打开、提醒授权后实际送达。

### 1.32 文档配图清理与检查（2026-10-26）

- [x] 清理 13 张未被引用的中间态截图（657KB）；保留 69 张被文档引用的验收证据图。
- [x] 新增 `tools/check-docs-assets.mjs` 并挂进 `npm run check`：文档图片死链 + `docs/assets` 孤儿图双向检查（口径含 markdown 嵌入 / 反引号路径 / 裸文件名，通配写法不误判）。
- [x] 门禁：`npm run check` 通过（42 文档、69 张被引用、无死链无孤儿）；`npm test` 394/0 fail/1 skip。

### 1.33 音频解锁失败埋点与环境音刷新（2026-10-26）

- [x] 客户端：`audio-dock` 对激励视频 `skipped/busy/error/unavailable` 上报 `audio_unlock_fail`，target 带原因与音轨 id。
- [x] 服务端：`/api/events` 白名单放行；`analytics` 聚合今日/本周 `unlockFails` 与 `unlockFailReasons`；新增单测覆盖原因排序和本周累计。
- [x] 后台：概览新增「音频解锁观测」面板（今日/本周成功、失败、失败原因）；DOM 与 JS 选择器已静态核对。
- [x] 本地环境音：`http://127.0.0.1:3100/api/config` 返回 6 条；模拟器 drawer 运行态也是 6 条。当前开发者工具设置了 `sleep:dev-api=https://sleep.qfmaster.com` 覆盖，且模拟器请求线上失败，因此出现旧缓存 `version 13` 与历史标题；移除该覆盖并清 `sleep:config:v1` 后重编译即可回到本地 3100 配置。
- [ ] 浏览器：后台「音频解锁观测」面板视觉点击验收（本机未起浏览器自动化）。
- [ ] 真机：真实激励视频跳过/失败/不可用时事件落库与后台计数。

### 1.34 统计页指标周期回退（2026-10-27，模拟器已验）

背景：指标原为自然周口径（周一 00:00 起）。周一刚过零点时本周必然 0 天 → 首屏「本周还没有完整记录」，而下方日历是「当月」口径仍满屏记录，用户反馈以为历史数据丢了。

- [x] 口径：`metricsOf` 依次取「本周 → 最近 7 天 → 全部记录」，返回 `periodKey/periodLabel/rangeText/isFallback`；`weekly()` 不变（入睡页「本周 X 天」仍周口径）。
- [x] 对比基线随周期切换：本周→上周同期；最近 7 天→前 7 天（完整 7 天）；全部记录→无基线，说明卡写「没有可对比的上一段」。
- [x] 文案：`durationNoteOf`/`scope` 全部按周期换主语，回退后不再出现「本周」（原 `subOf` 与入口整句 `planLabel` 已于 2026-10-27 随对比下沉/入口移除一并删除）。
- [x] 单测 `tests/stats.test.js` 新增 4 条：周一回退（本周 0 天 + 上周有数据 → `last_7`）、前 7 天基线（`比前 7 天少 2 小时 00 分`）、本周有记录不回退（`this_week` 且文案与改动前一致）、全记录不编造对比。
- [x] 模拟器实测（真实数据，本周 0 天）：指标上方「最近 7 天 10.21–10.27 本周还没有记录」，三列 `6h16 / 23:24 / 05:41`，日历仍显示 10 月全部记录；截图 `docs/assets/l4-stats-period-fallback.png`（当轮副标与入口的小时/分钟紧凑写法已于 2026-10-27 调整，见 changelog）。
- [x] 门禁：`npm test` 432/431/0 fail/1 skip；`npm run check` 通过（676.4 KB）。
- [ ] 真机：跨周切换（周一 00:00 前后）首屏是否闪一下、回退态与本周态互切时周期行是否跳动。

### 1.35 统计页日历色阶与图例（2026-10-27，模拟器已验）

- [x] 色阶 4 处同步（`month-calendar` / `calendar-strip` 1 年视图 / `stats` 图例 / 海报 canvas）：`#5A57C8 → #6C68E8 → #8A90FF → #A5B4FC`（实色，对空格约 3.1/4.1/6.6/9.2 比 1），最高档刻意不近白。
- [x] 半透明方案被否：`rgba(...,.22)` 首档与空格只有约 1.25:1（低于改造前 `#3F3C9E` 的 2.0:1），已改实色 3.1:1。
- [x] 格内文字同步：低两档浅字（`#EDEEFF` / `#F8FAFC`）、高两档深字（`#1E1B4B`，对 lv4 约 8:1）。
- [x] 图例改为 4 段连续色阶条 + 各段居中区间标签（`＜4h / 4–6h / 6–8h / 8h+`），弱→强一眼可读，首段不再消失。
- [x] 模拟器四档同屏：3h（临时注入）/ 4.9h / 7.2h / 9.0h；最低档与空格「+」可区分；截图 `docs/assets/l4-stats-heat-v2.png`（注入记录已还原）。
- [x] 1 年视图 40rpx 小格同色阶可分辨（无「白块」观感）；截图 `docs/assets/l4-stats-heat-year.png`。
- [x] 审查连带修复：分享标题主语取 `periodLabel`（回退态不再写死「本周」）；回退注脚区分「本周还没有记录 / 本周与最近 7 天都没有记录」。
- [x] 门禁：`npm test` 435/434/0 fail/1 skip；`check` 通过（679.6 KB）。
- [ ] 真机：护眼/低亮度模式下 lv1 与空格是否仍可区分。

### 1.36 底部导航全面重构：回归微信原生 TabBar（2026-10-28，模拟器已验）

- [x] 快速切换抖动根因：自定义 `custom-tab-bar` 在每个页面各有独立组件实例，快速连击或切换时，组件初始化默认值、`attached`、页面 `onShow` 与 `setData` 产生了不可避免的竞态闪烁。
- [x] 架构决断：彻底移除 `custom-tab-bar`，回归微信原生 `app.json` 的 `tabBar` 体系，由微信底层 C++ 视图容器直接渲染，从根本上终结多实例竞态与激活态抖动。
- [x] 视觉与配置：
  - `app.json` 移除 `"custom": true`，配置暗夜星空色盘（`backgroundColor: #0A0E1A`，未选色 `#7C8799`，选中色 `#818CF8`）；
  - `tools/gen_assets.py` 产出 Apple 极简几何图标（时规 dial、新月 micro-star、节律波），放置于 `miniprogram/assets/`；
  - 各页面 WXML 彻底移除 `<custom-tab-bar />`，删除 `miniprogram/custom-tab-bar/` 目录；
  - 主包体积从 737.1 KB 下降至 725.1 KB。
- [x] 桥接与避让重算：
  - `utils/tabbar.js` 的 `hide()` / `show()` 对接微信原生 `wx.hideTabBar({ animation: false })` / `wx.showTabBar()`，`switchTo()` 对接 `wx.switchTab()`；
  - 微信原生 `tabBar` 位于 Webview 外部（不再侵占页面内部视口），`audio-dock` / `now-playing` 悬浮元素定位统一优化为 `bottom: 24rpx;`，页面底部内边距精简至 `140rpx~160rpx`，消除双重安全区留白。
- [x] 门禁全绿：`npm test` 460 / 459 通过 / 1 skip，`npm run check` 纯绿通过。
- [ ] 真机：iOS / Android 快速滑动切换 Tab，体验底层原生切换的绝对稳定性与零抖动。

### 1.37 统计页详情卡「改 / 删」——历史记录修正入口（2026-10-27，模拟器已验）

- [x] 缺口取证：`sleep.js` 的 `onEditSession` / `onDeleteSession` 都有 `day !== record.day` 守卫（只处理当天），而 `storage.updateSession/removeSession` 本来就接收任意 day——历史日期此前在 App 里没有任何修正入口。
- [x] 详情卡逐段列出：`13:00–14:30 · 1 小时 30 分` + `改 / 删`；跨自然日的段标「次日」；`canEdit` 与补记同窗口（400 天）。
- [x] 改：复用页内补记面板的编辑态（标题「修改这一段」、醒来日只读、预填起止、按钮「保存修改」），保存走 `updateSession`；模拟器实测 14:30→15:00 后详情与存储同步（1h30→2h）、段数不变。
- [x] 校验排除自身：`manual-sleep.evaluateManualRange` 新增 `excludeId`，否则「只挪一分钟」会被判成与自己重叠（单测 2 条覆盖）。
- [x] 删：`showModal` 确认 → `removeSession`；模拟器实测多段日删一段当天保留、删第二段整天撤销（`detail=null`、存储里该日消失）。
- [x] 多段日改醒来日：给可读文案「这天有多段：改醒来日会把记录拆到另一天，请先删除其它段」（`updateSession` 本身会拒）。
- [x] 时序加固：`saveManualSession/saveEditSession` 开头同步重算面板区间，避免「选完立刻保存」用到上一次缓存。
- [x] 门禁：`npm test` 438/436 pass/1 fail/1 skip（唯一失败是并行 tabbar 改动的 `wx.switchTab` 断言）；`check` 通过 695.8 KB。
- [ ] 真机：时间 picker 滚动手感、删除确认弹窗文案换行。

### 1.38 计算器结果面：翻面不再位移 + 回显放大 + 操作分两行（2026-10-27，模拟器已验）

- [x] 视差取证：翻面前后各量一次 → `top`/`height` 由「hero 少了约 90rpx」改为两态一致（`hero 91/77.5`、`card 182.5`、脚注 `646.5`）。
- [x] 首行等高：`--calc-hero-line` 83rpx（72×1.15），回显 72rpx 与问句同号、日期/单位 43rpx（同比例 0.6）；≤360px 同步 64/38/74。
- [x] 结果态副标：`visibility: hidden` 保留占位（不是 `max-height:0`），文案去掉、高度不变。
- [x] 操作互换：上「提醒 + 换成…（无框、右缘与主按钮对齐）」、下「‹ 返回 + 去入睡打卡」；`singlePage` 下只隐藏跨页动作。
- [x] 内容不溢出：`result-share` 两态均 33px（未压缩）；2 行结果的非 dense 场景额外核对过。
- [x] 门禁：`npm test` 438/437/0 fail/1 skip；`check` 695.8 KB。
- [ ] 真机：翻转动画 0.6s 内的观感、`换成…` 无框文字的点击热区手感。

### 1.39 背景选择器去掉「免费」措辞（2026-10-27，代码已改；**文案视觉未机验**）

背景（运营反馈）：徽章「免费」+ 副标「免费使用 24 小时」会让用户以为后续有收费项，而背景功能从无付费路径（`free` 模式直接换、`rewarded` 模式看一次视频）。本轮只动文案，0 逻辑变更。

- [x] 副标：`默认背景 · 免费` → `默认背景`；免费模式 `免费使用 24 小时` → `可随时更换`（广告模式 `看广告解锁 N 小时` 不变）。
- [x] 徽章：免费模式 `免费` → `可切换`，去掉 `is-on` 紫色强调；`使用中 / 默认 / 已解锁 / 看广告` 语义不变。
- [x] 脚注：免费模式「所有背景都可以随意更换；选中的背景保留 N 小时，到时自动回到默认，可以再选。」/ 广告模式「默认背景可直接使用；其他背景需观看一次视频，可使用 N 小时。」N 取 `backgroundUnlockHours`（未写死 24）。
- [x] 切换确认弹窗：`当前付费背景还剩约 N 小时` → `当前背景还剩约 N 小时`（免费模式选 A 再选 B 会弹这句）。
- [x] 门禁：`npm run check` 通过（3 页面 / 22 JSON / 17 WXML / 19 WXSS，708.0 KB）；`npm test` 460 项 / 459 通过 / 0 失败 / 1 skip。
- [ ] 视觉：390×844 下「可随时更换」副标单行不折、脚注不超过 2 行、`可切换` 徽章不挤 `bp-badge` 列（模拟器或真机过目后打勾）。
- [ ] 口径复核：让没看过后台配置的人读这三处文案，不应再问出「以后是不是要收费」。

### 1.40 用户反馈闭环（2026-10-27，单测/门禁/模拟器/后台浏览器已验；**真机键盘未验**）

背景：统计页新增「反馈与建议」表单（类型/正文/可选联系方式），服务端 `POST /api/feedback` 落 `user_feedback` 表，后台「用户反馈」面板只读巡检 + 标记已处理。

- [x] 提交链路：`stats.wxml` 表单 → `onSubmitFeedback` → `api.submitFeedback` 带 `wx.login` 新 code → `POST /api/feedback` 返回 201；字段名、类型白名单（`SUGGEST/MUSIC/ISSUE`）、长度上限（500/64）与清洗正则两端逐字一致。
- [x] 失败出口：弱网/超时（10s）、429 限流、403 关闸、501 存储不支持都会落到表单内红字，面板仍可关闭。
- [x] 重复提交：提交中按钮守卫 + **面板重开不重置守卫**（review 修复，见 changelog 同日条目）；提交中点 × 给「正在提交，请稍候」而非静默无响应。
- [x] 清除数据级联：`eraseUserData` / `eraseCloudData` 都删 `user_feedback`（memory + PG 双实现，`server/test/feedback.test.js` 覆盖）。
- [x] 后台接口：正文 `textContent` 渲染（零 `innerHTML`）、保留换行、标记已处理写审计只记编号；列表最多 200 条且面板文案写明口径。**本机实测**（`PORT=3101` memory 实例 + 后台 Cookie 会话）：提交 1 条 MUSIC → `GET /api/admin/feedback` 返回 `count=1 / unhandled=1 / contact` 原样保留；`POST /api/admin/feedback/1/handled` 后 `onlyOpen=1` 返回 0 条、`unhandled=0`、`handledAt>0`。
- [x] 门禁：`npm test` 460 / 459 通过 / 0 失败 / 1 skip；`check` 708.0 KB。
- [x] 小程序 390×844 模拟器实测（2026-10-27，wechatide CLI + `automation_evaluate`）：
  - 入口：统计页底部（「数据与备份」之后）单行「反馈与建议 ›」弱化文字，命中区 88rpx，截图 `docs/assets/l4-feedback-entry.png`。
  - 表单：类型三选一 chips（选中态紫描边+底色）、textarea 实高 150px、字数「13/500」、可选联系方式、提交按钮，截图 `docs/assets/l4-feedback-sheet.png`；量取 `end-sheet` 宽 390 / chips 右边缘 374（左右各 16px 内边距，无裁切）、textarea 358×150。
  - 校验：空白内容提交 → 表单内红字「写点什么再提交吧」，`feedbackSending` 保持 false，截图 `docs/assets/l4-feedback-error.png`。
  - 成功态：真实 `POST /api/feedback` 201 后切「收到了，谢谢你」+ 输入清空 + 类型回默认，截图 `docs/assets/l4-feedback-done.png`；`get_simulator_console` 无 error 输出。
  - tabBar：打开面板 `tabbar.hide()`、关闭后 `hidden=false / selected=2` 复位（evaluate 读取）。
  - **验证手法披露**：本机 3100 端口已有旧版 dev server（无 `/api/feedback`），为避免重启他人进程，另起 `PORT=3101` 实例，仅在 `automation_evaluate` 内临时改写 `wx.request` 的 URL（3100→3101）完成真实提交，事后还原；仓库代码零改动。
- [x] 后台面板浏览器实测（2026-10-27，Edge headless + puppeteer-core，1440×980，`PORT=3101` memory 实例灌 2 条）：左侧新增「用户反馈」入口可点开；列表 2 条、角标「未处理 2」、类型标签「问题反馈 / 想听的音乐」正确、正文 `white-space: pre-wrap` 生效（多行保留）、联系方式行「联系方式：wx: getsleep-test」；点「标记已处理」→ 角标 1、该卡出现「已处理」、按钮消失；勾「只看未处理」→ 列表 1 条；`pageerror` / `console.error` 均为 0。截图 `docs/assets/l4-feedback-admin.png`。
- [x] 后台失败提示不堆叠：把 `/handled` 请求临时替换为 500 后连点两次「标记已处理」→ 列表内 `.warning` 恒为 1 条（文案「标记失败：模拟失败」），按钮恢复可点（本轮 review 修复「先清旧再插新」实测生效）。
- [ ] 真机：软键盘弹起后 textarea 上方内容是否可达、iOS 中文输入与换行、面板最大高度在无障碍大字号下的表现。

### 1.41 统计页日历底行重排（2026-10-28，模拟器已验）

背景（用户截图反馈）：打卡日历下方一行里，「分享」夹在「本月已记录 N 天」与「生成 30 天海报」之间，视觉重心偏右。

- [x] 结构：`.section-foot` 由「文案 + [分享 | 海报]」改为三栏「分享 / 文案 / 海报」；左右各包 `.foot-side`（`flex: 1 1 0`），中间 `.heat-note` 改 `flex: 0 0 auto` + `text-align: center`。删除死类 `.section-actions` 及其 `.poster-btn` 外边距规则。
- [x] 居中是真居中而非近似：模拟器 390×844 量取 `.heat-note` 中线 **195**，`.section-foot` 中线 **195**（页面 390 宽，内容区 16–374）；左栏 16–159（分享贴内容左缘）、右栏 231–374（海报右缘贴内容右缘）。
- [x] 备选方案已排除：「文案 `flex:1` + `text-align:center`」会让中线左偏约 70rpx（左图标约 60rpx、右胶囊约 200rpx 不对称）。
- [x] 截图 `docs/assets/l4-stats-foot.png`（7 条本月记录的数据态）。
- [x] 已知边界：320px 级窄屏下海报胶囊约 124px 超过可用半宽，文案中线会被推左约 16px；iPhone SE(375) 及以上不受影响，未为此压缩海报文案。
- [ ] 真机：小屏 Android 观感与分享按钮热区（组件热区 64rpx 高，未改）。

### 1.42 环境声音抽屉精简与已缓存标记（2026-10-28，模拟器已验）

- [x] 抽屉顶部「正在播放」行移除（该行只在 `currentId` 出现时插入，点播放会把下方内容整体下推）。
- [x] 播放状态改由当前行承担：标题/状态用 `--color-primary-soft`、600 字重；有当前曲时其余行标题降 `--text-secondary`、图标底 62% 透明度（`scroll-view` 的 `has-current` 类，纯 CSS）。
- [x] 已缓存标记：绿色 `↓` → 暗灰 `✓`（`rgba(148,163,184,.55)`、28rpx/400）；点击仍走「删除这首的缓存？」二次确认，长按同口径。
- [x] 底部缓存汇总、「清理」整库入口（`cacheText/cacheCount/onCleanCache` 一并删除）与「锁屏后继续播放」脚注移除；整库清理仍由统计页「清除数据」承担。
- [x] 定时关闭固定贴抽屉底部（`margin-top:auto`）、无背景/描边；标签 27rpx/600、选中档实心 `#c9ccfa` 深字、档位 48rpx。
- [x] 抽屉高度 `86vh → 68vh`（顶边在屏高 32%）：模拟器点击上部遮罩后 `open=false`；模拟 16 条音轨上滑，列表内部滚动（首行随滑动变化），头部与定时块不动；6 条音轨时约 5.5 行可见、其余滚动。
- [x] 标题同行副标：「环境声音」+ 22rpx 淡字「陪着你，慢慢睡着」，baseline 对齐；播放态「结束播放」+ 关闭键同时出现时不换行、不重叠（模拟器 390×844 截图核对）。
- [x] 门禁：`npm test` 460 / 459 通过 / 0 失败 / 1 skip；`npm run check` 通过（719.0 KB）。模拟器 390×844 截图复核（空闲 + `setData` 模拟播放态），console 无 error。
- [ ] 真机：点 ✓ 删除缓存的确认弹窗与删除后列表刷新；真实起播/锁屏见第 2 区。

## 2. 待真机验收（代码就绪，模拟器不可替代）

> 按风险排序。每项都曾在 changelog 标注"未真机验证"；本机 CLI 已把可截图的全部截完，剩余必须真机。

### 2.1 音频（最高风险，睡前场景核心）

> 改音频前先读铁律：`AGENTS.md` §5 / `docs/12` §10（状态单写入口、可见性、中断恢复、回环、停止二次确认、坏源、回归门禁）。以下逐项验收，不替代铁律里的四条模拟器回归。

- [ ] 锁屏/切后台后续播（`requiredBackgroundModes: ["audio"]` + BackgroundAudioManager）。
- [ ] 耳机拔出/来电中断后的行为；**外部中断结束后应自动续播**（2026-10-25 起）；在小程序内暂停的不会被拉起；系统通知栏暂停后回到小程序，`togglePlay` 能重建音源、不倒灌"幽灵播放态"。
- [ ] 杀进程重进：不出现"显示正在播放但无声"；`lastTrackPlaying`/`audioSession` 兜底口径正确。
- [ ] 短音源（3 分钟）单曲循环：每轮只重播一次，不出现同一 `src` 双写双 `play()`；**锁屏后也要继续回环**（2026-10-25 起 `armLoop` 定时器兜底，不再只靠前台 `onTimeUpdate`）。
- [ ] 定时关闭：30/60/90 到点停止；iOS 冻结 JS 时延后幅度可接受（已知限制，不是缺陷）。
- [ ] 弱网首播：12s 加载兜底文案出现；坏缓存回退远程后无卡顿循环。

**2026-10-25 环境音会话/中断轮（`utils/audio-session.js` + `player-state.armLoop`）**

- [x] 单测（`npm test` 351 项 / 350 通过 / 1 skip）：中断结束自动续播、用户暂停不被拉回、系统 stop 保留会话、回前台补偿、`src` 被清空后按 `lastTrackId` 重建、曲末先 `seek(0)`、停止宽限期、自动重播限流。
- [x] 模拟器（wechatide CLI，390×844，真实音频）：外部 `pause()` → 入睡页“已暂停”、首页/统计页迷你条保留。
- [x] 模拟器：外部暂停 + `App.onHide/onShow` → 自动续播（从 37s 继续，非重头）。
- [x] 模拟器：应用内暂停 + `App.onHide/onShow` → 保持暂停。
- [x] 模拟器：应用内停止 → `lastTrackActive=false`、首页无迷你条、回前台不复活。
- [ ] 真机：来电/闹钟/微信语音触发的 `wx.onAudioInterruptionBegin/End` 回调顺序与自动续播。
- [ ] 真机：锁屏连续多轮回环（`armLoop` 兜底）与微信悬浮音符是否常驻；回环点是否有可听断层（**2026-10-25 起尾部由 2s 收紧到 1.2s**，重点听这一轮的接缝）。
- [ ] 真机：耳机拔出、通知栏/锁屏控件暂停后回前台的口径（当前按“外部中断可恢复”，小程序内暂停一定不拉起）。
- [ ] 真机：微信浮窗 X（系统 `stop`）后迷你条以“已暂停”保留、点播放能重建音源。
- [x] 单测：`audio_interrupt` 的 `begin` / `end|秒|resume|skip`、服务端白名单放行、analytics 只统计 `begin`。
- [x] 单测：坏源黑名单 `markBad` 后 `peek` 返回空、重下成功自动解禁、`remove` 解禁。

**2026-10-26 环境音批次 C（`player-surface` / 缓冲态 / 单曲缓存 / 连播）**

- [x] 单测：`player-surface` 7 条（显式停止才隐藏、冷启动仍可见且 playing=false、悬浮 X 停止保留、外部中断不误清）、`player-queue` 6 条（单曲/收藏连播/不足 2 首/已下架过滤）。
- [x] 模拟器：缓冲态不再把播放中误标「已暂停」（修复前实测 `paused:false` + `playing:false`；修复后 `playing:true`）。
- [ ] 真机：弱网首次起播——应显示「正在连接」且 4s 内自动补播，不得出现「刚点播放就暂停」。
- [ ] 真机：微信悬浮 X 停止后，三页仍显示「已暂停」条，点按能续播（冷启动/杀进程各一次）。
- [ ] 真机：长按已缓存曲目 →「删除这首的缓存（X MB）」，只删该曲；在播曲目被拒绝删除。
- [ ] 真机：收藏连播（≥2 首收藏）曲末自动切下一首；切歌时微信悬浮音符短暂消失属平台行为，需确认可接受。
- [ ] 真机：「继续上次」在杀进程重进后可见且能一键续播（不自动播放）。
- [ ] 真机：熄灯态「结束入睡」<5 分钟二次确认手感；>5 分钟一次点击直接落库。
- [x] 模拟器（wechatide 390×844）：抽屉「结束播放」首点 `stopArmed=true` 且仍在播、二点停止（`currentId=''`）；迷你条停止方块首点转红不停止、二点停止且 `lastTrackActive=false`（截图 `docs/assets/l4-audio-stop-armed.png`、`l4-audio-stop-np-armed.png`）。
- [ ] 真机：停止二次确认的暖红/文案与 3 秒节奏是否符合睡前手感（首点误触后应明确知道“还没停”）。
- [ ] 后台看板：播放卡副标「本周 N · 中断 M」与 14 天趋势 tooltip 的中断数（需起服务 + 有事件数据，**未机验**）。

**2026-10-27 迷你条交互轮（`now-playing`）**

- [x] **模拟器 390×844**：跨页条与入睡页迷你条各自的「下一首」都实测切歌（雨声 → 今晚好梦 → 钢琴曲-初雪），标题/分类/播放态同步；抽屉在入睡页 `syncFromAudio` 读到同一首（`currentId` 跟随）。截图 `docs/assets/l4-np-dock-next.png`（入睡页迷你条两键）。
- [x] **模拟器**：记忆展开——计算器点开播放条 → 切统计页仍 `miniExpanded=true`（截图 `l4-np-next-loading.png` 为统计前一刻的同一形态）；统计页点外部收起 → 回计算器为音符（`miniExpanded=false, pref=false`）。
- [x] **模拟器**：续播亮相——`pref=false` 时续播后条保持展开，canplay 结算后约 3 秒自动收成音符，且 `collapsed=false`（不算手动折叠）；`pref=true` 时不自动收。
- [x] **模拟器**：缓冲显示转圈 +「缓冲中…」（截图 `docs/assets/l4-np-next-loading.png`），起播后转均衡器 +「正在播放」。
- [x] **模拟器**：暂停态播放键带弱底、停止键压暗（截图 `docs/assets/l4-np-paused.png`）；停止首点转暖红（早前 `l4-audio-stop-np-armed.png`），二点后条消失，`onHide/onShow` 后仍 `visible=false`。
- [x] **模拟器**：应用内暂停 → `onHide/onShow` → `paused=true` 未自动续播；停止 → 不复活。
- [x] 单测：`nextTrackInList` / `nextTrackManual`（列表循环、不足 2 首、下架曲目、收藏连播优先）与 `isReallyPlaying`（无 src、paused=undefined）新增 6 条，相关两文件共 21 条。
- [x] `audio-dock` 的 7 处非严格 `paused` 判断收敛到 `isReallyPlaying`（loading 兜底、缓冲重试、缓冲补播、canplay 自愈、onError 仍在出声、toggle、定时起表），门禁通过。
- [ ] **真机**：外部中断（来电/闹钟/其他 App 抢占）→ 条保留 → 回前台自动续播；锁屏多轮回环；耳机拔插；通知栏暂停。
      **注意**：本轮 DevTools automation 环境下 BAM 不派发 `onPause/onPlay`（实测监听数组为空、`paused` 已翻转但无事件），所以“外部中断自动续播”这条在模拟器里**无法复现**，只能真机验证；同理锁屏相关只能真机。

**2026-10-27 续播后迷你条停在「已暂停」（真机反馈）**

- [x] 现象：微信里关掉音乐 → 重进小程序，音乐自动续播（预期），但迷你条仍写「已暂停」。
- [x] 修复：`now-playing` / `audio-dock` 的 `timeupdate` 增加真实状态自愈（`isReallyPlaying()` 为真而 UI 仍暂停时纠正），并在 `pageLifetimes.show` 后 800ms 做一次对账（`scheduleReconcile`，覆盖“续播比页面 show 晚一拍”）；不改会话与续播意图判定。
- [x] 门禁：音频四件套 69 项、`server/test/api|analytics` 22 项、全量 435/435（带 PG）通过。
- [ ] 真机复验：按 `docs/14` A10 复测；若仍复现，需记录是「悬浮 X 停止」「通知栏暂停」还是「切后台」，三者走的状态不同。

### 2.2 交互手感

- [ ] 时间轮小幅拖动后回中；2 份循环滚到边界无跳变。
- [ ] 展开迷你播放器后，第一次点 tabBar 能直接切页（不卡在折叠动画）。
- [ ] 删除确认弹窗、结束/补记面板在真机的按钮热区（关闭钮 56rpx + 80rpx 命中区）。
- [ ] 计算器 3D 翻转（`rotateY(180deg)`）在真机 GPU 合成下的流畅度；上午/下午切换。
- [ ] 「换背景」在真机的胶囊贴合度与命中热区（按钮贴 `capsuleGap` 右对齐，DevTools 与真机胶囊位置可能不同）。
- [ ] 统计页 88rpx 格连续点 20 个日期一一对应；3/6/12 个月横向滑动默认停最新月。
- [ ] **睡前熄灯（2026-10-22，模拟器已验，仅剩真机观感）**：真机 GPU 下毛玻璃的模糊强度是否合适（模拟器偏暗，真机 OLED 可能更暗）、Android 不支持 `backdrop-filter` 时深底降级是否仍像“关灯”；熄灯态误触只唤醒不结束计时（模拟器已验，真机触感待确认）。右上胶囊为微信原生，熄灯时仍可见，属预期。

### 2.3 打卡与数据

- [ ] 入睡打卡 → 进入**持久熄灯**（点触唤醒，30s 无操作回熄灯）→ 唤醒后「记录起床」；杀进程重进仍是「记录起床」且不锁在熄灯态。
- [ ] 忘记结束超 24h 的 pending：日期选择（入睡日固定 + 醒来日可选）与校准保存。
- [ ] 订阅消息「结束入睡」到点送达、点击直达结束面板；未配置模板时日历兜底。
- [ ] 云备份开启后真机 `wx.login` 静默拿 openid，上传/回填/墓碑/erasure 全链路（PG 环境）。

### 2.4 评审整改（2026-10-22 代码已改；2026-10-23 模拟器 390×844 走查）

> 对应 [docs/11-changelog.md](11-changelog.md) 顶部「评审整改」条目；`npm test` **297 项 / 296 通过 / 1 skip**，`npm run check` 通过（主包约 530.5 KB）。走查使用 `getApp().seedDemo(30)` 造数，结束后已清理 `sleep:records/deleted/pending`。

- [x] 结果面 390 宽 rect：compact 与「补觉行 + 两行 note」的 `.result-share` 底 ≈ 612px = `.calc-back` 底 612px，脚注顶 646px，无溢出；320 宽待验。
- [x] 统计页底部 390 宽无广告：`.safe-bottom` 实测 190px（300rpx + 34px safe），单次让位；广告实载高度待验。
- [ ] 月历 320/360 宽：未来日号可读（390 原图已验证）、选中描边不被“今天/进行中”内描边覆盖、`‹` 到第 24 个月显示禁用态。
- [x] 统计页日详情：多段日主行改「首段/末段」、单段午睡不写「夜间」；「补记一段」打开预填该日且默认 13:00–13:30 无重叠；详情自动滚动到 tabBar 之上。
- [x] 结束面板打开时 tabBar 隐藏；切后台再回前台未模拟（代码按 `dim || endShow` 重新隐藏）。
- [ ] 弱网/坏源首播 12s：出现「连接超时，点按重试」，不得留下绿色“正在播放”音符；`meta.lastTrackPlaying` 为 false。
- [ ] 解锁 `ttlHours` 调成 1 小时：起播后切到统计页等待 2 分钟，音频必须停止并提示重新解锁。
- [x] 云备份：`chunkRecords` 单测覆盖 60 条 × 5 段 + 400 墓碑，每片 ≤44KB；服务端 body 上限 256KB（真实 HTTP 待验）。
- [x] 停机/后台关闭提醒恢复后，迟到超过 15 分钟的 pending 不再补发（`expired`，服务端单测）。
- [ ] 落地页 375×667 / 390×844：首屏先看到 H1 + 主 CTA；无小程序码时空态为「微信搜索」。
- [x] 其他走查：月历未来日号（原图）、熄灯层「已入睡」且无 tabBar、音频抽屉播放、真实 tab 切换后的跨页音符/播放条、console 无 error/warn。
- [ ] 真机音频（锁屏/中断/到期）、320/360 宽、PG、订阅消息热启动。

### 2.5 代码审查修复轮的视觉/交互项（2026-10-23，**未过模拟器**）

- [ ] 首页/统计页迷你条展开态：暂停 → 点右侧方块 → 播放条消失、音频停止、定时复位；点按钮不应触发 `openAudio` 跳页。
- [ ] 时间轮点击选值：点非中心行，列滚到该值并触发重算（结果面若已翻开应回到正面）；滑动后点击无冲突。
- [ ] 横滑月历（3/6/12 月）：未来日号 18rpx 可读、不再整格发灰；选中“今天”有金色 outline（不被“进行中”内描边覆盖）。
- [ ] 计算器结果面：3 行 + 两行 note（入睡 late 分支）与 compact 两场景，`result-share` 不溢出 712rpx 舞台；行距收紧后不显得拥挤。
- [ ] 背景图/广告位配置变化后回到入睡页：音轨列表与解锁时长在 10 分钟内刷新；坏配置恢复时在播音频的提示为「网络已恢复，解锁后可继续播放」。

### 2.6 老机型兼容改造（2026-10-27，静态改造 + 模拟器复验）

> 背景：此前 5 处 `display:grid` 在 Chromium 53 的老安卓 X5 上会让统计页日历塌成竖排；111 处 flex `gap` 在 iOS < 14.5 / 老 X5 上间距全丢。本轮做了静态降级，**现代机型外观应与之前一致**。

- [x] 统计页月历（`month-calendar`）、年历（`calendar-strip`）、空态 3×3（`empty-state`）从 Grid 改为「固定宽容器 + `space-between` 列距 + `margin-bottom` 行距」，全仓已无 `display: grid`。
- [x] 核心交互面改为相邻兄弟 `margin` 兜底：跨页迷你条（`now-playing` 0 处 gap）、底部三件套（`sheet`）、计算器结果面/耗时档位/主按钮、统计页周期标签与分区动作、入睡页完成态双按钮/段操作/超期双出口。
- [x] **模拟器 390×844 复验（2026-10-27 12:1x）**：月历仍 7 列、列宽列距与改前一致（`docs/assets/l4-compat-stats-month.png`）；1 年视图两个月并排、7 列不塌（`l4-compat-stats-year.png`）；结果面头/行/提醒/底部动作行距正常（`l4-compat-calc-result.png`）；迷你条三键间距 16rpx 正常。三张均为本次实测截图。
- [ ] **真机（iOS 12/13）**：三页间距是否仍成立；时间轮/结果面行距、统计页指标、底部面板按钮间距。
- [ ] **真机（老安卓 X5 / 旧版微信）**：统计页月历是否仍为 7 列、年历 12 个月是否横向可滑；首页 3D 翻转是否闪烁。
- [ ] 剩余 67 处 `gap`（非核心路径：`audio-dock` 抽屉内部 25、统计/入睡页次要行等）在 iOS < 14.5 上仍会丢失间距，属已知技术债，未全量改造。

### 2.7 播放器接入层收口（2026-10-28，代码已改 + 单测绿，**模拟器待授权**）

> 背景：新增 `utils/audio-player.js` 作为 BackgroundAudioManager 的唯一持有者（实例/取源/错误归属/坏源策略），audio-dock 与 now-playing 改为调用它。行为按设计不变，但按 AGENTS.md §5.8 必须复核四条。

- [x] `npm test` 485 项 / 484 通过 / 0 失败 / 1 skip；音频四件套 + `audio-player` 两组共 66/66 通过；`npm run check` 通过（728.1 KB）。
- [x] **模拟器 390×844（2026-10-28，audio-dock 事件归属迁移后）**：`dock.play()` 起播 → 面板 `playing=true`、`hasSrc=true`、`paused=false`，meta `lastTrackActive/lastTrackPlaying` 均 true；`stopPlayback()` → meta 两者 false、`currentId=''`，切统计页 `#np` `visible=false`（条消失）；冷启动残影（meta playing:true + 无 src + 本进程未起播）→ 入睡页保留曲目、`playing=false`、meta 只归零 lastTrackPlaying 而 lastTrackActive 仍 true；console 无 error。
- [ ] 小程序内暂停 → 回前台/中断结束后**不**自动续播（devtools 无法造出系统暂停，待真机）
- [ ] 外部暂停（来电/切 App）→ 迷你条保留 → 回前台自动续播（`BAM.pause()` 在 devtools 不真正生效，待真机）
- [ ] 真机锁屏多轮回环、耳机拔出、通知栏停止
- 说明：`now-playing` 仍自行监听（1c 才迁移），本轮的机验结论只覆盖入睡页 audio-dock 路径。

### 2.8 添加到「我的小程序」引导（2026-10-28，改版后模拟器已验；真机添加入口未验）

> 口径：完成过记录后才出现 + 未添加时每周 1 次 / 每月 ≤5 次 + 23:00–06:00 不弹 + 入睡中不弹。视觉对齐 `qfmaster24` 的 add-guide：紧凑气泡贴右上胶囊下方，✕ · 主说明/副说明 · 「添加」，无遮罩、6 秒自动收起。规则纯函数 `miniprogram/utils/add-tip.js`，组件 `miniprogram/components/add-tip`，三页挂载。

- [x] `npm test` 502 项 / 501 通过 / 0 失败 / 1 skip（`add-tip` 15 条：无记录 / 夜间边界 / 周频 / 月上限 / 换月重置 / 北京时间周月键 / 脏状态；另加 `/api/events` 的 `add_tip` 白名单集成用例）；`npm run check` 通过（3 页面 / 22 JSON / 17 WXML / 19 WXSS，主包约 743 KB）。
- [x] 模拟器 390×844 实测几何：卡片 232×52、右缘 382 对齐胶囊右缘 383、顶边 91 = 胶囊下沿 83 + 8、箭头落在胶囊中心线左侧（对准「···」），`meta.addTip` 写入 `{weekKey:'2026-W44', monthKey:'2026-10', monthCount:1}`；截图 `docs/assets/l4-add-tip.png`。
- [x] 点气泡 → 弹 toast「点右上角「···」→ 添加到我的小程序」并收起；点 ✕ → 静默收起（无 toast）；6 秒无操作 → 自动收起。
- [x] 同一周再次 `reLaunch` → 不出现（周频生效）。
- [x] 预置 `pending`（30 分钟前入睡）后 `reLaunch` → 不出现（入睡中不打断）。
- [x] 切到入睡页 → 同位置渲染；console 无 error。
- [x] `wx.checkIsAddedToMyMiniProgram` 在 devtools 走 success 分支返回 `{errMsg:'...:ok', added:false}`——判断链路可用，但模拟器无法真实添加。
- [ ] 真机：点「···」→ 添加到我的小程序 → 回小程序后接口返回 `added:true`，此后不再出现。
- [ ] 真机：低版本微信（<2.29.1）或接口 fail 时按「未确认已添加」出现，且不超过 5 次/月。
- [ ] 真机：气泡显示时点「···」能正常打开菜单（无遮罩阻挡；胶囊绘制在 Webview 之上，预期可点）。
- [ ] 真机：6 秒自动收起与淡出动画的实际观感；气泡压住页头标题是否可接受（当前首页/入睡页都会盖住标题右半）。
- [ ] 后台概览「今日小程序引导」卡片的浏览器点验（本轮只做 `node --check` + 元素 id 存在性检查；数据口径由 `server/test/analytics.test.js` 覆盖）。

## 3. 待外部输入（不是代码问题）

| # | 事项 | 卡住的功能 | 责任方 |
|---|---|---|---|
| 1 | `sleep.qfmaster.com` 解析 + HTTPS + 1Panel 反代（TRUST_PROXY=1） | 体验/正式版全部网络请求 | 运维 |
| 2 | AppSecret 写入服务端 `.env`（WX_APPID/WX_SECRET） | 海报小程序码、订阅提醒、云备份 openid | 运维 |
| 3 | COS 防盗链放行 `servicewechat.com` + `sleep.qfmaster.com`；downloadFile 白名单 | 真机音频/背景图 403 风险 | 运维 |
| 4 | 流量主开通（约 1000 UV）+ 激励视频广告位 ID | 广告解锁真实生效（当前空 ID = 直接解锁，可先用） | 运营 |
| 5 | 后台「存储与上传」填 COS 子账号凭证 | 后台上传音频/背景图/小程序码 | 运营 |
| 6 | 提审：类目（工具-效率）、隐私指引（openid 用途）、审核备注 | 上架 | 管理员 |
| 7 | 环境音补到 4–6 条（当前仅 1 条 5.7MB，建议重压 2–6 分钟 loop） | 抽屉内容丰富度 | 运营 |
| 8 | 真机账号（管理员微信 + 一台 iOS/Android） | 第 2 区全部 | 用户 |

## 4. 已知限制（验收时勿当缺陷报）

- 定时关闭在 iOS 完全冻结 JS 时可能延后到回前台才触发（前台准确）。
- 后台音频单通道，不支持混音；首次播放必须用户手势触发。
- 内存模式重启丢配置（仅联调用，生产 PG）。
- 限流/配置缓存/事件队列进程内单实例，扩容前需换共享存储。
- H5 `/demo/` 仍是改版前结构，只同步色板；不作为新版验收依据。
- 广告位未开通时 `<ad>` 静默不渲染；页面展示位默认全关。

## 5. 本轮验收结论

- 机验区（第 1 区）全绿；本机 CLI 通道已恢复可用（此前记录的 MCP 代理失败是工具链问题，非项目问题，后续截图可直接复用 CLI）。
- 提审前置 = 第 3 区第 1/2/3/6 项；第 2 区真机项建议提审前用体验版过一遍音频三连（锁屏/中断/定时）。
- 本表随版本演进：每轮改动如引入新的"未验收"项，追加到对应分区并标来源日期。
