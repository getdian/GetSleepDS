# 睡点 · 当前上下文（context.md）

> 最后更新：2026-10-19 · 这份文件是“当前代码事实”的速查，不替代 PRD/架构文档；重大改动先改这里，再同步 docs。

## 1. 当前产品形态

- 微信小程序，三个 tab：**计算器 / 入睡 / 统计**。
- 计算器：**双向单卡 3D 计算器**（2026-10-20 重构）。默认「我想几点醒」，卡顶轻量切换为「我想几点睡」；正面 12h 时间轮 + 共享入睡耗时 + 主按钮，点击后仅计算卡 `rotateY(180deg)` 到结果面；结果面第一推荐突出、其余两行弱化，支持「重新选择」和「换成另一种算法」。算法仍复用 `utils/plan.js`，未改。
- 首页 Hero：支持后台配置的多张背景图，默认图免费并静默缓存；用户选择其他背景需看激励视频解锁，到期回退默认。标题区背景图从状态栏后开始，底部渐隐到现有夜色。
- 顶部：计算器页使用 `top-bar brand-only`，只显示「睡点」，右侧留给微信原生胶囊；`action-text` 位现放「换背景」（贴 `capsuleGap` 安全距离右对齐，`bind:action` 打开背景选择器），入睡/统计页不传该属性、不渲染。
- 计算器 Hero 文案随方向切换：「选择起床时间」=「今晚，几点睡？」，「选择入睡时间」=「想几点起？」——入睡模式刻意不写「明早」（白天小睡结果会落在当天，陈述必须始终成立）。
- 入睡：A 未记录 / B 睡梦中 / C 已完成；B 态可撤销，C 态展示入睡、起床、在床时长。
  - C 态大数字 = 当天总睡眠（含午休/间断）；下方时间线同口径 = 首段入睡 → 末段起床（单段时显示「入睡/起床」，多段时「当天首段入睡/当天末段起床」）。
  - 「本日睡眠段」每行右侧「修改 / 删除」两个文字按钮（加粗、异色、无边框）；删除有确认弹窗（唯一段时提示整天一起撤销），删空当天 = 撤销整天（写墓碑），剩余段重算主睡眠与总时长（`storage.removeSession`）。
  - C 态主操作两个小型按钮同一行：「继续入睡（开始计时）」主按钮 +「补记入睡」次按钮；下方「记录有误？撤销当天记录」不变；A 态补记入口文案同为「补记入睡」。
  - 原「最近 7 天」柱状区与试做的「睡眠轨迹圆盘」（canvas 24h 环）均已移除：圆盘与入睡圆环在 sleeping/idle 态信息重复（入睡时刻/已睡时长是 orb 的第三个副本）、占空间，且“声音/计算器摘要/睡眠知识”等替代内容均与既有入口重复。现该位置只保留一行轻量统计「本周 X 天 · 连续 Y 天 · 查看统计 ›」（0 数据时不渲染，点击进统计），7 天柱状、`buildWeekDays`、`components/sleep-disc`、`utils/disc-geometry.js` 全部删除（本周/连续计数保留）。
  - **熄灯（睡前模式，仅 sleeping 态）**：打卡后立即进入持久熄灯——全屏毛玻璃（`rgba(4,7,15,0.84)` + `backdrop-filter: blur(20rpx)`，不支持 blur 时深底自动退回接近关灯）压暗整页，只留熄灭态入睡时间（orbTime/orbMeta，`filter:brightness(0.84)`）+ 顶部「晚安」+ 底部「轻触任意处唤醒」；**tabBar 同步 `tabbar.hide()`**（独立 root 压不住）。熄灯态 orb 不可点：任意点触 = 唤醒（`wakeUp` → tabbar.show），唤醒后再点 orb 才进结束面板；唤醒后 30s（`LIGHTS_OUT_DELAY`）无操作自动回熄灯，任何页面触摸（根 view `bindtouchstart`）重置计时。结束面板/声音抽屉打开时、done/idle 态、页面 onHide 均不熄灯；保存/取消面板后恢复倒计时。
- 统计：首屏 3 列核心指标（平均睡眠 `3h39` / 平均入睡 / 平均起床，对比副标带主语「比上周多 1h20m」，点击展开 3 行说明；平均睡眠下方按常见 7.5–8 小时给事实陈述，不足 3 天提示补记）、打卡日历（当月 92×76rpx 扁格可切月，列间距 4rpx / 行间距 16rpx；3/6/12 个月横向滑动 48rpx 格；4 档色阶、选中态 + 详情卡）、近 30 天海报、云同步/清除数据（折叠）。近 14 天趋势已删除。**空格补记（2026-10-22 三轮）**：格内写「补记」，点击直接在统计页弹补记面板（醒来日 + 入睡/起床时间，复用 `sessions.rangeForDay`/`findOverlap` 校验，保存落 v2 session 并同步），不再跳入睡页；有记录/进行中/未来日仍走详情卡。视觉：指标区无底无框、居中弱色「点上方↑数字看说明」、图例仅 4 档弱化、底注「本月已记录 N 天」、海报按钮「生成 30 天海报」。
- 声音：`audio-dock` 悬浮钮 + 迷你播放器 + 底部抽屉；搜索、分类、收藏、缓存、广告解锁、定时关闭（**默认关**：打开抽屉胶囊默认选中「关」，不跨会话回忆档位，明确选 30/60/90 才起表；到点/停止/失败即复位「关」）。入口仍在入睡页；播放后首页/统计页显示 `now-playing` 迷你条，可跨页暂停/继续/停止。音符与播放条三页统一底部安全位 `176rpx + safe-area`（2026-10-22 由 132rpx 上移，与悬浮 tabBar 顶边 128rpx 拉开 48rpx）；音符圆底为轻玻璃 `rgba(8,11,20,.30)` + `blur(18rpx)`，108rpx、右缘 26rpx。这条右下带（约 292rpx 顶点）由页面让出：统计页 `.safe-bottom` = `180rpx + safe-area`（运营定档——配合页脚广告位约 140rpx 把「数据与备份/展开」行抬出音符带；广告位关闭/失败时行会落回带内，广告实载时其下部被音符遮，要两者都避免需 ≥300rpx），入睡页天然安全未改。
- 分享：计算器结果背面、入睡页、统计页海报区均有 `share-btn`（button open-type=share），`onShareAppMessage` 按场景动态生成标题。
- 广告观测：`ad-slot` 加载成功/失败上报 `ad_show` / `ad_error`，后台概览显示今日/本周与分槽填充率。
- 顶部：自定义 `navigationStyle: custom`，通栏透明 + 延伸到胶囊前的全宽玻璃“灵动岛”，不再有固定原生导航背景。
- 后台：`/admin` 左侧主菜单 + 右侧单面板，9 个分类（含“用户数据”按 openid 查/删），sticky 保存条。
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
  heatmap/      旧 7 行横向热力图（统计页已改月历，保留未引用）
  sleep-trend/  近 14 天柱状趋势（柱高=总睡眠、柱色=入睡时段）
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
| 后台登录密码 | `.env` 的 `ADMIN_PASSWORD` | 当前否，改后需重启 |
| LLM | 未接入 | — |

- **“配置 JSON”只是只读检查**，不是要求手改；运营字段全部有表单。
- 分类不是独立表：每条音频一个 `category` 字符串，客户端去重生成筛选；后台输入框带已有分类 datalist。
- 收藏是本地 `meta.favoriteAudioIds`，不参与云同步；换机不迁移。

## 4. 数据与同步

- 本地记录存 `sleep:records:v1`，按**醒来日**归档（v2：`records[day].sessions[]`，一天可多段）；`pending` 是进行中会话。
- **统计口径**：统计页 Hero / 趋势 / 日历 / 海报统一用**当天总睡眠**（主睡眠 + 午休/间断段，`totalDurationMin`）；详情里拆分夜间与午休。`durationMin`（主睡眠）仍用于连续天数与服务端模板，两套字段并存但页面不再混用。
- **云备份默认关闭**（`meta.syncEnabled !== true` 时 `syncNow` 直接跳过，不发任何请求）；用户在统计页显式开启后，才用静默 `wx.login → openid` 归属上传，不获取头像/昵称/手机号。
- 服务端 `sleep_records` 主键 `(openid, day)`；`/api/records/sync` 幂等 upsert：v2 记录 `day` 由主睡眠 `wakeAt` 重算、v1 记录仍按 `sleepDayOf(bedAt)`，单条脏记录丢弃并返回 `dropped`，不再整批 400；`includeAll` 类型校验在写库前完成。
- 云备份客户端按每片 60 条分片、覆盖最近 400 天；服务端单次上限 62 条。
- 删除：`sleep_record_deletions` 存单日墓碑，`user_erasures` 存全量清除水位；客户端上传 `deletedDays`，并接收服务端墓碑/水位清理本机旧记录。
- `POST /api/records/erase` 删除该 openid 的睡眠记录、解锁与事件并写 erasure 水位，客户端成功后才清本地；清除前发出的在途 sync 由 `syncEpoch` 丢弃。
- 客服/合规：`GET /api/admin/users/:openid` 查询、`DELETE /api/admin/users/:openid/records` 删除；后台“用户数据”面板，删除记审计日志（openid 哈希前缀，不落明文）。
- 取消/撤销：B 态撤销只清 pending；C 态撤销写本地墓碑并在下次 sync 上传 `deletedDays`，云端按日删除。
- 一天多次睡眠：完成态可「继续入睡（开始计时）」或「补记入睡」，新段追加不覆盖；每段可单独改时间（修改）/删除（`storage.removeSession`，删空当天走墓碑），保存前按时间区间（跨全表）挡重叠。尚未引入独立的 `nap` 类型字段。

## 5. 当前验证基线

- `npm test`：**224 项 / 223 通过 / 0 失败 / 1 skip**（客户端 146 + 服务端 78；PG 集成用例在未设置 `PG_TEST_URL` 时跳过；本轮新增 storage `removeSession` 4 条、sleep 页面级 11 条含熄灯 7 条）。
- `npm run check`：3 页面 / 23 JSON / 18 WXML / 20 WXSS，主包约 478.4 KB（以最新输出为准）。
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
3. **后台改密码未实现**：当前改 `.env` 的 `ADMIN_PASSWORD` 并重启；不建议开放明文改文件。要做需“DB 存 scrypt 哈希 + 当前密码校验 + 会话失效/审计”，属于安全改造，不能半套（ADR-013）。
4. **大模型未接入**：当前 `/api/summary` 是模板，稳定、零调用成本、合规；LLM 仅适合可选润色，默认关闭，需超时/禁词/降级。
5. **午休/多次睡眠**：已支持一天多段（v2 `records[day].sessions[]`，主睡眠取最长一段用于连续天数与详情拆分，统计页 Hero/趋势/日历统一展示 `totalDurationMin` 总睡眠）；未做独立的 `nap` 类型字段，跨天段由客户端按“醒来日”拆到各自记录（一段只归一个醒来日）。
6. **H5 仍是旧结构**：`/demo/` 已修空播放条、全过期展示和解锁 TTL 读取，但仍是旧三屏结构；三 tab + audio-dock 待重做。
7. **单实例**：限流、配置缓存、事件都在进程内；扩容前换共享存储。
8. **音频后台边界**：定时器已持久化并在 onShow/onEnded 重新校时，但 iOS 完全冻结 JS 时无法保证毫秒级准点；3 分钟音频的锁屏循环仍需真机验证，不能仅凭开发者工具下结论。
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
21. **统计页改版待验收（2026-10-21，机验已完成 2026-10-22）**：结论卡（平均睡眠 + 上周对比 + 7–9h 参照）、近 14 天趋势、结构化事实、当月打卡日历已完成；改版后自审修复了刷新签名漏 `todayKey/partialDay/同步状态`、本周 0 条文案误报、进行中第二段不可见、清除数据不重置月份、选中态与详情不同源、`bedSpreadMin` 为 null 拼接等问题。`npm test` 191 项绿、`npm run check` 绿；**CLI 模拟器已实测**（空态、3 列指标、指标展开说明卡含常见 7.5–8 小时陈述、打卡日历数据格/空白天补记入口、周期切换、折叠备份区），此前 MCP 代理失败是工具链问题、CLI 通道不受影响。剩余仅真机点击项（20 次连续点格），见 docs/13 第 2 区。旧 `components/heatmap` 保留但统计页不再引用；服务端 `/api/summary` 保留但统计页不再请求。
22. **补记编排单源（2026-10-22 评审整改）**：统计页补记与入睡页「补记一段睡眠」此前是两套复制实现；已抽 `utils/manual-sleep.js`（默认时间/错误文案/区间校验/保存入参/回溯范围）与 `styles/sheet.wxss`（弹层样式），两页只保留 UI 与页面编排。同时修复 `manual_sleep` 不在服务端事件白名单导致整批事件被丢弃的既有缺陷。口径：统计页允许「正在入睡中」补记历史日（多段模型合法），入睡页仍只在 idle/done 提供入口；补记日期下限与日历翻页共用 24 个月。详见 changelog 2026-10-22「L4 评审整改」。

## 8. 快速命令

```bash
npm run dev:geek          # 本地极客混跑：PG 在 Docker，API 在宿主机 3100
npm run pack              # 打包（默认先跑测试 + 静态检查）
npm test
npm run check
```

后台：`/admin`，密码来自 `.env` 的 `ADMIN_PASSWORD`；本地极客混跑默认 `getsleep-local-admin-2026`。
小程序：微信开发者工具导入仓库根目录；开发版自动指向 `127.0.0.1:3100`，体验/正式版自动指向 `https://sleep.qfmaster.com`。
标准操作与 1Panel 上传/反代步骤见 [docs/10-operations.md](docs/10-operations.md)；本次关键更新见 [docs/11-changelog.md](docs/11-changelog.md)。
关键取舍见 [DECISIONS.md](DECISIONS.md)（18 条 ADR：睡眠日边界、圆均值、LWW、模板总结、午休范围、同步容错、删除水位、1Panel 部署、不做付费内容、不做分享解锁等）。




