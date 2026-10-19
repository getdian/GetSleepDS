# 睡点 · 关键更新记录

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
