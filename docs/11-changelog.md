# 睡点 · 关键更新记录

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
