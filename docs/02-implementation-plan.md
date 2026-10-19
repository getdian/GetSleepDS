# 睡点 · 实施计划

- 版本：1.1 / 2026-10-19（新增第 6 节：P6 增长与变现实施计划）
- 目标：两周内可提审的 L1 可运行版本（单机部署、单数据库、无第三方 UI 库）

---

## 0. 范围与节奏

| 阶段 | 内容 | 交付物 | 验收 | 状态 |
|---|---|---|---|---|
| P0 | 文档与规格收敛 | `docs/00~05` | 改动项有结论，算法有唯一口径 | ✅ 本次完成 |
| P1 | 小程序骨架 + 首页 | `app.*`、`utils/time|format|storage`、`pages/index` | 倒推 23:45/01:15/02:45；三态打卡可重启恢复 | ✅ 本次完成 |
| P2 | 回顾页 | `utils/stats`、`components/heatmap`、`pages/stats` | 热力图周一对齐、跨午夜均值正确、回顾按阈值出现 | ✅ 本次完成 |
| P3 | 环境音 + 广告 | `utils/ad`、`components/unlock-sheet`、`pages/audio` | 锁屏续播、24h 解锁、无广告位降级 | ✅ 本次完成 |
| P4 | 后端 + 部署 + 后台 | `server/`、`public/admin/`、`Dockerfile`、`docker-compose.yml` | 接口可用、后台可登录改配置、单测通过、compose 可起 | ✅ 本次完成 |
| P4.5 | 音频运营 + 看板 + H5 | COS 上传、分类/搜索、本地缓存、事件看板、`/demo/` 与 `/` | 浏览器可完整走通，POST 事件能在看板看到 | ✅ 本次完成 |
| P7 | 视觉与信息架构改版 | 计算器/入睡/统计三 tab、时间轮、氛围背景、玻璃卡片、跨页定时器 | 单测 + 静态检查通过；真机视觉待验收 | ✅ 本次完成 |
| P5 | 上线准备 | 账号/类目/域名/COS/广告位/隐私指引 | 真机全流程走通 | ⏳ 待外部输入 |
| P6 | 增长与变现（下一期） | 分享归因埋点、海报小程序码、商业模式决策（批次 A/B/C，见第 6 节） | 批次 A：看板出现"来源分布"；批次 B：真机扫码在看板出现 1047 来源 | ✅ 批次 A/B 已交付（2026-10-19，码链路待发布后真机验收）；批次 C 决策已固化（ADR-017/018），观察项待上线积累数据 |

---

## 1. 本次执行步骤（已按序完成）

1. 输出 7 份文档：修订 PRD、架构与接口、实施计划、上线清单、素材清单、后台管理、H5 与落地页。
2. 生成小程序骨架：`app.json`（深色、3 个 tab、后台音频声明）、`app.wxss`（设计变量）、`project.config.json`。
3. 写纯逻辑层：`time.js`（倒推、睡眠日、圆均值、周期边界）、`stats.js`（周统计、热力图、连续天数）、`format.js`。
4. 写基础设施层：`storage`、`request`、`api`、`login`、`config`、`sync`、`ad`。
5. 入睡页：三态打卡、熄灯动画、B 态撤销、近 7 天圆点条。
6. 统计页：三项均值、横向热力图、事实回顾、海报、同步/清除。
7. 环境音抽屉：后台播放、单曲循环、定时关闭、解锁面板、搜索/分类/缓存清理。
8. 后端：Express + pg 连接池 + 内存模式（本地无 PG 可跑）+ 模板总结 + 限流。
9. 后台管理：配置入库（`app_config`）、配置校验、密码登录与签名 Cookie、`/admin` 页面（音频增删改/排序/试听、广告位、开关、文案、概览），浏览器实测。
10. 音频运营：COS 配置加密入库、后台直传、分类与搜索、客户端落盘缓存与 Wi-Fi 预加载、解锁时广告与下载并行。
11. 看板与 H5：四个轻量事件上报、14 天趋势与 Top 5、落地页 `/`、H5 交互演示 `/demo/`，浏览器实测。
12. 校验：Node 单测（时间/统计/总结禁词/后台鉴权/事件/存储）、后端冒烟、PostgreSQL 端到端、JSON/WXML/CSP 静态检查、图标与演示音频生成。
13. 根 README：启动方式、后台入口、H5 入口、配置位置、验证命令、待办。

---

## 2. 本次交付的验证方式

```bash
# 1. 纯逻辑单测（无需微信开发者工具）
npm test

# 2. 静态检查：JSON 可解析、WXML 标签闭合、页面四件套齐全
npm run check

# 3. 后端本地冒烟（内存模式，不需要 PG）
cd server && npm install
DB_MODE=memory ALLOW_DEV_LOGIN=1 PORT=3000 node src/index.js
curl http://127.0.0.1:3100/api/health
curl http://127.0.0.1:3100/api/config
# summary 的请求体见《架构与接口》5.3；用 curl 时注意 day 必须等于入睡时间的睡眠日

# 4. PostgreSQL 端到端（可选，用一次性容器）
#    起库 → 用 DATABASE_URL 启动 API → 调 unlock 与 sync → psql 校验行数与过期时间

# 5. 后台（可选）
ADMIN_PASSWORD=local-admin node src/index.js
# 浏览器打开 http://127.0.0.1:3100/admin 登录，改广告位/音频后保存
```

本次已实测：65 个单测通过、静态检查通过、内存模式接口符合预期、PostgreSQL 16 容器端到端通过（建表 / 解锁 24h / sync 幂等 / 回填 / summary / erase / 后台配置持久化）、后台浏览器端到端（登录、保存写库、公共配置与解锁 TTL 即时生效、音频增删与试听、存储面板）、H5 落地页与演示页浏览器验收（打卡、热力图、音频解锁、缓存状态）、compose 配置通过、生产环境启动保护生效。

小程序端在微信开发者工具中导入仓库根目录（`project.config.json` 已指向 `miniprogram/`），AppID 已配置为 `wx378b0a7437d60998`。**2026-10-19 已在开发者工具完成三页编译、时间轮 23:55 循环/上午下午切换/3D 结果、通栏灵动岛截图；真机音频与广告仍需按 08 验收清单逐项过。**

---

## 3. 需要外部输入才能继续的事

| # | 事项 | 影响 | 谁提供 |
|---|---|---|---|
| 1 | 小程序 AppID / AppSecret | 真机登录、解锁接口 | AppID 已提供 `wx378b0a7437d60998`；AppSecret 仍需写入服务端 `.env` |
| 2 | 已备案 API 域名 + HTTPS 证书 | 请求合法域名、上架 | 运维 |
| 3 | COS 音频 + 域名白名单 | 环境音播放、`downloadFile` 白名单 | 已提供 1 条 `sleep-10001`；还需 3–5 条与白名单配置 |
| 4 | 后台密码 / 加密密钥 | `/admin` 登录、COS 凭证保存 | 运维在 `.env` 设置 `ADMIN_PASSWORD`、`CONFIG_SECRET` |
| 5 | COS 子账号 SecretId / SecretKey | 后台上传音频 | 运维在 `/admin` 的“存储与上传”里填，或写环境变量后由后台录入 |
| 6 | COS 防盗链放行 | 小程序/H5 播放 | 放行 `servicewechat.com` 与 H5 域名，或暂时关闭防盗链 |
| 7 | 流量主开通 + 广告位 ID | 广告解锁真正生效 | 运营（需先有 1000 UV） |
| 8 | PostgreSQL 实例或 compose 部署机 | 解锁/同步/看板落库 | 运维 |
| 9 | 类目与隐私指引审核 | 提审 | 管理员 |

未提供时的默认行为：COS 未配置时只能使用已有音频、不能后台上传；广告位为空（直接解锁）；数据库用内存模式（重启即丢）。这些都能跑通流程，但不能上线。

---

## 4. 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| 后台音频审核被要求补充说明/类目 | 中 | 提审备注写"环境音播放，用于睡前放松，不涉及医疗健康"；必要时先关掉该 Tab 提审 |
| 类目被判为"文娱-音频"需资质 | 中 | 先用"工具-效率"提审探路；音频页不出现音乐库/榜单等文娱特征 |
| 安卓低端机毛玻璃失效 | 高 | 全部卡片有 `rgba` 兜底，无 `backdrop-filter` 也可读 |
| 广告 eCPM 低于预期 | 高 | 广告只作为补充；P6 走电商 CPS + App 订阅 |
| 本地数据丢失投诉 | 中 | 云备份默认关闭（数据本地化），统计页显式开启；关闭时会提示本地不受影响 |
| 夜间弹广告导致流失 | 中 | 24h 只弹一次；无广告位直接放行；后续可改为"白天下发广告、夜间免广告" |

---

## 5. 回滚

- 小程序：微信后台"版本回退"到上一线上版本，配置接口可即时关掉 `features.summary` / `sync`。
- 服务端：镜像保留上一 tag；compose `docker compose up -d` 回退。
- 数据：本期无破坏性迁移，`CREATE TABLE IF NOT EXISTS` 幂等。

---

## 6. P6 增长与变现实施计划（2026-10-19 制定）

> 前提事实：分享入口已三页可用（2026-10-19 补齐，计算器页含朋友圈）；`events` 通道的 `app_open` 类型与 `target`（64 字符）字段现成可用，**全程零 schema 变更、零新接口**（批次 B 除外）；`analytics.js` 已有按 target 聚合的先例（Top5 音频）。

### 批次 A：分享归因（无外部依赖，可立即开发，约半天）

| # | 改动 | 文件 | 要点 |
|---|---|---|---|
| A1 | 启动来源归一化纯函数 | `miniprogram/utils/launch-source.js`（新增） | `launchSourceOf(options)` → `'1007|pages/index/index|share'`（scene + 打开页 + from 参数，≤64 字符）；零 `wx` 依赖，Node 可直接单测 |
| A2 | onLaunch 接住 options 并上报 | `miniprogram/app.js` | `onLaunch(options)` 存 launchSource；`:29` 的 `track('app_open')` 改为 `track('app_open', launchSourceOf(options))` |
| A3 | 来源聚合 | `server/src/services/analytics.js` | 仿 topTracks 增加 `topSources`（14 天窗口内 app_open 按 target 计数 Top5；历史空 target 归 `unknown`）；overview 返回值自动透出到 `/api/admin/analytics`，路由零改动 |
| A4 | 看板"来源分布"卡片 | `server/public/admin/`（index.html/admin.js/admin.css） | 与"播放 Top5"同款列表；scene 码映射可读标签（1001 发现栏 / 1007 会话卡片 / 1008 群卡片 / 1011 扫码 / 1047 小程序码 / 1154 朋友圈单页，未识别显示原值） |
| A5 | 单测 | `tests/launch-source.test.js`、`server/test/analytics.test.js`（新增） | 前者锁 scene/path/from 组合与截断；后者用注入 fake db/store 断言 topSources 聚合；`npm test` 脚本按 glob 自动纳入 |

验证门：`npm test`、`npm run check`、内存模式冒烟（登录后台看"来源分布"出现、转发路径打开后 target 形如 `1007|pages/index/index|share`）。
上线动作：随下一个小程序版本发布（scene 上报从新版本启动才开始积累）。

### 批次 B：海报小程序码（约 1 天开发，外部依赖 AppSecret + 小程序已发布）

| # | 改动 | 文件 | 要点 |
|---|---|---|---|
| B0 | **外部前置** | `.env` 填 `WX_APPID`/`WX_SECRET` | 未就绪时批次 B 整体不开发，海报维持"微信搜索「睡点」"落款 |
| B1 | access_token + 小程序码 | `server/src/services/wx.js` | 优先 `POST /cgi-bin/stable_token`（不互相顶掉旧 token），进程内缓存至过期前 5 分钟（单实例口径与限流一致）；`getUnlimitedQrCode(scene, page)` 调 `/wxa/getwxacodeunlimit`，任何失败抛业务错误不 500 |
| B2 | 码接口 | `server/src/routes/share.js`（新增，挂 `/api/share/qrcode`） | code→openid 鉴权 + 3 次/分/IP 限流；scene 固定 `'p'`（poster），page 固定 `pages/index/index`；返回 `image/png` buffer + `Cache-Control: private, max-age=3600` |
| B3 | 路由挂载 | `server/src/app.js` | 与 audio/records 同款注册 + 限流参数 |
| B4 | 海报画码 | `miniprogram/utils/api.js`、`pages/stats/stats.js` | 拉 arraybuffer → `FileSystemManager.writeFile` 临时文件 → 旧版 canvas `ctx.drawImage` 画在海报底部；**3s 超时/任何失败→跳过画码**，海报必出 |
| B5 | 归因闭环 | 无新代码 | 扫码打开 scene=1047，批次 A 看板自然出现 `1047|pages/index/index` |

验证门：`npm test`、`npm run check`、内存冒烟（code 换码接口在无 AppSecret 时明确报错而非挂起）、真机扫码 → 看板出现 1047 来源。
风险：小程序未发布时 `getwxacodeunlimit` 报错（体验版可传 `check_path:false` 规避）——降级路径 B4 必须先行可用。

### 批次 C：商业模式决策（上线后 2–4 周，数据评审，不是开发任务）

| 决策点 | 规则（预设阈值，评审时按实际数据拍板） | 动作 |
|---|---|---|
| 分享是否值得投入 | 看板中分享类来源（1007/1008/1154）占 app_open ≥15% | 做：分享卡片统一配图 + 文案 A/B；不做：分享维持现状，投入转内容 |
| 流量主开通 | 累计独立访客 ≥1000（微信门槛） | 填 `adUnitId`，观察 `audio_unlock` 转化率；`onAdError` 保持 grant 兜底 |
| 付费音频包 | — | **不立项**：iOS 虚拟支付限制 + Sleep 类目审核风险；写 ADR-017 固化 |
| 分享解锁 | — | **不做**：诱导分享是审核红线，且 iOS 无朋友圈入口、激励双标；写 ADR-018 固化 |

### 排期与门禁汇总

- 批次 A：立即可做（半天）→ 随下个版本发布。
- 批次 B：等 B0 外部输入 → 开发 1 天 → 发布后真机扫码验收。
- 批次 C：批次 A 上线积累 2 周数据后评审 → 结论写 `DECISIONS.md`（ADR-017/018）。
- 全程无 schema 变更（复用 `events.target`），每批次门禁 = `npm test` + `npm run check` + 内存冒烟；批次 B 增加 PG 端到端与真机项。


