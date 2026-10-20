# 睡点 · 当前上下文（context.md）

> 最后更新：2026-10-19 · 这份文件是“当前代码事实”的速查，不替代 PRD/架构文档；重大改动先改这里，再同步 docs。

## 1. 当前产品形态

- 微信小程序，三个 tab：**计算器 / 入睡 / 统计**。
- 计算器：**双向单卡 3D 计算器**（2026-10-20 重构）。默认「我想几点醒」，卡顶轻量切换为「我想几点睡」；正面 12h 时间轮 + 共享入睡耗时 + 主按钮，点击后仅计算卡 `rotateY(180deg)` 到结果面；结果面第一推荐突出、其余两行弱化，支持「重新选择」和「换成另一种算法」。算法仍复用 `utils/plan.js`，未改。
- 首页 Hero：支持后台配置的多张背景图，默认图免费并静默缓存；用户选择其他背景需看激励视频解锁，到期回退默认。标题区背景图从状态栏后开始，底部渐隐到现有夜色。
- 顶部：计算器页使用 `top-bar brand-only`，只显示「睡点」，右侧留给微信原生胶囊。
- 入睡：A 未记录 / B 睡梦中 / C 已完成；B 态可撤销，C 态展示入睡、起床、在床时长。
- 统计：固定 140 天（20 整周）热力图、周均值、事实回顾、近 30 天海报、云同步/清除数据。
- 声音：`audio-dock` 悬浮钮 + 迷你播放器 + 底部抽屉；搜索、分类、收藏、缓存、广告解锁、定时关闭。入口仍在入睡页；播放后首页/统计页显示 `now-playing` 迷你条，可跨页暂停/继续/停止。
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
    heatmap/      7 行横向滚动热力图
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
    stats.js      周统计/热力图/汇总 payload
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
server/
  src/app.js      路由、CSP、/api/ready、请求日志
  src/routes/     config/audio/summary/records/events/admin
  src/services/   config-store/admin-auth/storage-settings/cos/analytics/summary
  src/db/         memory/postgres 双实现
  public/admin/   后台 SPA
  public/site/    落地页 + H5 演示
  sql/001_init.sql
docs/             00–11 文档（含常用操作与关键更新）
tests/            Node 纯逻辑测试
```

## 3. 配置边界（重要）

| 配置 | 位置 | 是否可视化 |
|---|---|---|
| 音频清单/名称/分类/URL/排序/图标 | `/admin` 环境音 | 是 |
| 解锁广告位、解锁方式、有效期、失败策略 | `/admin` 广告与解锁 | 是 |
| 页面展示位（首页 / 入睡 / 统计 ×2）开关、广告位 ID、类型 | `/admin` 广告与解锁 → 页面展示位 | 是 |
| 首页背景图（标题/分类/URL/启用/排序）、默认图、解锁时长、图片上传 | `/admin` → 背景图（上传走 COS；默认压缩 webp，可勾选「保留原图」） | 是 |
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

- 本地记录按睡眠日存 `sleep:records:v1`，一条夜间睡眠一条记录；`pending` 是进行中会话。
- **云备份默认关闭**（`meta.syncEnabled !== true` 时 `syncNow` 直接跳过，不发任何请求）；用户在统计页显式开启后，才用静默 `wx.login → openid` 归属上传，不获取头像/昵称/手机号。
- 服务端 `sleep_records` 主键 `(openid, day)`；`/api/records/sync` 幂等 upsert，`day` 由 `bedAt` 重算，单条脏记录丢弃并返回 `dropped`，不再整批 400。
- 云备份客户端按每片 60 条分片、覆盖最近 400 天；服务端单次上限 62 条。
- 删除：`sleep_record_deletions` 存单日墓碑，`user_erasures` 存全量清除水位；客户端上传 `deletedDays`，并接收服务端墓碑/水位清理本机旧记录。
- `POST /api/records/erase` 删除该 openid 的睡眠记录、解锁与事件并写 erasure 水位，客户端成功后才清本地；清除前发出的在途 sync 由 `syncEpoch` 丢弃。
- 客服/合规：`GET /api/admin/users/:openid` 查询、`DELETE /api/admin/users/:openid/records` 删除；后台“用户数据”面板，删除记审计日志（openid 哈希前缀，不落明文）。
- 取消/撤销：B 态撤销只清 pending；C 态撤销写本地墓碑并在下次 sync 上传 `deletedDays`，云端按日删除。
- 当前**不支持**一天多次睡眠（午休）作为独立记录；C 态在 18:00 后提供“再记今晚（覆盖旧记录）”入口，先行解锁主流程；独立 `nap` 实体仍是下一迭代。

## 5. 当前验证基线

- `npm test`：**119 passed / 0 failed + 1 个 PG 集成用例**（未设置 `PG_TEST_URL` 时跳过）。
- `npm run check`：3 页面 / 19 JSON / 14 WXML / 15 WXSS，主包约 285.6 KB（以最新输出为准）。
- 分享归因冒烟（2026-10-19，内存模式）：`app_open` 带 `1007|pages/index/index|share` 上报 → `/api/admin/analytics` 的 `topSources` 聚合出现；`/api/share/qrcode` 无 code 返 400、密钥不可用返 503，均为优雅报错。
- 微信开发者工具（AppID `wx378b0a7437d60998`）：三页真实编译；热力图滚到最新周；C 态“覆盖今晚”渲染；控制台无 error；实际触发 `/api/records/sync` 返回 20 条并带 `deletedDays/erasedAt`。
- 本地 PostgreSQL + API（3100）：`/api/ready` 200；PG `syncRecords` 的 day 归一化/墓碑/erasure 事务、`saveUnlock` 单行覆盖均实测通过。
- 后台浏览器实测：左菜单切换、音频标题保存、配置接口写库、窄屏横向 tabs、无 console error。
- 未验证：真机锁屏续播、激励视频、真实 COS 上传、海报导出、H5 新结构。

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
5. **午休/多次睡眠未支持**：当前只提供 C 态“覆盖今晚”解锁主流程；独立 `nap` 记录（start/end/kind）不混入夜间均值/连续天数，仍是下一迭代。
6. **H5 仍是旧结构**：`/demo/` 已修空播放条、全过期展示和解锁 TTL 读取，但仍是旧三屏结构；三 tab + audio-dock 待重做。
7. **单实例**：限流、配置缓存、事件都在进程内；扩容前换共享存储。
8. **音频后台边界**：定时器已持久化并在 onShow/onEnded 重新校时，但 iOS 完全冻结 JS 时无法保证毫秒级准点；3 分钟音频的锁屏循环仍需真机验证，不能仅凭开发者工具下结论。
9. **部署端口**：compose 已把 API 绑到 `127.0.0.1:3000`；1Panel 反向代理必须保留 `TRUST_PROXY=1`，且不要额外放行 3000 到公网。
10. **展示位与流量主**：4 个页面展示位默认关闭；广告位需先在公众平台创建并审核通过，后台填 ID + 勾选启用后才渲染。未开通时 `<ad>` 报错会被组件静默吞掉。
11. **云备份与“零登录”口径**：同步依赖静默 `wx.login → openid`，不弹授权、不取资料；对外文案只说“零登录、零授权、数据默认本地”，不承诺“无广告/不弹窗”。
12. **首页背景图**：默认图免费、静默缓存；用户主动更换需看激励视频，使用时长 1–168 小时（后台统一设置），到期回退默认。图片存 COS（`backgrounds/` 前缀），后台需先在“存储与上传”配置 COS；图片域名需在 `downloadFile` 白名单（当前复用 `img.qfmaster.com`）。缓存最多 6 张，淘汰/清除会删除本地文件；选择器缩略图走 COS `imageMogr2`，失败回退原图。真机需验证 3D 翻转、时间轮滚动与背景图切换。
13. **分享归因与海报码**（2026-10-19 新增）：来源分布从新版小程序发布后才开始积累；海报小程序码依赖 `.env` 的 AppSecret 且小程序已发布，两者未就绪时海报自动回退"微信搜索「睡点」"落款，真机扫码链路待发布后验收。
14. **2026-10-20 L4 深审收口**：P1 与高优先级 P2 已落地，详见 [docs/11-changelog.md](docs/11-changelog.md)。改后模拟器已复验背景图显示与时间轮拖动；上午/下午的合成点击在桌面注入下未能稳定复现，已移除正面 3D 命中偏移风险，仍需在真机/手动模拟器点按确认。其余外部/非阻断门禁：落地页 ICP 备案号仍是占位；后台配置历史/回滚、内存模式标识、PG 看板事件上限等运维增强未做。真机、真实广告、真实 COS 防盗链仍需发布前验收。

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




