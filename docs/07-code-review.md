# 睡点 · 代码审查报告（MVP / L4 交付前）

- 日期：2026-10-18
- 范围：`miniprogram/`、`server/`、`server/public/admin`、`server/public/site`、部署与文档
- 方法：逐文件阅读关键路径 + 65 个自动化测试 + 内存/PostgreSQL 实跑 + 浏览器端到端 + 对 COS 真实 URL 做 HTTP 探测
- 结论：**主流程闭环，没有发现会让数据丢失或后台失守的代码级 P0**；有 1 个外部配置级 P0（COS 防盗链），以及若干已修复的 P1/P2。

> 2026-10-19 融合说明：本报告记录的是改版前审查。`pages/audio` 已并入 `components/audio-dock`；计算器改为真 3D 翻转；入睡页补 B 态撤销；统计页补横向热力图、海报、云同步/清除数据。对应文件路径以当前仓库为准。

---

## 1. 已修复的问题（本轮）

| 级别 | 位置 | 事实与证据 | 修复 |
|---|---|---|---|
| P1 | `server/src/lib/config-schema.js#normalizeConfig` | 早前后台保存的音频没有 `category`，数据库里也没有 `cache`；升级后分类筛选为空、缓存上限读到 `undefined`。测试 `旧配置缺少 category / cache` 复现 | 逐条补齐 `category/subtitle/icon`，并给 `features/cache` 默认值 |
| P1 | `server/src/services/storage-settings.js#getPublic` | 只判断 `secretKeyEnc` 是否存在。更换 `ADMIN_PASSWORD/CONFIG_SECRET` 后解密失败，仍显示“已配置”，上传才在 COS 侧报错 | `configured` 改为“解密成功且字段齐全”，新增 `secretBroken`，后台提示重填 SecretKey |
| P1 | `server/src/app.js` + `docker-compose.yml` | `/api/health` 在数据库挂掉时仍返回 200，compose 会认为容器健康 | 新增 `/api/ready`（DB 不可用返回 503），healthcheck 改用它 |
| P1 | `server/src/config/index.js` | 生产环境不设 `ADMIN_PASSWORD` 也能启动，临时密码会写进日志 | 生产环境缺少 `ADMIN_PASSWORD` 直接启动失败 |
| P1 | `miniprogram/utils/events.js#flush` | 启动时 `track` + `flush` 与 `onShow` 的 `flush` 可能并发，同一批事件被上报两次 | 加 in-flight Promise 去重 |
| P1 | `miniprogram/pages/audio/audio.wxml` | 缓存标记用 `{{cacheMap[item.id]}}`，依赖 WXML 动态键表达式；一旦基础库不支持会整列不显示 | 改为在 `applyFilter` 里预计算 `item.cached` |
| P1 | `miniprogram/pages/audio/audio.js#togglePlay` | 暂停后定时器仍走，恢复播放时 `startTimer()` 又把 60 分钟重置 | 暂停停表并显示剩余；恢复按原 `_endAt` 继续；暂停时改时长只重算目标时间 |
| P1 | `miniprogram/pages/index/index.js#refreshPlan` | 白天打开会出现“现在睡 · 约 10 个完整周期 · 15 小时” | 9:00–18:00 改为展示“今晚 23:45 入睡 · 07:30 起床”，夜间才显示周期倒数 |
| P1 | `server/public/site/demo.html` | 从 `/demo/` 打开时相对路径解析成 `/demo/site.css`，整页无样式、脚本 404（浏览器实测） | 资源改绝对路径，并给 `/demo` 单独路由 |
| P2 | `server/public/admin/index.html` | 已登录用户打开后台会先闪一下登录页 | 增加 `boot-view` 加载态，会话校验后再切换 |
| P2 | `server/public/admin/admin.js#renderTrend` | 没有事件时 14 天图表是一片空白 | 增加空状态文案 |
| P2 | `server/public/site/demo.css` | 时间输入框宽度 110px，中文“上午”被截断 | 加宽到 164px；热力图宽度限制 430px |
| P2 | `miniprogram/utils/audio-cache.js` | 元数据丢失但文件仍在时，`saveFile` 可能因目标已存在失败 | 保存前先 `unlinkSync` |
| P2 | `server/src/app.js` | 日志无请求 ID，排查线上问题时串不起来 | 生成/透传 `X-Request-Id`，请求日志 JSON 化 |
| P3 | `server/src/routes/admin.js` | `application/octet-stream` 的 mp3 上传后 Content-Type 可能不对 | 非 `audio/*` 时统一按 `audio/mpeg` 上传 |

---

## 2. 仍存在、需要外部条件或后续版本

| 级别 | 问题 | 事实/影响 | 建议 |
|---|---|---|---|
| **P0（外部）** | COS 防盗链拦截带 Referer 的请求 | `curl -H "Referer: http://127.0.0.1:3106/demo/"` 返回 403；不带 Referer 返回 200。微信小程序音频请求通常带 `servicewechat.com` Referer，真机大概率 403 | COS 控制台放行 `servicewechat.com` 与 H5 域名，或关闭防盗链；上线前用真机确认 |
| P1（外部） | 真实 COS 上传未验证 | 没有 SecretId/SecretKey，只测了鉴权、无文件、加密入库、COS 测试接口的失败分支 | 在后台填子账号密钥 → 测试连接 → 传一条 → 播放 |
| P1（外部） | 真机音频/广告未验证 | 无微信开发者工具与流量主 | 按 `docs/00-prd-revised.md` 第 8 节逐项过 |
| P2 | 后台会话无状态，退出只清 Cookie | 已签发的 token 在 7 天内仍有效（需拿到 Cookie 才能用） | 若要求强制下线，增加服务端 session 版本号/黑名单 |
| P2 | 上传后未保存配置会留下 COS 孤儿对象 | 上传成功即写 COS，配置保存才引用 | 定期清理 `sleep/` 下无引用对象，或上传后自动保存 |
| P2 | 删除音频不删 COS 对象 | 只从配置移除，文件保留 | 需要时加“删除对象”动作，并二次确认 |
| P2 | 多实例不可用 | 限流、配置缓存、事件队列都在进程内 | 单实例部署；扩容时换 Redis/共享配置 |
| P2 | 没有监控/告警 | 只有 `/api/ready` 与请求日志 | 接 Uptime 探针 + 日志采集；DB/COO 错误率告警 |
| P2 | 事件统计无法关闭 | 只带 openid/类型/音频 id/时间，但用户不能 opt-out | 需要时加 `features.events` 开关并在隐私指引说明 |
| P2 | 单文件 25MB 走内存 | 并发上传会占内存 | 限制并发/降低上限，后期改预签名直传 |
| P3 | 音频 256kbps / 5.7MB | 首播慢、流量大 | 重压到 96–128kbps 单声道 |

---

## 3. 功能闭环检查

| 链路 | 状态 | 说明 |
|---|---|---|
| 打开 → 倒推 → 改时间/耗时 | 闭环 | 纯前端，单测覆盖 |
| 入睡打卡 → 杀进程 → 记录起床 → 完成 → 撤销 | 闭环 | `pending` 持久化；撤销写墓碑防回填 |
| 本周均值 / 热力图 / 连续天数 | 闭环 | 跨午夜圆均值、周一对齐、单测覆盖 |
| 事实回顾 | 闭环 | ≥3 条才请求；服务端模板 + 禁词校验；失败可重试 |
| 环境音：搜索/分类/播放/锁屏/定时/解锁 | 闭环 | 缓存失败回退网络；定时器后台会漂移（已知） |
| 广告解锁 + 并行缓存 | 闭环 | 广告与下载并行；服务端不可达本地放行 |
| 后台改配置 → 小程序生效 | 闭环 | DB 优先，30s 服务端缓存，客户端 10 分钟 |
| 后台上传 → 列表 → 保存 → 播放 | 代码闭环，真实 COS 未验证 | 见 P1 外部 |
| 后台看板 | 闭环 | 4 类事件、14 天、Top 5；无事件有空状态 |
| 云端备份/换机回填 | 闭环 | 空本地也会拉取；墓碑防撤销复活 |
| 落地页 / H5 演示 | 闭环 | 同源 API；H5 广告是模拟 |

**明确未做**：分享海报、双人打卡、iOS 订阅、睡眠监测/评分、多音轨混音、COS 对象删除。

---

## 4. UX / 视觉问题

已修复：H5 无样式、时间输入截断、后台空图表、登录页闪烁、白天错误周期、缓存标记、暂停计时。

仍建议：

1. 小程序原生时间选择器是浅色，深色页面里会闪一下，属于平台能力限制；可用自定义 picker 替代，但会增加代码量。
2. 后台“保存并生效”是 sticky 条，滚动到底部时会覆盖一点内容；目前 padding 足够，真机浏览器需再看。
3. 首页白天改成“今晚推荐”后，夜里 0 点附近文案会在“今晚/明晚”之间切换，建议真机在 23:50、00:10、08:59 各看一次。
4. 音频列表只有 1 条时分类栏只有一个“全部/环境音”，视觉略空；补到 4 条后正常。
5. H5 演示的广告是 5 秒倒计时，和微信激励视频的关闭按钮位置不同，仅用于看流程。

---

## 5. 验证证据

- `npm test`：65 passed / 0 failed
- `npm run check`：3 页面 / 9 JSON / 6 WXML / 7 WXSS / 主包约 110KB
- PostgreSQL 16：事件写入与 14 天聚合、配置持久化、COS 配置加密（密文 69 字符、不含明文）
- 浏览器：落地页、H5 三 Tab、后台登录/保存/删除/试听/存储面板/趋势图；无未捕获 JS 错误
- 生产保护：缺微信密钥、开 dev 登录、内存库、缺 ADMIN_PASSWORD 均启动失败
- 未验证：真机、真实 COS 上传、激励视频、锁屏续播；2026-10 改版后的 WXML 视觉也尚未在微信开发者工具中渲染（本机 DevTools 登录账号不是该 AppID 的开发者，无法自动打开）。

---

## 6. 修复优先级

1. **P0**：COS 防盗链放行 → 真机播放。
2. **P1**：后台填 COS 子账号 → 真实上传 → 播放；真机过验收清单。
3. **P2**：会话失效、COS 对象清理、监控告警、事件开关。
4. **P3**：音频重压、更多分类与音频、分享增长。

