# 睡点 · 微信小程序

极简睡眠时间计算 + 一键打卡 + 环境音。零登录、零授权、只有深色主题，前后端分离。

当前是 **L4 商业交付候选**：三 tab 小程序、audio-dock、Express/PG 后端、后台管理、H5 演示与部署文件已就位。融合了同产品另一实现的 audio-dock、真 3D 翻转、A/B/C 打卡态、横向热力图与海报/清除数据。还缺 AppSecret、API 域名、广告位与真机验收。

## 当前状态

| 项 | 状态 |
|---|---|
| 3 个 tab（计算器 / 入睡 / 统计）+ audio-dock 声音抽屉 | ✅ 已实现，深色玻璃视觉 |
| 通栏透明顶栏 + 悬浮“灵动岛” | ✅ 已实现，去掉固定原生导航条 |
| 90 分钟双向倒推、时间轮、真 3D 翻转、A/B/C 打卡 | ✅ 已实现，有单测 |
| 横向 120 天热力图、周均值、海报、云同步/清除 | ✅ 已实现 |
| 后端公共接口 + 后台 11 个接口 + PG 连接池 + 内存模式 | ✅ 已实现，有单测 |
| Dockerfile / docker-compose | ✅ 已实现，`docker compose config` 校验通过 |
| 后台管理 `/admin` | ✅ 左侧主菜单 + 右侧分类面板，浏览器实测保存 |
| 落地页 `/` + H5 交互演示 `/demo/` | ✅ 浏览器实测（H5 仍为旧版结构，色板已同步） |
| 51 个单元测试 | ✅ 全部通过 |
| AppID / 首条 COS 音频 | ✅ 已写入配置（`wxaa4e654a147d030d`，1 条雨声） |
| 微信开发者工具渲染 / 真机音频 / 广告 | ⚠️ 未验证，需要外部账号与环境 |

设计取舍与验收口径见 [修订版 PRD](docs/00-prd-revised.md)，接口与数据模型见 [架构说明](docs/01-architecture.md)。

## 目录

```
miniprogram/            小程序（原生 WXML/WXSS/JS，无第三方 UI 库）
  config/env.js         ← API 域名，唯一必须改的前端配置
  config/fallback.js    ← 服务端不可达时的兜底配置
  utils/                时间、统计、存储、请求、广告、同步、缓存、事件、跨页定时器
  components/           ambient / top-bar / time-wheel / audio-dock / heatmap / unlock-sheet / empty-state
  pages/                index（计算器）/ sleep（入睡）/ stats（统计）
  assets/               tabBar 与音频图标
server/                 Express API（config / unlock / summary / sync / events / admin）
  config/app.config.json ← 种子与兜底配置（日常在 /admin 改）
  public/admin/          ← 后台管理页面
  public/site/           ← 落地页 + H5 交互演示
  sql/001_init.sql
  test/
docs/                   10 份文档
tests/                  小程序纯逻辑单测
tools/                  资源生成、静态检查
```

## 快速开始

### 1. 小程序（不需要后端也能看计算器/入睡）

1. 微信开发者工具 → 导入项目 → 选择仓库根目录（`project.config.json` 已指向 `miniprogram/`）。
2. AppID 已写入 `wxaa4e654a147d030d`，用该小程序的管理员/开发者微信扫码登录工具即可。
3. 详情 → 本地设置 → 勾选 **不校验合法域名**（`config/env.js` 默认指向 `http://127.0.0.1:3000`）。
4. 编译，计算器页直接可用；打卡数据写本地存储。

底部 tab 是 **计算器 / 入睡 / 统计**。声音不在 tabBar：从「入睡」页右下角“声音”进入底部抽屉，播放后变成迷你播放器，收起/切 tab 继续播放。视觉系统见 [改版说明](docs/09-redesign.md)。

环境音已接入 1 条 COS 音频（约 3 分钟，5.7MB）。真机播放前，必须把 `qfmaster-1322402212.cos.ap-shanghai.myqcloud.com` 加入公众平台 → 开发管理 → 服务器域名 → **downloadFile 合法域名**；开发者工具里勾了“不校验合法域名”可直接试听。

### 2. 后端（内存模式，不需要 PostgreSQL）

```bash
cd server
npm install
# macOS / Linux
DB_MODE=memory ALLOW_DEV_LOGIN=1 ADMIN_PASSWORD=local-admin node src/index.js
# Windows PowerShell
$env:DB_MODE='memory'; $env:ALLOW_DEV_LOGIN='1'; $env:ADMIN_PASSWORD='local-admin'; node src/index.js
```

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/config
```

内存模式重启即丢，只用于联调；生产必须用 PostgreSQL。

### 3. 后台管理（不用改任何文件）

启动后端后打开：

```
http://127.0.0.1:3000/admin
```

![后台管理](docs/assets/admin.png)

- 密码就是 `ADMIN_PASSWORD`；没设置时，服务端启动日志会打印本次临时密码。
- 能改：环境音（名称/分类/地址/图标/顺序/增删/上传）、广告位与解锁有效期、功能开关、缓存上限与有效期、解锁文案。
- 能看：今日/本周打开、打卡、播放、用户数，14 天趋势，播放 Top 5。
- “存储与上传”里填 COS 的 Bucket / Region / SecretId / SecretKey，可直接上传音频；SecretKey 加密入库、不回显。
- 保存写入数据库 `app_config` 表，接口立即生效；小程序最多 10 分钟后拉取新配置，重开小程序则立即生效。
- `server/config/app.config.json` 只是首次部署的种子与数据库故障时的兜底，日常不用手改。
- 详细说明见 [后台管理文档](docs/05-admin.md)。

### 4. 落地页与 H5 演示

同一个 API 进程直接提供：

```
http://127.0.0.1:3000/          落地页
http://127.0.0.1:3000/demo/     H5 交互演示（打卡 / 热力图 / 音频 / 模拟广告解锁）
```

![落地页](docs/assets/landing.png)

H5 读取同一份 `/api/config`，后台改音频或文案会同步反映；演示数据只存浏览器 localStorage，广告是 5 秒倒计时模拟。

### 5. 后端 + 数据库（Docker）

```bash
cp .env.example .env      # 填 POSTGRES_PASSWORD、WX_APPID、WX_SECRET、ADMIN_PASSWORD、CONFIG_SECRET、DOMAIN
docker compose up -d --build
curl http://127.0.0.1:3000/api/ready

# 有域名、80/443 可放行时，用 Caddy 自动 HTTPS
docker compose --profile https up -d
```

`/api/ready` 会在数据库不可用时返回 503；`/api/health` 只用于看进程状态。生产环境缺少 `ADMIN_PASSWORD` 会直接启动失败。

`NODE_ENV=production` 下有三道启动保护：缺微信密钥、开 `ALLOW_DEV_LOGIN`、用内存库，都会直接启动失败，避免带病上线。

## 配置在哪

| 要改什么 | 改哪里 |
|---|---|
| API 域名 | `miniprogram/config/env.js` |
| 音频列表 / 广告位 / 功能开关 / 缓存 / 解锁文案 | **后台 `/admin`**（写 `app_config` 表）；`server/config/app.config.json` 仅作种子与兜底 |
| COS 凭证与音频上传 | 后台 `/admin` → 存储与上传（SecretKey 加密入库） |
| 后台登录密码 / 加密密钥 | `.env` 的 `ADMIN_PASSWORD`、`CONFIG_SECRET` |
| 数据库、微信密钥、限流阈值 | `.env`（参考 `.env.example`） |
| 颜色、圆角、字号 | `miniprogram/app.wxss` 与各页面 `wxss` |

`adUnitId` 留空 = 客户端直接解锁（开发期与未开通流量主时的正式降级路径）。

## 验证

```bash
npm test        # 51 个单测：时间、统计、双向倒推、热力图/墓碑、API、后台鉴权/事件/COS 配置
npm run check   # JSON / WXML 标签 / WXSS 括号 / 页面四件套 / 组件引用 / CSP inline 检查
```

本次实际执行结果：

- `npm test`：51 passed / 0 failed
- `npm run check`：通过，主包约 178 KB
- 后端内存模式冒烟：`/api/health`、`/api/config`、`/api/summary`、`/api/audio/unlock`、`/api/records/erase` 均符合预期
- **PostgreSQL 16 容器端到端**：自动建表、解锁写入 24 小时、`sync` 幂等、空记录同步能取回 3 条（换机回填）、`summary` 正常返回、后台配置重启后仍在
- **后台浏览器实测**：登录、保存（写库并立即改变 `/api/config` 与解锁 TTL）、环境音增删、COS 音频试听、存储面板、14 天趋势渲染、无未捕获 JS 错误
- **H5/落地页浏览器实测**：三 Tab 切换、填充演示数据、热力图、音频解锁与回退、播放器状态
- `docker compose config`：通过
- 生产配置三道保护：均按预期启动失败

**没有验证**：WXML 实际渲染、新 audio-dock 抽屉/3D 翻转/热力图/海报、真机后台音频、锁屏续播、激励视频、真机网络请求。这些必须在微信开发者工具与真机上逐项过 [验收清单](docs/00-prd-revised.md#8-验收清单)。

## 已知限制

- 环境音目前只有 1 条（`sleep/sleep-10001.mp3`），标题暂用“环境音 01”，确认内容后可直接在 `/admin` 改；COS 域名需加入 `downloadFile` 合法域名。
- 服务端 AppSecret 未写入仓库，必须自己填到 `.env`；不填时只能以 `ALLOW_DEV_LOGIN=1` 做本地联调。
- 内存模式下后台保存的配置重启会丢（页面会提示“内存（重启丢失）”），正式环境请用 PostgreSQL。
- 若 COS 开了防盗链，必须放行 `servicewechat.com`，否则小程序内音频会 403；H5 演示还需放行站点域名（演示页失败会回退本地测试音）。
- 后台退出只清 Cookie，已签发会话 7 天内仍有效；需要强制下线时更换 `ADMIN_SECRET` 并重启。
- 单实例：限流、配置缓存、事件队列都在进程内，扩容前需要改造。
- 后台上传走服务器中转，3M 带宽下 5MB 文件约十几秒；后续可改 COS 预签名直传。
- H5 是演示：广告是倒计时模拟、数据只存 localStorage、回顾句本地生成；**H5 仍是改版前的结构，只同步了色板**，小程序以 `pages/` 为准。
- 后台音频不支持混音；`定时关闭` 在锁屏后可能延后到回到小程序才触发（JS 被挂起）。
- 撤销打卡只删本地并写墓碑；要彻底删除请用统计页“清除数据（云端+本机）”，它会先调 `POST /api/records/erase`。
- 收藏只在本机（`meta.favoriteAudioIds`），不参与云同步，换机不迁移。
- 小程序内不做订阅/会员支付（iOS 虚拟支付受限），也没有预留支付链路。
- 限流是进程内实现，多实例部署会失效。

## 文档

0. [当前上下文 context.md](context.md) —— 代码事实、配置边界、部署幂等与待决策
1. [修订版 PRD](docs/00-prd-revised.md) —— 范围、页面规格、算法口径、与原始 PRD 的 10 处差异、验收清单
2. [架构与接口](docs/01-architecture.md) —— 目录、数据模型、API 契约、降级矩阵、安全
3. [实施计划](docs/02-implementation-plan.md) —— 阶段、验证命令、待外部输入
4. [上线清单](docs/03-launch-checklist.md) —— 账号、类目、域名、COS、广告、隐私、提审话术
5. [后台管理](docs/05-admin.md) —— 登录、左菜单配置、COS 上传、看板、安全与常见问题
6. [素材清单](docs/04-assets.md) —— 音频/图标的文件、参数、授权留证
7. [H5 与落地页](docs/06-h5-and-landing.md) —— 演示范围、一致性、已知差异
8. [代码审查报告](docs/07-code-review.md) —— 发现的问题、修复状态、剩余风险
9. [部署 Runbook](docs/08-deploy-runbook.md) —— 首次部署、HTTPS、备份、回滚
10. [改版说明](docs/09-redesign.md) —— 三 tab、通栏灵动岛、时间轮、audio-dock、跨页定时器

## 下一步

1. 打开 `/admin`，填 COS 存储配置，把音频标题、分类、广告位、缓存参数调对。
2. 在 COS 防盗链放行 `servicewechat.com`，配置 `downloadFile` 白名单，真机跑通“播放 → 锁屏 → 解锁 → 定时关闭”。
3. 在后台补齐到 4–6 条环境音，确认分类、搜索与收藏。
4. 按 [上线清单](docs/03-launch-checklist.md) 提审。
5. 下一轮产品项：午休/多次睡眠独立记录、后台改密码（DB 哈希 + 会话失效）、H5 对齐新版。


