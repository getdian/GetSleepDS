# 睡点 · 架构与接口说明

- 版本：1.0 / 2026-10-18
- 配套：`docs/00-prd-revised.md`

---

## 1. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 小程序 | 原生 WXML/WXSS/JS，无第三方 UI 库 | 包体积最小、审核风险最低、深色视觉完全可控 |
| 后端 | Node.js 20 + Express 4 | 轻量、单文件路由即可，2核4G 足够 |
| 数据库 | PostgreSQL 16 + `pg` 连接池（max 5） | 只有两张表，PG 足够且后续可加统计 |
| 配置 | 服务端 JSON 下发 + 客户端本地兜底 | 换音频、换广告位、关同步都不用发版 |
| 部署 | Docker Compose（api + db） | 单机单实例，一条命令起服务 |
| 音频 | 腾讯云 COS（HTTPS + 白名单域名） | 3M 带宽只跑 JSON，音频走对象存储 |

**不引入**：TypeScript、ORM、Redis、消息队列、微服务、Vant/WeUI、ECharts、Canvas 热力图。

---

## 2. 目录结构

```
GetSleepDS/
├── docs/                          # 本文档
├── miniprogram/                   # 小程序根目录
│   ├── app.js / app.json / app.wxss
│   ├── sitemap.json
│   ├── config/
│   │   ├── env.js                 # API 域名（唯一需要改的地方）
│   │   └── fallback.js            # 服务端不可达时的兜底配置
│   ├── utils/
│   │   ├── time.js                # 睡眠日、圆均值、时间格式化基础
│   │   ├── plan.js                # 起床/入睡双向倒推，纯函数
│   │   ├── stats.js               # 周统计、热力图、连续天数
│   │   ├── format.js              # 时间/时长/问候语格式化
│   │   ├── storage.js             # 本地存储封装
│   │   ├── request.js             # wx.request Promise 封装
│   │   ├── api.js                 # 业务接口
│   │   ├── login.js               # wx.login 静默取 code
│   │   ├── config.js              # 远程配置拉取/缓存/兜底
│   │   ├── sync.js                # 静默云同步
│   │   ├── audio-cache.js         # 音频落盘、预加载、容量清理
│   │   ├── audio-timer.js         # 跨页面的定时关闭单例
│   │   ├── events.js              # 轻量事件队列与上报
│   │   └── ad.js                  # 激励视频生命周期
│   ├── components/
│   │   ├── ambient/               # 星轨/呼吸光晕固定背景
│   │   ├── top-bar/               # 通栏透明顶栏 + 悬浮灵动岛
│   │   ├── time-wheel/            # 自绘 12h 循环时间轮（上午/下午）
│   │   ├── audio-dock/            # 悬浮声音钮 + 迷你播放器 + 底部抽屉
│   │   ├── heatmap/               # 7 行横向滚动热力图
│   │   ├── unlock-sheet/          # 底部解锁面板
│   │   └── empty-state/           # 空状态
│   ├── pages/
│   │   ├── index/                 # 计算器（双模式手风琴 + 3D 翻转结果）
│   │   ├── sleep/                 # 入睡打卡 + 近 7 天 + 声音入口
│   │   └── stats/                 # 统计 + 热力图 + 海报 + 同步/清除
│   └── assets/                    # tabBar 与音频图标（PNG）
├── server/
│   ├── src/
│   │   ├── index.js               # 启动、优雅退出、过期清理
│   │   ├── app.js                 # createApp，可注入 db / config
│   │   ├── config/index.js        # 读 JSON + 环境变量覆盖
│   │   ├── db/index.js            # memory / postgres 双实现
│   │   ├── routes/                # config / audio / summary / records / events / admin
│   │   ├── services/wx.js         # code2session
│   │   ├── services/summary.js    # 模板引擎 + 禁词校验
│   │   ├── services/config-store.js   # 数据库优先的配置读取
│   │   ├── services/admin-auth.js     # 后台密码 / 签名 Cookie
│   │   ├── services/storage-settings.js # COS 配置（SecretKey 加密）
│   │   ├── services/cos.js        # 上传 / 连接测试
│   │   ├── services/analytics.js  # 看板聚合
│   │   └── lib/                   # 校验、限流、错误、加密
│   ├── config/app.config.json     # 首次部署种子 / 数据库故障兜底
│   ├── public/admin/              # 后台页面（HTML/CSS/JS，无构建、随 API 部署）
│   ├── public/site/               # 落地页 + H5 交互演示
│   ├── sql/001_init.sql
│   ├── test/
│   ├── Dockerfile
│   └── package.json
├── tests/                          # 小程序纯逻辑单测（Node 直接跑）
├── tools/                          # 资源生成与静态检查
├── docker-compose.yml
└── .env.example
```

---

## 3. 前端分层

- **pages**：只做布局、状态机、事件绑定。
- **utils**：纯函数优先，`time.js` / `plan.js` / `stats.js` / `format.js` 不依赖 `wx`，可直接在 Node 里跑单测。
- **components**：只接收 `properties`、只发 `events`，不直接读全局状态。
- **config**：`env.js` 是唯一域名来源；`fallback.js` 与服务端 `app.config.json` 同构。
- **design tokens**：全部在 `app.wxss` 的 `page` 上，页面/组件只引用 `var(--...)`；详见 `docs/09-redesign.md`。

### 3.1 关键实现约定

- 不使用 `?.`、`??`，避免低版本基础库编译差异。
- 所有 `setData` 前判断页面是否存活（`this._alive`）。
- 时间一律用毫秒时间戳 + 本地时区函数，不存 `"23:40"` 字符串。
- 计算器结果由 `utils/plan.js` 生成，页面只做展示。
- 音频定时器是模块单例，离开声音抽屉/切 tab 后仍生效；组件 `detached` 只解绑监听，不停止播放。
- `backdrop-filter` / `repeating-conic-gradient` / flex gap 在低端机可能降级；卡片始终有实底。

---

## 4. 数据模型

### 4.1 本地

见 `00-prd-revised.md` 6.5。记录以睡眠日为键，天然去重。

### 4.2 PostgreSQL

```sql
CREATE TABLE IF NOT EXISTS audio_unlocks (
    id           SERIAL PRIMARY KEY,
    openid       VARCHAR(64) NOT NULL,
    unlock_time  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expire_time  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audio_unlocks_openid_expire
    ON audio_unlocks (openid, expire_time DESC);

CREATE TABLE IF NOT EXISTS sleep_records (
    openid       VARCHAR(64) NOT NULL,
    day          DATE NOT NULL,
    bed_at       BIGINT NOT NULL,
    wake_at      BIGINT NOT NULL,
    duration_min INTEGER NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (openid, day)
);

CREATE TABLE IF NOT EXISTS app_config (
    key          TEXT PRIMARY KEY,
    value        JSONB NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id          BIGSERIAL PRIMARY KEY,
    openid      VARCHAR(64) NOT NULL,
    type        VARCHAR(24) NOT NULL,
    target      VARCHAR(64) NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);
```

- `app_config` 是后台配置的持久化位置：`key='app'` 为下发配置，`key='cos'` 为加密后的存储凭证。
- `events` 只存 openid、类型、目标、时间；保留 180 天。
- 清理：每 6 小时删除过期解锁记录，并清理 180 天前的事件。
- 服务端启动时执行上述 DDL（幂等）。PostgreSQL 容器首次初始化会起临时实例再重启，连接失败会重试 5 次（每次间隔 2s）后退出。

---

## 5. API 契约

统一前缀 `/api`，请求/响应均为 JSON，响应错误格式：

```json
{ "error": { "code": "INVALID_CODE", "message": "登录凭证无效" } }
```

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 无 | 存活 + 数据库状态（始终 200） |
| GET | `/api/ready` | 无 | 就绪探针（DB 不可用返回 503） |
| GET | `/api/config` | 无 | 下发音频列表、广告位、开关、文案 |
| POST | `/api/audio/unlock` | code | 校验 code → openid，写入 24h 解锁 |
| POST | `/api/summary` | 无 | 由记录生成本周事实描述 |
| POST | `/api/records/sync` | code | 上传近 60 天记录（幂等 upsert，返回云端记录用于回填） |
| POST | `/api/records/erase` | code | 合规删除：物理删除该 openid 全部云端记录（3 次/分钟/IP） |
| POST | `/api/events` | code | 上报轻量事件（app_open / checkin / audio_play / audio_unlock） |
| POST | `/api/admin/login` | 密码 | 后台登录，写 HttpOnly + SameSite=Strict Cookie |
| POST | `/api/admin/logout` | Cookie | 清除后台会话 |
| GET | `/api/admin/session` | 无 | 当前是否已登录 |
| GET | `/api/admin/config` | Cookie | 读取后台配置、来源、更新时间 |
| PUT | `/api/admin/config` | Cookie | 严格校验后保存，版本号自增 |
| GET | `/api/admin/stats` | Cookie | 基础计数 |
| GET | `/api/admin/analytics` | Cookie | 看板聚合（今日/本周/14 天/ Top 5） |
| GET/PUT | `/api/admin/storage` | Cookie | 读取 / 保存 COS 配置（SecretKey 加密） |
| POST | `/api/admin/storage/test` | Cookie | 测试 COS 连接 |
| POST | `/api/admin/audio/upload` | Cookie | 上传音频到 COS（multipart，≤25MB） |

### 5.1 GET /api/config

```json
{
  "version": 3,
  "audio": [
    {
      "id": "sleep-10001",
      "title": "环境音 01",
      "subtitle": "循环播放 · 支持锁屏",
      "category": "环境音",
      "url": "https://qfmaster-1322402212.cos.ap-shanghai.myqcloud.com/sleep/sleep-10001.mp3",
      "icon": "noise"
    }
  ],
  "unlock": { "mode": "rewarded", "adUnitId": "", "ttlHours": 24, "onAdError": "grant" },
  "features": { "summary": true, "sync": true, "timer": true, "preload": true },
  "cache": { "maxMB": 80, "ttlDays": 7 },
  "copy": {
    "unlockTitle": "解锁环境音",
    "unlockDesc": "观看视频，解锁今晚的环境声音（24小时内有效）",
    "unlockConfirm": "观看视频",
    "unlockCancel": "先不用"
  },
  "serverTime": 1760000000000
}
```

`adUnitId` 为空 → 客户端按"直接解锁"处理。这是开发期与未开通流量主时的正式降级路径。

### 5.2 POST /api/audio/unlock

请求：`{ "code": "wx.login 返回的 code" }`

成功 200：`{ "expireAt": 1760086400000, "ttlHours": 24 }`

- 服务端用 `code2session` 换 openid，前端不接触 openid。
- 限流：同 IP 60 秒 60 次，同 openid 60 秒 5 次（可用环境变量调整）。
- `ALLOW_DEV_LOGIN=1` 且未配置 AppSecret 时，接受任意 code 并生成 `dev_<hash>`（仅开发环境，生产启动直接报错）。

### 5.3 POST /api/summary

请求：

```json
{ "records": [ { "day": "2026-10-17", "bedAt": 1760715600000, "wakeAt": 1760740860000 } ] }
```

约束：最多 62 条；`wakeAt > bedAt`；时长 ≤ 20 小时；`day` 必须等于 `bedAt` 的睡眠日（东八区）。

成功 200：

```json
{
  "available": true,
  "text": "本周你记录了 4 次睡眠。平均 23:52 入睡，07:41 起床，平均 7 小时 12 分。有 3 天在 0 点后入睡。",
  "stats": { "count": 4, "avgBed": "23:52", "avgWake": "07:41", "avgDurationMin": 432, "bedDeltaMin": 14, "afterMidnightDays": 3 },
  "generatedAt": 1760000000000
}
```

不足 3 条时 `available: false`，`text` 为 `null`。

### 5.4 POST /api/records/sync

请求：`{ "code": "...", "records": [ ... ] }`

成功 200：`{ "synced": 40, "records": [ { "day": "2026-10-12", "bedAt": 1760277600000, "wakeAt": 1760305800000, "durationMin": 470, "updatedAt": 1760305800000 } ], "serverTime": 1760000000000 }`

- `records` 是云端当前的全部记录，客户端据此回填（换机 / 清缓存恢复）。
- 冲突策略：`updated_at` 新者胜（客户端上传 `updatedAt`，服务端取 `GREATEST`）。
- 已撤销的日期在本地写墓碑，墓碑时间不早于云端更新时间时跳过回填。

### 5.5 POST /api/records/erase

请求：`{ "code": "..." }`

成功 200：`{ "deleted": 40, "serverTime": 1760000000000 }`

- 合规删除通道：按 `code → openid` 物理删除 `sleep_records` 全部行。
- 限制 3 次/分钟/IP；客户端收到成功后才清本地，失败时不清，避免下次同步把记录拉回。

### 5.6 统一错误码

| code | HTTP | 场景 |
|---|---|---|
| `INVALID_CODE` | 401 | code 无效/过期 |
| `INVALID_BODY` | 400 | 字段缺失或格式错误 |
| `PAYLOAD_TOO_LARGE` | 413 | 记录过多 |
| `RATE_LIMITED` | 429 | 触发限流 |
| `WX_UNAVAILABLE` | 503 | 微信接口不可用（仅服务端配置了 AppSecret 时可能出现） |
| `DB_UNAVAILABLE` | 503 | 数据库不可用 |
| `INTERNAL` | 500 | 未捕获异常 |

---

## 6. 配置与降级

| 场景 | 行为 |
|---|---|
| 配置来源 | 数据库 `app_config` > `server/config/app.config.json` > 小程序 `fallback.js` |
| 配置接口超时/失败 | 用本地缓存（10 分钟），无缓存用 `config/fallback.js` |
| 后台保存配置 | 写 `app_config`，版本自增，服务端 30 秒缓存立即失效 |
| 数据库读配置失败 | 回退到 `server/config/app.config.json`，页面来源显示“配置文件” |
| `adUnitId` 为空 | 直接解锁 |
| 激励视频加载失败 | 按 `unlock.onAdError`，默认解锁并记录日志 |
| 解锁接口失败 | 本地按 ttl 解锁，标记未同步 |
| 同步接口失败 | 静默丢弃，下次补 |
| 事件上报失败 | 留在本地队列（最多 80 条），下次启动再试 |
| COS 配置未填 / 密钥无法解密 | 后台上传返回 400，不影响已有音频播放 |
| COS 上传失败 | 返回 502，后台保留表单，可重试 |
| 数据库不可用 | `/api/health` 返回 `db: "down"`；解锁/同步/看板 503；`/api/config`、`/api/summary` 不受影响 |

---

## 7. 安全

- AppSecret 只存在于服务端环境变量，永不进入小程序包、日志、响应。
- 后台密码来自 `ADMIN_PASSWORD`；未设置时启动期生成临时密码并打印日志，不落库。
- 后台会话是 HMAC 签名 Cookie（HttpOnly、SameSite=Strict、生产加 Secure），有效期 7 天；登录 5 次/分钟/IP，管理接口 401 保护。
- 后台页面走 CSP `default-src 'self'`，禁止 inline 脚本与 iframe 嵌入。
- COS SecretKey 用 AES-256-GCM 加密后存 `app_config`，密钥来自 `CONFIG_SECRET`（缺省回退 `ADMIN_SECRET`/`ADMIN_PASSWORD`）；接口只返回 `hasSecret`，日志不回显。
- 事件只保存 openid、类型、音频 id、时间，不包含睡眠记录内容、设备信息、位置。
- 日志不打印 `code`、`openid` 明文、请求体，也不打印后台密码（仅未配置时在启动日志提示一次）。
- 请求体限制 64KB；CORS 不开放（小程序不需要）。
- 限流中间件为进程内存实现，单实例足够；多实例需换 Redis，本期不做。
- 小程序端不调用 `wx.getUserProfile`、`getPhoneNumber`、`getLocation` 等任何授权类接口。

---

## 8. 性能与体积

- 小程序主包目标 < 500KB（图标 PNG 共 < 60KB，无第三方库）。
- 首屏无网络依赖：先渲染本地数据，配置请求异步补齐。
- 热力图最多 120 个 `view`，无 Canvas，无长列表。
- 已解锁且 Wi-Fi 时最多预加载 2 条音频；本地缓存默认上限 80MB，每天最多清理一次。
- 后端单请求 P99 目标 < 100ms（不含公网）；连接池 5 个连接。
- H5/落地页是纯静态文件，无构建、无第三方字体或图表库。

---

## 10. 站点与 H5

同一个 Express 进程同时提供：

| 路径 | 内容 | 鉴权 |
|---|---|---|
| `/` | 落地页 | 无 |
| `/demo/` | H5 交互演示 | 无 |
| `/admin/` | 后台管理 | 密码 + Cookie |
| `/api/*` | 小程序与后台接口 | 按接口 |

- `server/public/site/` 与 `server/public/admin/` 都是静态文件，进 Docker 镜像即生效。
- H5 读取同一个 `/api/config`，所以后台改的音频/文案会同步反映到演示页。
- H5 的数据只写 localStorage，广告用倒计时模拟，不产生真实收益或服务端记录。

---

## 9. 已知取舍

| 取舍 | 影响 | 备注 |
|---|---|---|
| 用 BackgroundAudioManager | 不能混音；占用微信音乐卡片 | 换来电锁屏可用，值得 |
| 不做 LLM | 文案是固定句式，变化少 | 可控性 > 多样性；后续要加只做"改写"不做"新增" |
| 前后端各有一份周统计逻辑 | 两处算法需同步维护 | 客户端负责展示，服务端负责文案，接口以原始记录为准；已用单测锁住关键行为 |
| openid 云同步 | 需要声明隐私指引 | 静默登录，无弹窗；`features.sync` 可一键关闭 |
| 限流用内存 | 多实例失效 | 本期单实例 |
| 上传走 API 中转 | 3M 带宽下 5MB 约十几秒 | 换来不用把 COS 密钥放到浏览器；后期可改预签名直传 |
| H5 复制了一份计算逻辑 | 改算法要同步两处 | H5 只用于演示，不承担生产正确性；关键算法仍以小程序单测为准 |
