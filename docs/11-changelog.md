# 睡点 · 关键更新记录

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
