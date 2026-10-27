# 睡点 · 当前上下文（context.md）

> 最后更新：2026-10-26 · 这份文件是“当前代码事实”的速查，不替代 PRD/架构文档；重大改动先改这里，再同步 docs。
>
> **AI 工具入口**：[AGENTS.md](AGENTS.md)。任何工具的新会话先读它（阅读顺序 / 事实优先级 / 门禁期望值 / 生产红线），本文件是其中第 1 步的事实速查。

## 1. 当前产品形态

- 微信小程序，三个 tab：**计算器 / 入睡 / 统计**。
- 计算器：**双向单卡 3D 计算器**（2026-10-20 重构）。默认「我想几点醒」，卡顶轻量切换为「我想几点睡」；正面 12h 时间轮 + 共享入睡耗时 + 主按钮，点击后仅计算卡 `rotateY(180deg)` 到结果面；结果面第一推荐突出、其余两行弱化，支持「重新选择」和「换成另一种算法」。算法仍复用 `utils/plan.js`，未改。
- 首页 Hero：支持后台配置的多张背景图，默认图免费并静默缓存；用户选择其他背景需看激励视频解锁，到期回退默认。标题区背景图从状态栏后开始，底部渐隐到现有夜色。
- 顶部：计算器页使用 `top-bar brand-only`，只显示「睡点」，右侧留给微信原生胶囊；`action-text` 位现放「换背景」（贴 `capsuleGap` 安全距离右对齐，`bind:action` 打开背景选择器），入睡/统计页不传该属性、不渲染。
- 计算器 Hero 文案与卡顶胶囊**同侧**（2026-10-22 修正）：「选择起床时间」→「想几点起？」/「选一个起床时间，找到适合你的睡点。」；「选择入睡时间」→「想几点睡？」/「选一个入睡时间，找到适合你的起床时间。」。标题描述**你要选的时间**（输入），副标与主按钮描述**算出的结果**（输出）。两个方向都不写「今晚/明早」（白天小睡结果会落在当天，陈述必须始终成立）。时间轮下陈述**选中时刻**的上下文：起床模式「明天 早晨 07:30 起床」（`nextWakeAt`）、入睡模式「今天 晚上 22:30 入睡」（`sleepAtOf`，超 30 分钟宽限按次日），翻日口径与结果面同源；结果头图标随方向切换（入睡点=月牙，起床时间=太阳）。结果面保留 5/4/3 三档主推荐（5=推荐），另加 6 个周期（9 小时）「充足/补觉」附加行（虚线分隔 + 薄荷色「补觉」标签，`plan.extra`；上床时刻已过时不渲染），不参与主推荐。脚注整行可点，打开底部说明层解释「为什么是 90 分钟」（一轮常见 70–120 分钟/平均约 90；8 小时=5.33 个周期；5 个周期=7.5 小时；结尾带「不构成医疗建议」）；打开时 `tabbar.hide()`，关闭/onHide 恢复。结果背面是固定 712rpx 翻转舞台：4 行结果（含补觉档）自动加 `.is-dense` 压缩纵向节奏，保证 `.result-share`（88rpx 热区）不溢出卡片；脚注 `margin-top` 48rpx 与分享/主按钮保持呼吸距离。
- 入睡：A 未记录 / B 睡梦中 / C 已完成；B 态可撤销，C 态展示入睡、起床、在床时长。
  - C 态大数字 = 当天在床时长（上床到起床，含午休/间断；2026-10-27 由「当天总睡眠」改名，标签走 `recordView.durationK`）；下方时间线同口径 = 首段上床 → 末段起床（单段时显示「上床/起床」，多段时「当天首段上床/当天末段起床」）。有 `sessions[].sleepAt` 时多一行「入睡 HH:MM · 睡着 X · 效率 N%」（睡眠效率 = 睡着 ÷ 在床，取有标记的最长段，只陈述数字不评价）。**轨道按本日睡眠段分段**（亮条=睡着，缺口=清醒，按首末跨度比例落位），多段时轨道下补段间说明：间隔 < 90 分钟写「N 段 · 中间醒了 M 次（X 分钟）」，≥ 90 分钟写「N 段 · 相隔 X」，解释总睡眠与首末跨度为什么对不上。
  - 「本日睡眠段」每行右侧「修改 / 删除」两个文字按钮（加粗、异色、无边框）；删除有确认弹窗（唯一段时提示整天一起撤销），删空当天 = 撤销整天（写墓碑），剩余段重算主睡眠与总时长（`storage.removeSession`）。
  - C 态主操作两个小型按钮同一行：「继续入睡（开始计时）」主按钮 +「补记入睡」次按钮；下方「记录有误？撤销当天记录」不变；A 态补记入口文案同为「补记入睡」。
  - 原「最近 7 天」柱状区与试做的「睡眠轨迹圆盘」（canvas 24h 环）均已移除：圆盘与入睡圆环在 sleeping/idle 态信息重复（入睡时刻/已睡时长是 orb 的第三个副本）、占空间，且“声音/计算器摘要/睡眠知识”等替代内容均与既有入口重复。现该位置只保留一行轻量统计「本周 X 天 · 连续 Y 天 · 查看统计 ›」（0 数据时不渲染，点击进统计），7 天柱状、`buildWeekDays`、`components/sleep-disc`、`utils/disc-geometry.js` 全部删除（本周/连续计数保留）。
  - **熄灯（睡前模式，仅 sleeping 态）**：打卡后立即进入持久熄灯——全屏毛玻璃（`rgba(4,7,15,0.84)` + `backdrop-filter: blur(20rpx)`，不支持 blur 时深底自动退回接近关灯）压暗整页，只留熄灭态入睡时间（orbTime/orbMeta，`filter:brightness(0.84)`）+ 顶部「晚安」+ 底部「轻触任意处唤醒」；**tabBar 同步 `tabbar.hide()`**（独立 root 压不住）。熄灯态 orb 不可点：任意点触 = 唤醒（`wakeUp` → tabbar.show），唤醒后再点 orb 才进结束面板；唤醒后 30s（`LIGHTS_OUT_DELAY`）无操作自动回熄灯，任何页面触摸（根 view `bindtouchstart`）重置计时。结束面板/声音抽屉打开时、done/idle 态、页面 onHide 均不熄灯；保存/取消面板后恢复倒计时。熄灯层底部新增「结束入睡」按钮（一次点击按当前时间落库，超 24h/重叠/容量满时唤醒并打开结束面板校准）；入睡中圆环提示词为「点击圆环、结束入睡」（不再写“记录起床”）。**超 24h 未结束**：B 态显示常驻提示卡，两个出口「结束并校准」（打开结束面板）与「丢弃这段」（二次确认后清 pending、取消该会话提醒、不写记录、不上传云端）。
- 统计：**2026-10-27 移除整块标题区**（REVIEW / 回顾 / 副标），首屏直接从周期行开始（`.stats-page` 顶部留 20rpx）。首屏 3 列核心指标（平均睡眠 `3h39` / 平均上床 / 平均起床，卡面只有大数字 + 短标签，与上一段的对比下沉到点击展开的说明卡：duration 4 行、bed/wake 3 行；平均睡眠下方按常见 7.5–8 小时给事实陈述，不足 3 天提示补记）。**指标周期（2026-10-27）**：默认本周（周一 00:00 起），本周 0 天时自动回退「最近 7 天」→「全部记录」并在指标上方显示周期与区间（如「最近 7 天 10.20–10.26 本周还没有记录」）——周一刚过零点不会再出现「上面说没记录、下面日历满屏」；对比基线随周期切换（本周→上周同期；最近 7 天→前 7 天；全部→不编造对比）。口径实现=`stats.periodStats`，`metricsOf` 增加 `periodKey/periodLabel/rangeText/isFallback`、打卡日历（当月 92×76rpx 扁格可切月，列间距 4rpx / 行间距 16rpx；3/6/12 个月横向滑动 48rpx 格；格内时长用 `6h05` 精确到分钟、与详情卡同源，**不得再用 0.1 小时取整**（`6.1h` 会被读成 6 小时 6 分）；4 档色阶、选中态 + 详情卡）、近 30 天海报、云同步/清除数据（折叠）。近 14 天趋势已删除。**空格补记（2026-10-22 三轮）**：格内写「补记」，点击直接在统计页弹补记面板（醒来日 + 入睡/起床时间，复用 `sessions.rangeForDay`/`findOverlap` 校验，保存落 v2 session 并同步），不再跳入睡页；有记录/进行中/未来日仍走详情卡。**详情卡逐段可改/删（2026-10-27）**：`13:00–14:30 · 1 小时 30 分` + `改 / 删`，改走页内面板编辑态（醒来日只读、`evaluateManualRange` 传 `excludeId` 排除自身、保存 `storage.updateSession`），删走 `removeSession`（删最后一段整天撤销 + 墓碑）——统计页是历史记录唯一的修正入口（入睡页的 `onEditSession/onDeleteSession` 只处理当天）。视觉：指标区无底无框、居中弱色「点上方↑数字看说明」、底注「本月已记录 N 天」、海报按钮「生成 30 天海报」。**日历色阶（2026-10-27）**：4 档同色相由弱到强 `#5A57C8 → #6C68E8 → #8A90FF → #A5B4FC`（**必须用实色**：半透明紫在夜墨底上与空格只有约 1.25:1，短睡日会被看成没打卡；实色四档对空格约 3.1 / 4.1 / 6.6 / 9.2 比 1），最高档刻意不近白（近白在夜墨底会被读成空格/高亮）；格内文字低两档浅字、高两档深字。图例改为 4 段连成一条色阶条 + 各段居中标签（不再是 4 个分离小方块）。四处同步：`month-calendar` / `calendar-strip`（1 年视图）/ `stats` 图例 / `drawPoster` canvas `colors`。语义只表达「记录时长越长」，不写「睡得更好」。
- 声音：`audio-dock` 悬浮钮 + 迷你播放器 + 底部抽屉；搜索、分类、收藏、缓存、广告解锁、定时关闭（**默认关**：打开抽屉胶囊默认选中「关」，不跨会话回忆档位，明确选 30/60/90 才起表；到点/停止/失败即复位「关」）。入口仍在入睡页；播放后首页/统计页显示 `now-playing` 迷你条，可跨页暂停/继续/停止。**会话口径（2026-10-25）**：`utils/audio-session.js` 是 `lastTrackActive` 的唯一写入口——只有用户在小程序内停止、定时到点、权益到期、清除数据才隐藏迷你条；来电/闹钟/其他 App 抢占/系统 stop 只改播放态。注册 `wx.onAudioInterruptionBegin/End` + `App.onHide/onShow` 补偿，中断结束后自动续播（重设被清空的 `src`、曲末先 `seek(0)`）；用户在小程序内暂停过的不会被拉起。`player-state.armLoop` 用定时器兜底曲末回环（`onTimeUpdate` 官方只在前后台回调，锁屏后不再触发，回环尾部 1.2s）。停止需 3s 内二次点按确认（迷你条停止方块 / 抽屉「结束播放」，首点转暖红并提示）；中断 begin/end 上报 `audio_interrupt`（end 带秒数与 resume/skip），后台播放卡副标显示本周中断数。`audio-cache` 维护会话级坏源黑名单（`markBad/isBad/clearBad`），`peek` 跳过坏源、重下成功自动解禁，自动续播不再反复命中坏文件。**改音频前先读铁律：`AGENTS.md` §5 / `docs/12` §10**（状态单写入口、可见性、中断恢复、回环、停止二次确认、坏源与回归门禁）。音符与播放条三页统一底部安全位 `176rpx + safe-area`（2026-10-22 由 132rpx 上移，与悬浮 tabBar 顶边 128rpx 拉开 48rpx）；音符圆底为轻玻璃 `rgba(8,11,20,.30)` + `blur(18rpx)`，108rpx、右缘 26rpx。这条右下带（约 292rpx 顶点）由页面让出：统计页 `.safe-bottom` = `180rpx + safe-area`（运营定档——配合页脚广告位约 140rpx 把「数据与备份/展开」行抬出音符带；广告位关闭/失败时行会落回带内，广告实载时其下部被音符遮，要两者都避免需 ≥300rpx），入睡页天然安全未改。
- 分享：计算器结果背面、入睡页、统计页海报区均有 `share-btn`（button open-type=share），`onShareAppMessage` 按场景动态生成标题。
- 广告观测：`ad-slot` 加载成功/失败上报 `ad_show` / `ad_error`，后台概览显示今日/本周与分槽填充率。
- 顶部：自定义 `navigationStyle: custom`，通栏透明 + 延伸到胶囊前的全宽玻璃“灵动岛”，不再有固定原生导航背景。
- 后台：`/admin` 左侧主菜单 + 右侧单面板，10 个分类（含“用户数据”按 openid 查/删、2026-10-23 新增「安全」改密面板），sticky 保存条。
- 身份：AppID `wx378b0a7437d60998`；开发版 API `http://127.0.0.1:3100`，体验/正式版 `https://sleep.qfmaster.com`（`config/env.js` 自动切换）。
- COS：Bucket `qfmaster-1322402212` / `ap-shanghai`，对外 `https://img.qfmaster.com`，前缀 `sleep/`。

## 2. 目录与职责

```
miniprogram/
  app.json / app.wxss / app.js
  components/
  ambient/      深空渐变 + 呼吸月晕固定背景（已去星轨/星点）
  top-bar/      状态栏测量 + 透明通栏 + 灵动岛
  time-wheel/   自绘 12h 循环轮（3 周期 + 无感回中）
  audio-dock/   悬浮钮/迷你播放器/抽屉/解锁/缓存/收藏/定时
    month-calendar/ 当月打卡日历（4 档、可切月、选中态）
    unlock-sheet/ 解锁底部面板
    ad-slot/      页面展示位（4 槽，后台逐槽开关，未启用不渲染）
    share-btn/    页内转发入口（button open-type=share）
    now-playing/  跨页迷你播放器（仅播放后出现，入口仍在入睡页）
    background-picker/ 首页背景选择抽屉（分类/解锁状态/到期）
    empty-state/  空状态
  pages/
    index/        计算器
    sleep/        入睡
    stats/        统计
  utils/
    time.js       睡眠日、周、圆均值
    plan.js       双向倒推纯函数
    stats.js      周统计/结构化事实/趋势/月历/汇总 payload
    sessions.js   睡眠段（rangeForDay/rangeBetween/findOverlap/aggregate）
    manual-sleep.js 补记共享编排（默认时间/错误文案/区间校验/保存入参/回溯范围）
    format.js     时间/时长/问候
    storage.js    记录、会话、偏好、收藏、配置缓存、清除
    sync.js       云同步与回填
    audio-cache.js 下载/保存/巡检/监听
    audio-timer.js 跨页面定时关闭单例
    config.js / api.js / request.js / login.js / ad.js / ads.js / backgrounds.js / events.js
    launch-source.js  启动来源归一化（scene|path|from → app_open.target，看板来源分布）
  config/
    env.js        API 域名（唯一前端环境配置）
    fallback.js   服务端不可达兜底
  styles/
    sheet.wxss    跨页共享弹层样式（补记/结束/编辑，两页 @import）
server/
  src/app.js      路由、CSP、/api/ready、请求日志
  src/routes/     config/audio/summary/records/events/admin
  src/services/   config-store/admin-auth/storage-settings/cos/analytics/summary
  src/db/         memory/postgres 双实现
  public/admin/   后台 SPA
  public/site/    落地页（含小程序码动态展示 landing.js）+ H5 演示 + robots/sitemap/llms.txt
  sql/001_init.sql
docs/             00–13 文档（含常用操作、关键更新与验收清单）
tests/            Node 纯逻辑测试
```

## 3. 配置边界（重要）

| 配置 | 位置 | 是否可视化 |
|---|---|---|
| 音频清单/名称/分类/URL/排序/图标 | `/admin` 环境音 | 是 |
| 解锁广告位、解锁方式、有效期、失败策略 | `/admin` 广告与解锁 | 是 |
| 页面展示位（首页 / 入睡 / 统计 ×2）开关、广告位 ID、类型 | `/admin` 广告与解锁 → 页面展示位 | 是 |
| 首页背景图（标题/分类/URL/启用/排序）、默认图、解锁时长、图片上传 | `/admin` → 背景图（上传走 COS；默认压缩 webp，可勾选「保留原图」） | 是 |
| 落地页小程序码 URL 与二维码文案 | `/admin` → 落地页（上传走 COS `site/` 前缀，清除后落地页回退搜索提示） | 是 |
| 事实回顾、云同步、定时、预加载、缓存上限/TTL | `/admin` 功能与缓存 | 是 |
| 解锁面板标题/说明/按钮 | `/admin` 解锁文案 | 是 |
| COS Bucket/Region/域名/路径/SecretId/SecretKey | `/admin` 存储与上传 | 是（密钥加密、不回显） |
| 小程序 AppID / AppSecret / API 域名 | 微信公众平台 + `.env` + `config/env.js` | 否（启动/发布配置） |
| 后台登录密码 | 首次 `.env` 的 `ADMIN_PASSWORD` 引导；后台「安全」面板改密（scrypt 入库、旧会话立即失效） | 是 |
| LLM | 未接入 | — |

- **“配置 JSON”只是只读检查**，不是要求手改；运营字段全部有表单。
- 分类不是独立表：每条音频一个 `category` 字符串，客户端去重生成筛选；后台输入框带已有分类 datalist。
- 收藏是本地 `meta.favoriteAudioIds`，不参与云同步；换机不迁移。

## 4. 数据与同步

- 本地记录存 `sleep:records:v1`，按**醒来日**归档（v2：`records[day].sessions[]`，一天可多段）；`pending` 是进行中会话。
- **统计口径**：统计页 Hero / 趋势 / 日历 / 海报统一用**当天在床时长**（上床到起床，含午休/间断段，`totalDurationMin`；2026-10-27 由「当天总睡眠」改名，`durationMin` 仍按 `endAt - startAt` 计算）；详情里拆分夜间与午休。`durationMin`（主睡眠）仍用于连续天数与服务端模板，两套字段并存但页面不再混用。`sessions[].sleepAt` 是可选的真实入睡时刻（`startAt < sleepAt < endAt`，本地与服务端白名单均放行），只用于展示与睡眠效率，**不进 `durationMin`**。
- **云备份默认关闭**（`meta.syncEnabled !== true` 时 `syncNow` 直接跳过，不发任何请求）；用户在统计页显式开启后，才用静默 `wx.login → openid` 归属上传，不获取头像/昵称/手机号。
- 服务端 `sleep_records` 主键 `(openid, day)`；`/api/records/sync` 幂等 upsert：v2 记录 `day` 由主睡眠 `wakeAt` 重算、v1 记录仍按 `sleepDayOf(bedAt)`，单条脏记录丢弃并返回 `dropped`，不再整批 400；`includeAll` 类型校验在写库前完成。
- 云备份客户端按每片 60 条分片、覆盖最近 400 天；服务端单次上限 62 条。
- 删除：`sleep_record_deletions` 存单日墓碑，`user_erasures` 存全量清除水位；客户端上传 `deletedDays`，并接收服务端墓碑/水位清理本机旧记录。
- `POST /api/records/erase` 删除该 openid 的睡眠记录、解锁与事件并写 erasure 水位，客户端成功后才清本地；清除前发出的在途 sync 由 `syncEpoch` 丢弃。
- 客服/合规：`GET /api/admin/users/:openid` 查询、`DELETE /api/admin/users/:openid/records` 删除；后台“用户数据”面板，删除记审计日志（openid 哈希前缀，不落明文）。
- 取消/撤销：B 态撤销只清 pending；C 态撤销写本地墓碑并在下次 sync 上传 `deletedDays`，云端按日删除。
- 一天多次睡眠：完成态可「继续入睡（开始计时）」或「补记入睡」，新段追加不覆盖；每段可单独改时间（修改）/删除（`storage.removeSession`，删空当天走墓碑），保存前按时间区间（跨全表）挡重叠。尚未引入独立的 `nap` 类型字段。

## 5. 当前验证基线

- `npm test`：**460 项 / 459 通过 / 0 失败 / 1 skip**（2026-10-27 反馈闭环 + 背景文案轮实测；PG 集成用例在未设置 `PG_TEST_URL` 时跳过）。
- `npm run check`：3 页面 / 22 JSON / 17 WXML / 19 WXSS，主包约 708.0 KB（以最新输出为准）。
- `npm run verify:web`：11 页 / 3 条内链，无 404（2026-10-26 批次 D）。
- **验收清单（2026-10-22 建）**：全部待验收项已合并至 [docs/13-acceptance-checklist.md](docs/13-acceptance-checklist.md)，分三区——本机已验收（CLI 模拟器 390×844 实测，含入睡页 10-22 改版与统计页 10-21 改版全状态截图、console 无 error）/ 待真机（音频锁屏、中断、定时、手势手感）/ 待外部输入（部署、AppSecret、COS 防盗链、流量主）。续作新增"未验收"项一律先落该表再写代码。
- 交付包：以 `release-artifacts/` 下最新 `getsleep-<label>.zip` 为准（`npm run pack` 生成，含 `RELEASE-MANIFEST.json` 与逐文件 sha256，同时留 `.sha256` 校验文件）；打包前会强制跑 `npm test` + `npm run check`。
- 分享归因冒烟（2026-10-19，内存模式）：`app_open` 带 `1007|pages/index/index|share` 上报 → `/api/admin/analytics` 的 `topSources` 聚合出现；`/api/share/qrcode` 无 code 返 400、密钥不可用返 503，均为优雅报错。
- 微信开发者工具（AppID `wx378b0a7437d60998`）：三页真实编译；热力图滚到最新周；C 态“覆盖今晚”渲染；控制台无 error；实际触发 `/api/records/sync` 返回 20 条并带 `deletedDays/erasedAt`。
- 本地 PostgreSQL + API（3100）：`/api/ready` 200；PG `syncRecords` 的 day 归一化/墓碑/erasure 事务、`saveUnlock` 单行覆盖均实测通过。
- 后台浏览器实测：左菜单切换、音频标题保存、配置接口写库、窄屏横向 tabs、无 console error。
- 未验证：真机锁屏续播、激励视频、真实 COS 上传、海报导出、H5 新结构；统计页改版的 390×844 截图与真机点击校验（见第 7 节第 19 条）。

> 2026-10-22 更新：上述"未验证"中的**本机可验部分已全部完成**（CLI 模拟器截图 + 交互走查，console 干净，详见 docs/13 第 1 区）；剩余项按该表第 2 区（真机）与第 3 区（外部输入）跟踪。

## 6. 部署幂等性

- `docker-compose` 使用命名 volume 保存 PostgreSQL；升级 `docker compose up -d --build` 不删 volume。
- `sql/001_init.sql` 与启动 DDL 都是 `CREATE TABLE IF NOT EXISTS`；当前无破坏性迁移。
- `app_config` 是 JSONB，新配置字段由 `normalizeConfig` 补默认值，旧配置可继续读。
- 新增记录字段/表时必须写**加法迁移**（`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`），不要改旧列类型；上线前 `deploy/backup.sh` 备份。
- 配置/记录不会被镜像重建清空；只有显式 `docker compose down -v` 才会删库。

## 7. 已知风险与待决策

1. **COS 防盗链**：当前 `img.qfmaster.com` 的音频可匿名 HEAD 200；若开启防盗链，需放行 `servicewechat.com`（及 `https://sleep.qfmaster.com`），否则真机 403。
2. **真机未验收**：DevTools 已跑通，但锁屏续播、耳机/来电中断、激励视频、真实 COS 上传仍需真机；`sleep.qfmaster.com` 尚未部署，当前 SSL 不可用。
3. **后台改密码已实现**（2026-10-23，ADR-013）：scrypt+盐入库、当前密码校验、改密即全端会话失效、审计留痕；`.env` 的 `ADMIN_PASSWORD` 仅首次引导。后台「安全」面板的浏览器点击仍待人工验收（docs/13 §1.6）。
4. **大模型未接入**：当前 `/api/summary` 是模板，稳定、零调用成本、合规；LLM 仅适合可选润色，默认关闭，需超时/禁词/降级。
5. **午休/多次睡眠**：已支持一天多段（v2 `records[day].sessions[]`，主睡眠取最长一段用于连续天数与详情拆分，统计页 Hero/趋势/日历统一展示 `totalDurationMin` 总睡眠）；未做独立的 `nap` 类型字段，跨天段由客户端按“醒来日”拆到各自记录（一段只归一个醒来日）。
6. **H5 仍是旧结构**：`/demo/` 已修空播放条、全过期展示和解锁 TTL 读取，但仍是旧三屏结构；三 tab + audio-dock 待重做。
7. **单实例**：限流、配置缓存、事件都在进程内；扩容前换共享存储。
8. **音频后台边界**：定时器已持久化并在 onShow/onEnded 重新校时，但 iOS 完全冻结 JS 时无法保证毫秒级准点。会话层（2026-10-25）已用 `wx.onAudioInterruptionBegin/End` + `App.onHide/onShow` 补偿中断恢复，`player-state.armLoop` 用定时器兜底锁屏回环；模拟器实测「外部暂停→回前台自动续播」「应用内暂停→不续播」「应用内停止→迷你条消失」三条通过。**仍待真机**：来电/闹钟的真实 interruption 回调顺序、锁屏 3 分钟音源连续多轮回环、耳机拔出、通知栏暂停（API 无法区分原因，当前按“外部中断可恢复”处理，用户在小程序内暂停则一定不拉起）。
9. **部署端口**：compose 已把 API 绑到 `127.0.0.1:3000`；1Panel 反向代理必须保留 `TRUST_PROXY=1`，且不要额外放行 3000 到公网。
10. **展示位与流量主**：4 个页面展示位默认关闭；广告位需先在公众平台创建并审核通过，后台填 ID + 勾选启用后才渲染。未开通时 `<ad>` 报错会被组件静默吞掉。
11. **云备份与“零登录”口径**：同步依赖静默 `wx.login → openid`，不弹授权、不取资料；对外文案只说“零登录、零授权、数据默认本地”，不承诺“无广告/不弹窗”。
12. **首页背景图**：默认图免费、静默缓存；用户主动更换需看激励视频，使用时长 1–168 小时（后台统一设置），到期回退默认。图片存 COS（`backgrounds/` 前缀），后台需先在“存储与上传”配置 COS；图片域名需在 `downloadFile` 白名单（当前复用 `img.qfmaster.com`）。缓存最多 6 张，淘汰/清除会删除本地文件；选择器缩略图走 COS `imageMogr2`，失败回退原图。真机需验证 3D 翻转、时间轮滚动与背景图切换。
13. **分享归因与海报码**（2026-10-19 新增）：来源分布从新版小程序发布后才开始积累；海报小程序码依赖 `.env` 的 AppSecret 且小程序已发布，两者未就绪时海报自动回退"微信搜索「睡点」"落款，真机扫码链路待发布后验收。
14. **2026-10-20 L4 深审收口**：P1 与高优先级 P2 已落地，详见 [docs/11-changelog.md](docs/11-changelog.md)。改后模拟器已复验背景图显示与时间轮拖动；上午/下午的合成点击在桌面注入下未能稳定复现，已移除正面 3D 命中偏移风险，仍需在真机/手动模拟器点按确认。其余外部/非阻断门禁：落地页 ICP 备案号仍是占位；后台配置历史/回滚、内存模式标识、PG 看板事件上限等运维增强未做。真机、真实广告、真实 COS 防盗链仍需发布前验收。
15. **2026-10-20 深审修复轮**：音频双 onError 状态机、统计事实回顾本地兜底、同步合并批量化、后台无数据用户清除水位、海报超时/睡眠会话清理/缓存并发/广告塌陷/后台存储 503/默认背景停用等 19 项已修复，详见 changelog。新增 `player-state`、`audio-cache`、`sync-merge`、`storage-settings` 回归测试。仍待真机：锁屏/通知栏停止后恢复、同一 `src` 重赋值循环、来电中断倒计时。
16. **2026-10-21 L4 收口**：音频幽灵播放态 / ended 双写、后台配置并发覆盖、存储过滤回写丢历史、计算器重算推后一天、统计页重复全量刷新与热力图强制 seek、时间轮小幅拖动不回中、墓碑无回收、memory/PG 双实现不等价、无进程级异常兜底、音频 loading 无超时、折叠遮罩层级、`--color-primary-soft` 缺失与 Hero 压暗两套数值等 14 项已修复，详见 changelog 与 `docs/09-redesign.md` 的 token/层级表。门禁：`npm test` 147 通过 / 1 skip、`npm run check` 通过、开发者工具 390×844 三页 + 抽屉 + 熄灯遮罩截图复核、打包 `getsleep-L4-20261021.zip`。仍待真机：杀进程重进不出现幽灵播放态、短音源循环只重播一次、时间轮拖动回中、展开迷你条后第一次点 tab 直切页。
17. **层级实现事实（2026-10-21 实拍校正）**：自定义 tabBar 渲染在**独立 root**，页面级 `z-index` 无法覆盖它；需要隐藏悬浮胶囊时只能调用 `utils/tabbar.hide()`（audio-dock / background-picker / 结束面板已这么做）。`pages/sleep` 的熄灯遮罩（z-index 150）2026-10-22 起是**持久前的睡前模式层**（不再 1.6s 自动消失），进出熄灯时同步 `tabbar.hide()/show()`；熄灯态下页面内容被毛玻璃覆盖，点击遮罩即唤醒。
18. **睡眠段复审修复（2026-10-21）**：结束/补记/编辑三条保存路径曾因把 `sessions.rangeForDay` 误写成 `stats.rangeForDay` 全部失效（P0），已修并新增 `tests/sleep-page.test.js` 页面级冒烟；同时补跨天重叠检测（`sessions.findOverlap`，页面预检 + `saveSession`/`updateSession` 三处）、把“忘记结束超 24h”的入睡日固定为打卡日并允许改醒来日（`sessions.rangeBetween`）、30 秒时钟拆成轻量 `refreshClock()`、日期上限随自然日刷新、超时提示按 pending 去重、保存/同步反馈统一。服务端 `/records/sync` 的 `includeAll` 校验前置到写库前。服务端仍只校验单条记录内部的段重叠，跨天重叠以客户端为准。详见 changelog。

19. **入睡页改版待真机验收（2026-10-22，机验已完成 2026-10-22）**：总睡眠时间线口径、段列表删除（确认弹窗/唯一段整天撤销/墓碑）、CTA 同行小按钮已完成；「睡眠轨迹圆盘」经两轮反馈（先弱化、后判定与入睡圆环信息重复）**已整体移除**，原位只留一行「本周 X 天 · 连续 Y 天 · 查看统计 ›」。`npm test` 203 项 / `npm run check` 通过；**CLI 模拟器 390×844 已实测**（A 态 0 数据统计行不渲染、B 态 overdue 结束面板、C 态同行 CTA/段列表/统计行、删除确认弹窗唯一段文案、取消后记录保留），console 无 error。剩余仅真机手感项（删除弹窗/CTA 布局按压力度），见 docs/13 第 2 区。
20. **睡前熄灯（2026-10-22，机验已完成）**：打卡后进入持久熄灯（毛玻璃 0.84 + blur20rpx，降级深底接近关灯），只留熄灭态入睡时间 + 「晚安」+「轻触任意处唤醒」；tabBar 同步 `tabbar.hide()`；熄灯态 orb 不可点（任何点触=唤醒），唤醒后 30s 无操作自动回熄灯（`LIGHTS_OUT_DELAY`，页面根 `bindtouchstart` 重置）；结束面板/声音抽屉打开、done/idle、onHide 均不熄灯。`npm test` 224 项绿（新增熄灯 7 条）。**模拟器 390×844 已实测**：打卡即熄灯、点触唤醒（仍睡梦中、tabBar 恢复）、34s 自动回熄灯且「已睡」时钟更新、console 无 error；截图 `docs/assets/sleep-lights-out.png`。真机仅剩毛玻璃观感与 Android 降级确认。
21. **统计页改版待验收（2026-10-21，机验已完成 2026-10-22）**：结论卡（平均睡眠 + 上周对比 + 7–9h 参照）、近 14 天趋势、结构化事实、当月打卡日历已完成；改版后自审修复了刷新签名漏 `todayKey/partialDay/同步状态`、本周 0 条文案误报、进行中第二段不可见、清除数据不重置月份、选中态与详情不同源、`bedSpreadMin` 为 null 拼接等问题。`npm test` 191 项绿、`npm run check` 绿；**CLI 模拟器已实测**（空态、3 列指标、指标展开说明卡含常见 7.5–8 小时陈述、打卡日历数据格/空白天补记入口、周期切换、折叠备份区），此前 MCP 代理失败是工具链问题、CLI 通道不受影响。剩余仅真机点击项（20 次连续点格），见 docs/13 第 2 区。旧 `components/heatmap` 与 `components/sleep-trend` 已于 2026-10-23 删除（零引用）；服务端 `/api/summary` 保留但统计页不再请求。
22. **补记编排单源（2026-10-22 评审整改）**：统计页补记与入睡页「补记一段睡眠」此前是两套复制实现；已抽 `utils/manual-sleep.js`（默认时间/错误文案/区间校验/容量与进行中预检/保存入参/可补记窗口）与 `styles/sheet.wxss`（弹层样式），两页只保留 UI 与页面编排。同时修复 `manual_sleep` 不在服务端事件白名单导致整批事件被丢弃的既有缺陷。口径：统计页允许「正在入睡中」补记历史日（多段模型合法，面板校验会挡与进行中段相交的区间），入睡页仍只在 idle/done 提供入口；**可补记下限对齐云同步窗口（400 天，`EDIT_WINDOW_DAYS` = `SPAN_DAYS`，测试锁死）**——窗口外的补记只存本机、换机即丢，日历仍可翻 24 个月看历史但窗口外空格不提供补记。详见 changelog 2026-10-22「L4 评审整改」。
23. **2026-10-23 提审前收口**：①修复编辑守卫对跨午夜段的误判（`editingSessionOf()` 判断原段是否跨天，同日段仍拦截）；②删除零引用组件 `heatmap`/`sleep-trend`；③看板新增 `manualSleeps`（today/week）与「今日补记」卡片；④后台改密闭环（ADR-013）：scrypt+盐存 `admin_credentials`、env 仅首次引导、令牌 v2 带凭据版本（改密即全端失效）、独立限流桶、审计 `admin_password_change`。**坑**：`db.getSetting` 返回 `{value, updatedAt}` 包装，启动装配必须取 `.value`。门禁：300/299/1 skip、check 绿、真实进程冒烟通过、打包 `getsleep-20261023-l4.zip`；后台「安全」面板浏览器点击待人工验收。

23b. **L4 Code Review P1 修复（2026-10-22）**：①统计页 refresh 签名补 `monthOffset + monthKey`（空月切月被去重吞掉 → 标题/格子/canNextMonth 不更新且 `monthOffset` 已变，双向卡死）；②熄灯闭环——`openEndSheet` 的「刚睡下」早退分支补 `scheduleLightsOut()`，声音抽屉关闭新增 `sheetclose` 事件由入睡页重排倒计时（抽屉打开期间到点的熄灯会被跳过）；③编辑既有段时禁止 `rangeForDay` 的「回退一天」（入睡 ≥ 起床直接报 order，避免午休被静默改成 23.5h）；④补记校验新增 `pending`（进行中的段不在 records 里，相交会与结束计时互锁）；⑤计算器结果面改「入睡耗时」不再清 `_anchorAt`，并在主推荐前渲染「明天」（late 分支也保留日期前缀）；⑥`eraseUserData/eraseCloudData`（memory + PG）补删 `sleep_reminders`——清除全部数据后不再收到订阅推送、openid 不再留存；⑦音频 `onError` 增加 `_expectSrc` 归属校验 + 缓存文件可用性判断（`cache.isUsable`，文件正常时只本会话拉黑、不删磁盘），避免切歌竞态误删新曲缓存。已知限制：BAM 的 onError 不带 src，「已切走旧源的迟到错误」只能按 src 弱判据收敛。验证：239 项绿、check 绿；模拟器实测空月切月、凌晨跨日文案、熄灯早退 30s 回熄灯，console 无 error（截图 `docs/assets/l4-p1-*.png`）。

24. **L4 阶段 A/B 修复（2026-10-22，发版前收敛）**：A 批——①结束/补记统一做容量预检（`manual-sleep.capacityErrorOf`：当天 ≥8 段或总时长 >24h 直接给「最多 8 段 / 不能超过 24 小时」，不再等 `saveSession` 静默 false 后无出口重试；编辑先扣旧段）；②`sessionsOf` 对 `sessions: []`/全非法段回退 `bedAt/wakeAt`，`buildRecordView` 空段返回 null 并给「可撤销后重新记录」提示，杜绝完成态整页无法渲染；③墓碑时间统一 `max(now, updatedAt+1)`（删除/编辑迁移/合并 v1 三处），修设备时钟偏慢时云端「updated_at <= deleted_at」删不掉导致的删除回灌；④音频缓存原子替换不再 `unlink(dest)`，改为先改名备份、换入失败还原，避免删掉 BackgroundAudioManager 正在读的在播文件。B 批——⑤「比上周」改**同期**口径（上一周只取与本周已过天数相同的一段，文案统一「比上周同期」）；⑥背景 A→B 切换（含另一张付费图）统一弹「还剩 X 小时」确认，不再静默作废剩余解锁；⑦日历 3/6/12 个月的去重键加入周期与月份范围，切年视图重新停靠最新月；⑧四处关键提示去 opacity、字号提到 20rpx（熄灯「轻触任意处唤醒」/月历「补记」/日历图例/「时间不准可修正」）；⑨audio-dock 的同名类重复定义收敛为单一来源（`.dock-mini`/`.dock-fab` 定位与玻璃底只保留文件末尾一块）。待视觉验收的大改（主按钮/弹层三件套、三页标题音量）未动，列入下一批。验证：254 项绿、check 绿；模拟器实测同期文案、12 个月停靠、脏 `sessions: []` 回退（`hasView=false` + 提示）与无可用段不白屏、C 态提示与音符位置，console 无 error（截图 `docs/assets/l4-b-*.png`）。

25. **L4 视觉批次（2026-10-22）**：①主按钮一套化——`app.wxss` 新增 `--btn-primary-bg/-fg/-shadow`，计算器/入睡页同行 CTA/结束面板/解锁面板四处引用（亮底深字），消掉 3 套紫与 2 种文字色；②底部弹层统一参数（36rpx 圆角、`rgba(16,22,40,.98)` 深底、64×5 抓手、`.62 + blur 8` 遮罩），三处对齐并在注释互相指向（组件样式隔离，不复用类名）；③`.page` 200rpx 与入睡页 190rpx 补 `env(safe-area-inset-bottom)`；④空态删除四颗装饰星（回归“无星点”基线）；⑤年视图日号 14→16rpx、星期 12→14rpx；⑥**刻意不做**三页标题统一（Hero 72 vs 页面标题 56 属层级差异，统一会挤压统计首屏）。验证：254 项绿、check 绿（496.1KB）、五张模拟器截图 `docs/assets/l4-v-*.png`、console 无 error。

26. **L4 阶段 C（2026-10-22，工程护栏）**：①生产环境 `TRUST_PROXY` 未显式设置时拒绝启动（显式 `0` 允许直连并保留告警），`docker-compose.yml` 给 api 补 `TRUST_PROXY:-1` 兜底，避免已有 1Panel 部署升级即挂；②`/records/sync` 增加 openid 维度 30/min 限流（IP 桶全站共用时的第二道闸）；③归档日统一固定北京时间——`time.calendarDayKey(ts)` + `sessions.sessionDay` + `sync` 的 `localDay` + 容量预检/面板文案/编辑校验，修设备时区变化导致本地 day 与云端 day 分叉（重复记录 + 墓碑互写）；`dateKey` 仍本地，仅用于“今天/昨天”文案；④`audio_error` 进事件白名单，target=`trackId|errCode`（1s 去重），线上可区分网络/解码/坏缓存。验证：260 项绿、check 绿（498.4KB）。未做：C4 换号归属（待 ADR-025 拍板）、C5 音频签名（需 COS 私读）、C6 订阅召回（需模板）。

27. **订阅消息后台可视化（2026-10-22）**：后台新增「小程序与提醒」面板（启用开关 / 模板 ID / 跳转路径 / 获取步骤 / 只读环境状态）；`config-schema` 增加 `reminder` 段并严格校验模板 ID（10–64 位字母数字_-）与跳转路径（`pages/...`）；`/api/config` 改为后台配置优先、env 兜底；`/api/reminders` 与调度器每轮读当前配置（保存即生效，关闭后不再推送已排队任务）；新增 `GET /api/admin/env`（只返回是否就绪，不含密钥值）；客户端 `fallback.reminder.enabled` 与 `reminder.js` 同步。配置路径与字段要求见 `docs/10-operations.md` §3.2.1、`docs/03` §4.1。验证：285 项绿、check 绿（510.0KB）、真实实例 API 闭环（保存 → `/api/config` → `/api/admin/env`）。

28. **代码审查修复轮（2026-10-23）**：外部审查 2 P1 / 9 P2 / 约 20 P3 逐条核验后落地——①迷你播放器补「停止」（`close()` 原为零绑定死代码）；②`admin-auth` 签名密钥改为「根密钥 + 库凭据 salt/hash」派生，未配 `ADMIN_SECRET` 时改密即失效旧密码伪造能力（**升级后现有后台会话失效一次**）；③入睡页 tabBar 收敛为 `syncTabbar()` 单一裁决（修「关抽屉把底栏翻到结束面板之上」）；④入睡页补记默认值改 `napTimesFor({recent:true})`，新增 `recentFreeSlot` 从当前时刻回溯找空档（修 C 态首帧必红字）；⑤结果面 `result-row-time` 行高 1.15 + dense 压缩落到子项 + note 两行 clamp；⑥横滑月历未来日去整格 opacity、日号 18rpx、选中改 outline；⑦时间轮支持点击选值；⑧圆均值无解时改「算不出平均」不再拼「平均 --:--」；⑨`audio-dock` 回前台按指纹刷新配置 + `config.degraded` 区分「后台免费」与「配置没拉到」，恢复时用「网络已恢复」而非「解锁已到期」；⑩`now-playing` 删缓存前补 `isUsable`。P3 修：广告重试链重置 90s 超时、`/api/reminders` DB 异常 503 + 日志、后台改密审计日志变量兜底。**未做**：`<custom-tab-bar />` 清理（门禁强制）、统计页 0 数据补记入口（产品空态决策）、`001_init.sql` 单源、备份脚本管道退出码、`--heat-*` 死 token 等。验证：307/306/1 skip、check 绿（535.2KB）、改动文件 `node --check` 全通过；**视觉项未过模拟器**（开发者工具窗口打开被取消），已登记 docs/13 §2.5。

29. **订阅消息模板字段映射（2026-10-24）**：发送端原写死 `thing1`/`time2`，而公共模板库「睡觉到点提醒」（编号 26461）是 `time1`（提醒时间）+ `thing2`（超时惩罚），直接使用会返回 47003。后台「小程序与提醒」新增「模板字段映射」两个输入（提醒事项字段名 / 提醒时间字段名），`config-schema` 校验 `^[a-z]+\d{1,2}$` 且两者不能相同；调度器按当前映射动态构造 `data`。`docs/10` §3.2.1 补该模板的具体填法与「超时惩罚」措辞提醒（正式版建议申请 thing+time 模板）。验证：316 项 / 315 通过 / 1 skip。

30. **结果面提醒入口与列表呼吸（2026-10-25）**：入睡页「到点提醒我结束」改为「到点提醒我记录起床」（已开启态同步），消除“结束什么”的歧义；结果面主推荐行底部与「去入睡打卡」并排增加「提醒我入睡/提醒我起床」（仅主推荐、未过期时显示，不额外占纵向），点击走一次性订阅（`reminder.scheduleAt` → `plan-s-`/`plan-w-` 前缀 sessionId，不依赖 pending）；服务端按前缀发「该睡了/该起床了/结束入睡」。推荐列表行 padding 16→20rpx（dense 9→12、compact 10→13），主推荐间距 16→20rpx，4 行 dense 不溢出。验证：317 项绿、模拟器三张截图、console 无 error。

31. **结果面视觉细化（2026-10-25）**：「15 分钟入睡」胶囊 64→56rpx；主卡上下 padding 22→26（dense 16→20、compact+dense 16→18）；「提醒我入睡/起床」21→24rpx（dense/compact 22）并加字重；「去入睡打卡」改 flex:none + margin-left:auto（按内容宽靠右）；「重新选择/换成我想几点起」升级为实底/描边一对 pill（24rpx/72rpx）；「分享给朋友」改 share-btn icon 变体（图标+自定义文案）。4 行 dense 不溢出，console 无 error，check 540.8KB。

32. **播放后自动缓存（2026-10-25）**：普通播放原只 `peekCached` 不落盘，非 Wi-Fi 每次重播都重新拉流。现在 `play()` 后排队 `cache.ensure`：Wi-Fi 立即、移动网络延迟 15s（`cache.autoCacheDelay`）；`detached`/`stopPlayback` 清定时器；文案补「首」。同时修 `play()` 的黑名单顺序（先清 `_badUrls` 再 `peekCached`），否则失败拉黑后即使已缓存也走远程。代价：无法复用 BAM 流缓存，首次与流式并行约多 1 倍流量，之后本地 0 流量；平均听 2 次以上即净省。验证：318 项绿、模拟器 0/1→1/1（5.4MB）→重播本地路径、console 无 error。

33. **Code Review 修复轮（2026-10-25）**：①P1 结果面计划提醒落地页分流——`plan-s-`/`plan-w-` 改落 `pages/sleep/sleep?remind=sleep|wake`（`services/reminders.pageFor`，保存与发送两处改写，旧排队行发送时纠正），入睡页 `consumeLaunchIntent()` 统一消费 `end`/`remind`：「该睡了」永不开结束面板；②「去入睡打卡」写 `meta.planTarget`，打卡 `expectedWakeAt` 优先取计算结果（只消费一次，>12h/不在 16h 窗口丢弃）；③结果面提醒写 `meta.planReminder`，入睡页同一时刻的起床提醒视为「已开启」，重设撤旧、清除全部数据时取消；④「提醒我」先本地挡已过/已设/未配置再申请订阅，`mainPassed` 用真实时刻，设置后「✓ 已设提醒」，未配置/拒绝走日历兜底；⑤朋友圈单页模式隐藏跨页与提醒入口；⑥自动缓存实时取网络类型 + `maxMB` 容量闸。meta 新字段只存本机、不同步、非配置项。验证：332/331/0 fail/1 skip、check 552.4KB。**模拟器复核（2026-10-25 12:40）**：结果面 4 行 dense 不溢出、未配模板点「提醒我」弹日历兜底、入睡模式算出 20:22 →「去入睡打卡」→ `meta.planTarget.wakeAt` 同值 → 打卡后 `pending.expectedWakeAt = 20:22`（非白天默认 now+90min）且 `planTarget` 已清、console 0 error；「✓ 已设提醒」态需配置模板才能触达，与真机项一起见 docs/13 §1.14。开放项见第 34 条。

34. **Review 视觉与交互收口（2026-10-25）**：①P2-3 结果面「去入睡打卡」改为实底主药丸按钮（`--btn-primary-*`），主推荐卡上下呼吸空间拉开（内 padding 26rpx，外边距 20rpx），「提醒我入睡/起床」字号放大至 26rpx、图标 25rpx、颜色提高对比度，与上方列表间距拉大至 24rpx（原 6rpx），消除压迫感，4 行 dense 依然紧凑 0 溢出（截图 `docs/assets/l4-calc-result-breathing.png`、`l4-calc-result-sleep-breathing.png`）；②入睡页视觉优化——移除「只记录时间，不做睡眠评价」冗余文字，「补记入睡」改为精致小实底主药丸按钮，底部升级为「图标 + 分享这一段睡眠」（截图 `docs/assets/l4-sleep-visual-refined.png`）；③P3-5 统计页 0 数据态视觉升级——空态「去入睡」升级为小实底主药丸按钮，与次级「补记睡眠」形成极佳主次呼应，底部「数据与备份」标题由 24rpx 放大至 28rpx，右侧「展开/收起」字样由 20rpx 放大至 26rpx（截图 `docs/assets/l4-stats-visual-refined.png`、`l4-stats-settings-open.png`；单测 `tests/stats-page.test.js`）；④统计页有数据态视觉优化——指标区采用上下淡出（64%高）的微光弱竖线隔离，主指标「平均睡眠」强化至 52rpx / 700 纯白高亮，次级「平均入睡/起床」收敛至 44rpx / 500 次白；时间跨度选项紧凑化，当前项加无边框弱背景胶囊（`rgba(255,255,255,0.12)`）；日历图例居中排布（`justify-content: center`）并调弱透明度（0.8）（截图 `docs/assets/l4-stats-data-refined.png`）；⑤计算器结果面动作精简与去线框化——「重新选择」精简为「‹ 返回」，精准契合卡片 3D 翻转导航心理模型，字数减半给右侧长文案留出呼吸空间；`.result-reset` 与 `.result-switch` 移除边框，采用柔和弱背景胶囊（`0.08` 柔白与 `0.10` 浅紫），温润融入深空背景（单测 `tests/calc-copy.test.js`）；⑥入睡页进行中态（B态）优化——「到点提醒我记录起床」升级为简洁无边框弱实心胶囊按钮（`rgba(255, 255, 255, 0.08)`，开启态弱紫微光 `0.22` 高亮）；次级动作行重构为左右并排：左侧「点错了？撤销本次入睡」，右侧「分享这一段睡眠」，居中 560rpx 优雅两端对齐，消除层叠孤行感。验证：333/332/0 fail/1 skip，check 555.9KB。开放项仅剩需真实手机操作的真机项。

35. **按钮与文字触控弱状态反馈（2026-10-25）**：解决用户在快速轻触、误触或操作时“不知道是否点击成功、缺乏物理按压确认”的问题。按“计算器 → 入睡 → 统计”有序落地全局微信小程序双层按压反馈规范（原生 `hover-class` 配合 `hover-stay-time="100~120ms"` + CSS `:active`）：
    - **计算器页**：卡顶模式切换胶囊（`.mode-capsule`）、正面「用现在的时间」（`.now-link`）与「计算我的睡点」（`.calc-action`）、入睡耗时档位（`.fall-chip`）、背面「xx分钟入睡」（`.result-fall`）与「提醒我入睡/起床」（`.result-remind`）、主按钮「去入睡打卡」（`.result-go`）、底部轻量药丸「‹ 返回」与「换成我想几点睡/起」（`.result-reset`/`.result-switch`）、脚注「为什么是90分钟？」（`.calc-note`）均赋予 `scale(0.94~0.97)` 轻微弹性缩放与 `0.52~0.82` 触控弱状态；
    - **入睡页**：呼吸圆环（`.sleep-orb`）、通知横幅（`.notice`）、弱实心胶囊「到点提醒我记录起床」（`.sleep-reminder`）、超时卡片（`.sleep-overdue`）、文字链接「点错了？撤销本次入睡」（`.undo-bed`）、实底主按钮「补记入睡」（`.manual-entry`）、睡眠段操作「修改/删除」（`.session-op`）、完成态双按钮「继续入睡/补记入睡」（`.cta-mini`）、文字链接「记录有误？撤销当天记录」（`.undo`）、以及底部轻量统计条（`.stats-strip`）均补齐触摸按压反馈；
    - **统计页**：3 个核心指标卡（`.metric`）、周期选项切换标签（`.span-tab`）、详情卡内「补记一段 ›」（`.dd-add`）、底部「生成 30 天海报」（`.poster-btn`）、数据与备份「展开/收起」（`.settings-head`）、云备份「同步」（`.sync-btn`）、独立删除入口「删除云端副本」（`.cloud-del`）、以及「清除数据」红色文字入口（`.danger-entry`）全面配置物理轻按弱状态；
    - **公共层**：底部通用弹层面板（`styles/sheet.wxss` 中的 `.end-close` 关闭叉号、`.end-date-row` 醒来日选择行、`.end-time-item` 时间项、`.end-btn` 主次保存按钮）与空态组件（`empty-state` 中的主次按钮）全局生效。
    - **验证**：333 项测试通过（332 pass / 1 skip）、check 检查通过（主包约 561.9 KB）。

36. **双报告合并审查后的正确性收口（2026-10-26）**：①**同步 trailing**——`utils/sync.js` 在途期间的修改会被旧轮误报“已同步”且云端缺最新段；现在 `resyncRequested` 触发补跑（≤4 轮），`lastSyncAt` 只在无 trailing 时落，`whenIdle()` 覆盖 trailing 轮。②**提醒可信**——入睡页改为服务端排上后才写 `reminderOptIn`（原先写本地再请求，断网/配置关闭会留下“已开启但无提醒且无法重试”）；结果面“已设提醒”点击改为取消；结束打卡撤销匹配的 `plan-w-*`；服务端 `saveReminder` 允许 cancelled/failed/expired 恢复 pending（sent 幂等），路由校验真实写入后才回 ok。③**音频回环熔断**——`audio-dock.replay()` 原调 `markUserPlay()` 清零预算，8 次上限永远不触发；拆出 `markAutoReplay()`，并用 `player-state.setLoopGuard()` 让 `seamlessLoop` 也纳入同一预算。④**P2**：`wx.login` 10s 超时（防整条身份队列挂死）、`lastTrackActive` 写入口收敛回 `audio-session`、解锁到期巡检不再依赖页面可见、`/api/events` 按条跳过脏数据并回 `dropped`。⑤**交互/视觉**：圆环中心与统计提示提亮、6 处热区补到 88rpx、假禁用点击给 toast、`--c-primary-soft` 拼写修正、迷你条层级改 `--z-player`、首页 onShow 对齐外部偏好变更。门禁：`npm test` 367/366/0 fail/1 skip、`npm run check` 通过（603.0 KB）、音频四件套 47/47。**未机验**：对比度/热区视觉、提醒 cold/hot start、锁屏到期收口。详见 changelog 2026-10-26。

37. **复核收口：音频解锁失败埋点 + 热启动 + 单页模式 + 清除数据余量（2026-10-26）**：①`audio_unlock_fail` 上报 skipped/busy/error/unavailable；服务端白名单放行，analytics 汇总今日/本周失败、原因排行与加载失败率（`error+unavailable / 成功+两者`，排除跳过/忙碌），后台概览新增「音频解锁观测」。②`audio-dock` 回入睡页改 `loadConfig(true)`（3 秒 force 去重），后台新增音轨不必等 10 分钟缓存。③删除云端副本后同步清本地 `planReminder` 与 pending `reminderOptIn`；未开云备份时服务端 erase 失败保留 `cloudPendingErase` 重试入口。④订阅消息热启动由 App 捕获 `end/remind`，入睡页每次 onShow 消费一次（2 分钟 TTL）；单页模式显式隐藏 custom tabBar 与「换背景」；`app_open` 不再等配置成功才上报。⑤dense 结果面 pill 与首页脚注补 88rpx 命中区。门禁：`npm test` 405/404/0 fail/1 skip、`npm run check` 642.1 KB；模拟器热启动与单页模式已验，console 无 error。**本地环境音排查**：开发者工具 Storage 的 `sleep:dev-api` 覆盖到线上时，本地 3100 后台新增曲目不会下发；线上请求失败会回退 `sleep:config:v1` 旧缓存。移除覆盖并清配置缓存后重编译。**未验**：后台新面板浏览器点击、真实激励视频失败事件。

37. **环境音专项：播放条常驻（2026-10-26，产品口径）**：新增 `utils/player-surface.js` 统一 `audio-dock`/`now-playing` 的可见性判定——①只有用户在小程序内点停止（`lastTrackActive=false`）才隐藏入口；②有 `lastTrackId` 且未显式停止就一直显示，**冷启动/退出微信/悬浮 X 停止后都是“已暂停”的条**，点按可续播；③冷启动残影只归零 `lastTrackPlaying`，不再 `markStopped()`（旧实现会让重进小程序时条子消失）。切歌竞态：`onError` 用 `_srcSetAt` 挡切歌 1.5s 内的迟到错误，缓存回退远程后补 `safePlay + armLoadingGuard`。熄灯一键结束与提醒取消补偿见第 36 条与 changelog。**待真机**：冷启动保留条、悬浮 X 停止后续播、来电/切 App 恢复、锁屏多轮回环、熄灯按钮手感。

38. **环境音批次 C（2026-10-26）**：①**首播缓冲**——BAM 缓冲时的自动 `pause` 不再被当用户暂停（不冻定时、不收播放条），`waiting` 进入连接态 + 4s 补一次 `safePlay`；②**单曲缓存**——`audio-cache.sizeOf` + 列表长按 ActionSheet 只删该曲（在播曲目拒绝）；③**播放模式**——默认单曲循环，抽屉可切「收藏连播」（`utils/player-queue.js` 纯函数 + 6 测），刻意不做全列表顺序播放；解锁是全局 24h，与多首不冲突；④**继续上次**——抽屉顶部一键续听（不自动播放）；⑤**超 24h 未结束**——常驻提示 + 结束并校准 / 丢弃这段。门禁 385/384/0 fail/1 skip、check 621.1 KB。**未机验**：弱网首播、长按删除、连播切歌的悬浮音符、继续上次、超期丢弃。**下一批**：提醒模板字段快照（需迁移）、统计页 1 年视图性能、死码清理。

39. **体验版 P1：迷你条假播放（2026-10-26）**：真机打开体验版，迷你条显示「正在播放」但无声音。根因是 **BAM 无 src 时 `paused === undefined`**，调用方 `!paused` 得到 `true`，再叠加 `player-surface` 用 `lastTrackPlaying` 兜底。修复：`resolvePlayerSurface` 严格布尔（`playingNow===true && hasSrc===true` 才算播放），`cold = !playing && !sessionLive`；dock / now-playing 传参改 `!!audio.src && audio.paused === false`。模拟器复现（`src:false / paused:undefined`）后修复为 `playing:false`、副标「已暂停」、入口保留。视觉同轮：已缓存标记改纯粗箭头 ↓（去圆框），列表播放/暂停按钮去圆形描边、图形放大一档。门禁 388/387/0 fail/1 skip、check 624.3 KB。**待真机**：体验版冷启动、锁屏、打断恢复、X 停止后续播。

40. **统计页 → 计算器（2026-10-26 交付，2026-10-27 已移除）**：入口「按本周均值定今晚上床点」已按用户拍板删除——它是统计页唯一的建议型入口，与「只陈述事实、不评价不建议」的立场冲突，且均值可能只由 1–3 天得出。连带删除 `onPlanFromAverage`、`meta.prefillSleepMin` 的写入与首页消费块、`planLabel/bedPrefill`、两条单测。`stats.metricsOf` 仍输出 `avgBedMin/avgWakeMin`（海报与分享摘要用）。**保留的教训**：页面用例调用 onShow() 会启动 60s 时钟 setInterval，必须 `page.onHide()` + `events.clearQueue()` 收尾，否则 `node --test` 不退出。

41. **1 年视图缓存 + 误删更正（2026-10-26）**：①上一轮把 `calendar-strip` 误判零引用删除，导致 3/6/12 月视图空白——根因是 `Select-String -Path miniprogram` 未递归；已从 `dd4cceb` 恢复并在 `stats.json` 注册。②`utils/stats.js` 八个函数经递归复查仍被测试/页面使用，**不是死码**（上轮结论作废）；`fetchSummary`/`regularity` 复查确认零引用。③`stats.refresh` 增加日历缓存（`recordsStamp` + span/monthOffset/todayKey/partialDay），模拟器实测第二次 refresh 1ms。**教训**：判断“零引用”必须 `Get-ChildItem -Recurse` 或明确递归 glob，目录级 Select-String 会静默漏检。门禁 391/390/0 fail/1 skip、check 634.3 KB。

42. **音源链路 + 标题收缩（2026-10-26）**：①模拟器“只显示 1 条”根因是 `sleep:dev-api` 调试覆盖指向线上（被系统代理拦 → 降级 fallback）；清除后本地 6 条，后台/`/api/config`/前端三端一致（用本地后台 Cookie 会话验证）；本地第 1 条音源标题曾被误填为后台密码，已改回「雨声」。②结果面 Hero 标题收缩（72→40rpx、副标折叠），给结果卡让出约 90px（**2026-10-27 已推翻**：高度收紧导致翻面时整页上移，改为首行等高 + 回显与问句同号 72rpx + 副标隐藏但占位，见第 47 条）。③分享归因链路：`launchSourceOf` 把 `query.from` 归入 `app_open.target`（`scene|pages/index/index|share`），配合分享方 `track('share')`，看板 topSources 可见——链路完整无需新代码。**注意**：`sleep:dev-api` 仅 develop 读取，本地联调勿设为线上域名（会被代理拦截导致降级）。

43. **提醒瞬时失败重试（2026-10-26）**：`sleep_reminders` 加法迁移 `attempts/retry_at`；发送失败（非 43101）按 `attempts×60s` 退避保留 pending，**最多 3 次**后 failed；43101 直接 cancelled；重建任务重置预算、发送成功清零；`dueReminders`（memory+PG）尊重 `retry_at`。线上 PG 需跑 `001_init.sql` 或重启服务端让 `init()` 自动加列。

44. **1 年视图渲染懒加载（2026-10-26）**：`calendar-strip` 初始只渲染最近 6 个月（~210 节点），滑到最左（`bindscrolltoupper`）渲染全部并把视口钉回追加前最旧可见月份（`scroll-into-view`，不跳位）；同月份数据更新只刷可见格子。与第 39 轮的计算缓存（1ms）叠加后，1 年视图的计算与渲染都已收敛。

45. **工程核实与真机复测单（2026-10-26）**：①`audio-dock.wxss` 重复经脚本核实仅 29 选择器/约 64 行（非“两套 500 行”），27 处为后者覆盖的演进写法，**不合并**（收益/风险不成立）；②新增 `docs/14-真机复测单.md`（A 音频 9 / B 熄灯 4 / C 提醒 3 / D 统计 3 / E 分享 2 / F 部署 1），用户按单复测体验版、不通过项回传即修。

46. **部署前 code-review 修复（2026-10-26，范围 1b1371d..ade0da5）**：①**P0** 提醒字段快照在路由层断链（`currentReminder` 少返回 `thingKey/timeKey` → 落库空串 → 换模板后旧任务仍 47003；原单测绕过路由所以没暴露）→ 抽出 `server/src/lib/reminder-config.js` 共享归一化（route+service 共用）+ 3 条单测；②分享漏斗补齐：统计页/入睡页也上报 `share`（此前只有计算器页，看板系统性低估）；③`fallback.js` 补 `thingKey/timeKey`（AGENTS.md 五处同改）；④删除音频错误路径冗余 `lastTrackActive` 写入（§5.1）；⑤`scheduleReminderRetry` 两端统一（只写 attempts/retry_at）；⑥3 处缓存延迟注释改正（15s→8s/20s）。判定不修：统计页首次两次 refresh（fallback→线上配置，属刻意）、admin/schema 字段校验重复（重构风险大）。门禁 395/394/0 fail/1 skip、check 636.8 KB。

39. **L4 模拟器实测轮（2026-10-26）**：①**P0 工具链**——新增 `utils/player-queue.js`/`player-surface.js` 后仅 `simulator_refresh` 不编译新文件，`audio-dock` 报 `module not defined` + `Component is not found` 整块不渲染；**必须 close + open 项目窗口**（已写入 docs/13 §1.20）。②**P0 播放状态**——实测 `paused:false` 但 `playing:false`/「已暂停」：`waiting` 后基础库不补发 `play`；已改为 waiting 只进连接态、canplay/12s 守卫/4s 补播按真实 `paused` 自愈（dock + now-playing）。③**超期态**——删除与常驻卡片重复的 8s notice；标题改「这一觉还没结束」、副标一行；熄灯「结束入睡」<5 分钟二次确认。④**视觉**——日历空格「补记」→「+」；结果面 compact 副标补「已扣 N 分钟入睡」、已过行 opacity 0.88、返回按钮 152rpx。门禁 385/384/0 fail/1 skip、check 623.8 KB、console 0 error；截图 `docs/assets/l4-*.png` 9 张。**未真机**：弱网首播、悬浮 X 续播、收藏连播切歌、继续上次、熄灯短时长确认。

40. **批次 D（2026-10-26，增长/后台/工程）**：①**分享深链**——`onShareAppMessage` path 带 `mode/fall/wake|sleep`，`applyShareQuery` 只读预填并直接展示结果面（不写偏好、不弹权限）；②**share 事件**——客户端 track + 服务端白名单 + `analytics` 的 `today/week/trend.shares`（漏斗分母）；③**演示页回流**——`site-qr.js` + demo 尾部小程序码 CTA（无码回退微信搜索）；④**后台**——保存失败按钮滞留「保存失败 · 重试」、409 自动 `loadAll()`、清除二维码二次确认；⑤**统计页**——`loadConfig` 回调按 `version+features.sync` 签名决定是否重算（进页不再算两遍 420 格）；⑥**提醒模板快照**——`sleep_reminders` 加 `thing_key/time_key`（memory+PG+001_init 同步），发送优先任务快照；⑦**死码**——删 `regularity.js`+测试、`calendar-strip` 组件（含 stats.json 注册）、`fetchSummary`、`streak` 字段；主包 623.8→618.6 KB；⑧**国际站**——`legalStatus` 未发布时过滤法务死链，重建 11 页 + `verify:web` OK。门禁 386/385/0 fail/1 skip。**未做**：D1 真机、音源补齐（需素材）、后台 shares UI、国际站真实域名（需输入）。

41. **真机反馈：切歌播几秒变「已暂停」（2026-10-26）**：线上 8 条音源全部 `206/audio/mpeg`（1.5–11.5MB），排除坏源。两处代码成因已修：①`autoCacheDelay` 从 Wi-Fi 立即下载改为 8s（移动 20s），避免后台整首缓存与流式播放抢带宽；②`pause` 在 30s 缓冲窗口内且非用户暂停时保持连接态并 3s 重连（最多 2 次），不再直接显示「已暂停」；用户暂停/锁屏暂停不受影响。新增 **仅 develop** 的 `sleep:dev-api` 覆盖便于模拟器联调线上配置（release 不读）。后台看板加「今日分享/本周」卡。**未复现**：DevTools 走系统代理，`/api/config` 返回 status 0，真机带宽场景需真机复测；若仍复现看 `audio_error` 的 errCode（onError vs pause）。

42. **环境音运营可读化（2026-10-26）**：后台图标下拉改「🌧 雨声 / 🌊 海浪 / 🔥 炉火 / 🎚 白噪音 / 🌙 深夜」；分类加常用标签（自然之声/环境音/白噪音/轻音乐/助眠音乐/冥想）并合并 datalist；看板趋势加分享柱（金）；小程序已缓存曲目右侧加可点 ⤓（二次确认删单曲缓存），长按同口径；已有当前曲目时隐藏“继续上次”。**封面图不做**（内置图标 + 分类色已够，睡前低频浏览收益低于运营与加载成本；未来若做用 96px WebP ≤15KB，与 icon 二选一）。门禁 385/0 fail/1 skip，check 622.1 KB。**未机验**：后台浏览器点验、真机删缓存确认。

43. **睡眠口径分层（2026-10-27）**：`startAt` = 上床、`sleepAt` = 睡着（可选；`sessions[].sleepAt`，本地 `sessions.normalizeSession` 与服务端 `validate.normalizeSession` 白名单均已放行，越界只丢字段不丢段）。**主口径仍是在床**（`durationMin = endAt - startAt`）：完成态大数字标签「在床时长」、统计页指标「平均上床」、日期详情「首段 X 上床」；「入睡」只用于事件描述（空态「去入睡」、补记面板时间标签、进行中状态）与真实睡着时刻。睡眠效率 = 睡着 / 在床（仅主段、仅当有 `sleepAt`，完成态一行「入睡 23:00 · 睡着 7 小时 00 分 · 效率 97%」）。**决策：不切 TST 主口径**——`sleepAt` 默认 = 上床 + 档位，不改的用户会得到恒等于「在床 − 15 分钟」的假测量，且分不清「认可默认」与「没看」；待「改入睡时刻的用户占比」数据再议。入睡耗时档位走 `app.globalData.fallMinutes`（会话级、不落 prefs），打卡快照进 `pending.fallMinutes`，结束面板三格「上床/入睡/起床」。门禁 433/432/0 fail/1 skip、check 677.7 KB。

44. **用户反馈闭环（2026-10-27）**：`POST /api/feedback`（`{code,type,content,contact}`，类型白名单 `SUGGEST/MUSIC/ISSUE`、正文 ≤500、联系方式 ≤64、控制字符清洗保留换行）→ 新表 `user_feedback`（`001_init.sql` 与启动 DDL 双份，纯加法，无手工迁移）→ 后台「用户反馈」面板只读 + 标记已处理。限流 IP 5/分钟 + openid 5/小时；`features.feedback`（config-schema / app.config.json / fallback.js / admin.js / 文档 五处已同步）关掉后入口隐藏且接口 403。设计与边界：**不做回复、不做删除**（回复需客服体系；删除与用户「清除数据」形成两套语义），用户清除数据时 `eraseUserData`/`eraseCloudData` 会级联删反馈。口径与边界见 `DECISIONS.md` ADR-029（不占顶栏、不接微信原生反馈、不做回复与后台删除）。**模拟器 390×844 已实测**（入口/chips 选中态/字数/空白校验/真实 201 成功态/tabBar 复位，截图 `docs/assets/l4-feedback-*.png`），后台面板浏览器实测（Edge headless，列表/角标/类型标签/pre-wrap 换行/联系方式、标记后角标同步、只看未处理筛选、0 console error，截图 `docs/assets/l4-feedback-admin.png`）；**仍未验**：真机软键盘弹起与 iOS 中文输入，见 docs/13 §1.40。

## 8. 快速命令

```bash
npm run dev:geek          # 本地极客混跑：PG 在 Docker，API 在宿主机 3100
npm run pack:server       # 服务端专用迭代包（约 600KB，直解压覆盖，推荐）
npm run pack              # 全量归档打包（前后端全归档）
# 1Panel 迭代更新：上传 getsleep-server-*.zip → 1Panel 界面直接解压覆盖 → bash deploy/update.sh
npm test
npm run check
```

后台：`/admin`，密码来自 `.env` 的 `ADMIN_PASSWORD`；本地极客混跑默认 `getsleep-local-admin-2026`。
模拟器取证（`wechatide` CLI，skill 装在用户全局 `~/.gemini/config/skills/wechatide-skill`，仓库内 `.agents/` 已 gitignore）：

```bash
wechatide -c <Agent名> check_wechatide_status --skill-version <SKILL.md 的 version>
wechatide -c <Agent名> open_project_window   --project <仓库绝对路径>
wechatide -c <Agent名> simulator_screenshot  --project <仓库绝对路径> --path docs/assets/l4-<主题>.png
wechatide -c <Agent名> automation_evaluate   --project <仓库绝对路径> --fn-source "function(){...}"
wechatide -c <Agent名> get_simulator_console --project <仓库绝对路径> --command "grep -i error"
```

截图约定：要写进文档的证据图命名 `docs/assets/l4-*.png` 并入库；`review-*.png` / `test-*.png` 是临时探针图，已 gitignore，不能当文档证据。原生 `wx.showModal` 弹窗不响应坐标点击，验证其后逻辑时用 `automation_evaluate` 直接调页面方法并读 Storage。

小程序：微信开发者工具导入仓库根目录；开发版自动指向 `127.0.0.1:3100`，体验/正式版自动指向 `https://sleep.qfmaster.com`。
标准操作与 1Panel 上传/反代步骤见 [docs/10-operations.md](docs/10-operations.md)；本次关键更新见 [docs/11-changelog.md](docs/11-changelog.md)。
关键取舍见 [DECISIONS.md](DECISIONS.md)（29 条 ADR，截至 ADR-029：睡眠日边界、圆均值、LWW、模板总结、午休范围、同步容错、删除水位、1Panel 部署、不做付费内容、不做分享解锁、统计周期回退、反馈渠道边界等）。
