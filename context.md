# 睡点 · 当前上下文（context.md）

> 最后更新：2026-10-19 · 这份文件是“当前代码事实”的速查，不替代 PRD/架构文档；重大改动先改这里，再同步 docs。

## 1. 当前产品形态

- 微信小程序，三个 tab：**计算器 / 入睡 / 统计**。
- 计算器：12 小时循环时间轮（时 / 分 / 上午·下午），按起床倒推入睡、按入睡推起床，真 3D 翻转结果；2026-10-19 已按参考图收敛视觉（无内层面板/光晕、无中央高亮带、标题改无衬线、弱化 CTA 阴影）。
- 入睡：A 未记录 / B 睡梦中 / C 已完成；B 态可撤销，C 态展示入睡、起床、在床时长。
- 统计：横向 120 天热力图、周均值、事实回顾、月度海报、云同步/清除数据。
- 声音：`audio-dock` 悬浮钮 + 迷你播放器 + 底部抽屉；搜索、分类、收藏、缓存、广告解锁、定时关闭。
- 顶部：自定义 `navigationStyle: custom`，通栏透明 + 延伸到胶囊前的全宽玻璃“灵动岛”，不再有固定原生导航背景。
- 后台：`/admin` 左侧主菜单 + 右侧单面板，8 个分类（含“用户数据”按 openid 查/删），sticky 保存条。
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
    config.js / api.js / request.js / login.js / ad.js / events.js
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
docs/             00–09 文档
tests/            Node 纯逻辑测试
```

## 3. 配置边界（重要）

| 配置 | 位置 | 是否可视化 |
|---|---|---|
| 音频清单/名称/分类/URL/排序/图标 | `/admin` 环境音 | 是 |
| 广告位、解锁方式、有效期、失败策略 | `/admin` 广告与解锁 | 是 |
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
- 服务端 `sleep_records` 主键 `(openid, day)`；`/api/records/sync` 幂等 upsert，返回云端全量用于换机回填。
- 删除：本地墓碑 `sleep:deleted:v1` 阻止回填；`POST /api/records/erase` 物理删除该 openid 的睡眠记录、解锁与事件，客户端成功后才清本地。
- 客服/合规：`GET /api/admin/users/:openid` 查询、`DELETE /api/admin/users/:openid/records` 删除；后台“用户数据”面板，删除记审计日志（openid 哈希前缀，不落明文）。
- 取消/撤销：B 态撤销只清 pending；C 态撤销写墓碑。
- 当前**不支持**一天多次睡眠（午休）作为独立记录；一条记录会覆盖同一天。详见“待决策”。

## 5. 当前验证基线

- `npm test`：**53 passed / 0 failed**（18 客户端 + 35 服务端）。
- `npm run check`：3 页面 / 15 JSON / 10 WXML / 11 WXSS，主包约 178 KB（以最新输出为准）。
- 微信开发者工具（AppID `wx378b0a7437d60998`）：三页真实编译/截图；计算器时间轮循环、上午/下午、3D 翻转结果；控制台无 error。
- 本地 PostgreSQL + API（3100）：`/api/ready` 200，配置写库后公共接口立即生效，后台登录/看板正常。
- 后台浏览器实测：左菜单切换、音频标题保存、配置接口写库、窄屏横向 tabs、无 console error。
- 未验证：真机锁屏续播、激励视频、真实 COS 上传、audio-dock 完整交互、H5 新结构。

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
5. **午休/多次睡眠未支持**：建议新增独立 `nap` 记录（start/end/kind），不混入夜间睡眠均值/连续天数；需要同步协议与统计口径一起改。
6. **H5 仍是旧结构**：`/demo/` 只同步了色板；三 tab + audio-dock 待重做。
7. **单实例**：限流、配置缓存、事件、定时器都在进程内；扩容前换共享存储。

## 8. 快速命令

```bash
npm test
npm run check
docker compose up -d --build
curl http://127.0.0.1:3000/api/ready
```

后台：`/admin`，密码来自 `.env` 的 `ADMIN_PASSWORD`。
小程序：微信开发者工具导入仓库根目录；开发版自动指向 `127.0.0.1:3100`，体验/正式版自动指向 `https://sleep.qfmaster.com`。
关键取舍见 [DECISIONS.md](DECISIONS.md)（14 条 ADR：睡眠日边界、圆均值、LWW、模板总结、午休范围、1Panel 部署等）。




