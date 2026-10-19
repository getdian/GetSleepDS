# 睡点 · 上线清单

> 按顺序勾选。每一步都标了"卡在哪"，避免到提审才发现缺材料。

## 1. 主体与账号

- [ ] 深圳市牧码人网络科技有限公司完成微信开放平台 / 公众平台认证（企业）。
- [ ] 注册小程序，拿到 AppID / AppSecret（AppSecret 只放服务端环境变量）。
- [ ] 当前已配置 AppID `wx378b0a7437d60998`；AppSecret 不要发在聊天里、不要提交，直接写进服务器 `.env`。
- [ ] 在 `.env` 设置 `ADMIN_PASSWORD`（后台 `/admin` 登录用）；不设置会每次启动生成临时密码并打印在日志里。
- [ ] 小程序名称「睡点」查重；简介不出现"助眠、改善睡眠、治疗、健康"。
- [ ] 管理员、开发者、体验成员配置完成。

## 2. 类目与资质

- [ ] 首选类目：`工具 > 效率`；备选：`工具 > 信息查询`。
- [ ] **不要选** `医疗健康` 下任何子类目（会触发资质要求，且与产品定位不符）。
- [ ] 若审核要求补 `文娱 > 音频`：准备音频版权说明（CC0/自制），并按 4.3 调整页面（去掉"音乐库"式表达）。
- [ ] 提交审核备注（可直接用）：

> 本小程序为作息时间计算与记录工具，提供基于 90 分钟周期的入睡时间倒推、打卡记录与环境音播放，不涉及任何医疗健康诊断、评估或建议。环境音为 CC0 授权素材，仅用于睡前放松。

## 3. 域名、服务器、存储

- [ ] 一台 2核4G/3M 轻量服务器，已装 Docker + Compose。
- [ ] API 域名 `sleep.qfmaster.com` 已解析到 `101.43.51.127`，完成 ICP 备案 + HTTPS（443）。
- [ ] 公众平台 → 开发管理 → 服务器域名，添加：
  - `request 合法域名`：`https://sleep.qfmaster.com`
  - `downloadFile 合法域名`：`https://img.qfmaster.com`（音频走这个）
- [ ] 当前音频桶 `qfmaster-1322402212`（ap-shanghai）可公开读取（支持 Range）。若开启防盗链，**必须放行 `servicewechat.com` 与 `https://sleep.qfmaster.com`**，H5 演示还要放行站点域名；否则小程序与演示页都会 403。
- [ ] 音频规格：建议 2–6 分钟无缝 loop、MP3 96–128kbps 单声道、单条 ≤ 3MB。当前 `sleep/sleep-10001.mp3` 为 48kHz/256kbps、5.7MB（约 3 分钟），首播偏慢，建议重压后再传一版。
- [ ] 后台“存储与上传”填 Bucket / Region / SecretId / SecretKey（建议子账号，仅该桶 PutObject），上传后点“测试连接”和“试听”。
- [ ] 验证：真机 `wx.getBackgroundAudioManager()` 播放 COS 地址，锁屏 10 分钟不断；弱网下首播等待可接受。
- [ ] 验证：看广告时音频同时下载，广告结束后可离线续播；缓存标记出现。

> 注意：`*.myqcloud.com` 默认域名能否直接加入 `downloadFile` 白名单以公众平台实测为准。若校验不通过，绑自定义备案域名 + CDN，再在后台 `/admin` 改音频 URL。

## 4. 广告

- [ ] 累计独立访客达到平台门槛（现行约 1000 UV，以公众平台为准）后开通流量主。
- [ ] 创建激励视频广告位，把 ID 填到后台 `/admin` → 广告与解锁 → 广告位 ID（或环境变量 `AD_UNIT_ID`，后台配置优先）。
- [ ] 未开通前保持为空：客户端会直接解锁，不影响体验。
- [ ] 广告位审核通过后，真机验证：未看完不解锁、看完写 24h、杀进程重进仍解锁。
- [ ] 页面展示位逐个开启后，在后台「概览 → 广告位观测」确认 `ad_show` 有数、`ad_error` 可定位；填充率异常时先检查广告位 ID 与流量主状态。
- [ ] 记录广告位加载失败率；若过高，把 `unlock.onAdError` 改为 `deny` 并加提示。

## 5. 隐私与合规

- [ ] 公众平台《用户隐私保护指引》声明：收集 openid（用于云端备份、解锁校验与匿名事件统计），不收集手机号、位置、通讯录、相册。
- [ ] 代码确认无 `getUserProfile`、`getPhoneNumber`、`getLocation`、`chooseImage`。
- [ ] 本地存储只存时间戳、时长与音频缓存索引，不存设备信息。
- [ ] 事件上报只含 openid、事件类型、音频 id、时间戳；不含睡眠明细。若不需要看板，可在客户端去掉 `utils/events.js` 调用。
- [ ] 日志脱敏：不打印 code、openid 明文、请求体、COS SecretKey。
- [ ] COS SecretKey 只通过后台填写，服务端 AES-256-GCM 加密入库；`CONFIG_SECRET` 固定后不要随意更换。
- [ ] 回顾文案人工过一遍禁词表（`docs/00-prd-revised.md` 4.3）。
- [ ] 不接大模型 → 无需 AIGC 相关备案材料；若后续接入，需重新评估类目与备案。

## 6. 支付 / 订阅

- [ ] 本期**不做**小程序内订阅或会员支付。
- [ ] 若未来要收费：iOS 端小程序虚拟支付受限，方案是"小程序获客 → App 内订阅（走 Apple 内购）"，不要在小程序里引导跳转外部支付（违规）。

## 7. 部署

```bash
cp .env.example .env      # 填 POSTGRES_PASSWORD / WX_APPID / WX_SECRET / ADMIN_PASSWORD / CONFIG_SECRET / TRUST_PROXY=1
docker compose up -d --build
curl https://sleep.qfmaster.com/api/ready
```

- [ ] `NODE_ENV=production`，`ALLOW_DEV_LOGIN` 必须为空（服务端会在生产环境强制校验）。
- [ ] 固定 `ADMIN_PASSWORD` 与 `CONFIG_SECRET`；生产环境缺 `ADMIN_PASSWORD` 会直接启动失败。
- [ ] `/api/ready` 返回 200；数据库挂掉时它应返回 503。
- [ ] 数据库初始化：compose 会自动执行 `server/sql/001_init.sql`。
- [ ] 1Panel 反向代理 `sleep.qfmaster.com` → `http://127.0.0.1:3000`，证书 + 强制 HTTPS；`TRUST_PROXY=1`；上传需要 30MB 请求体上限。
- [ ] 只放行 80/443，不对公网暴露 3000。
- [ ] 生产环境后台 Cookie 带 `Secure`，**必须 HTTPS 访问 `/admin`**。
- [ ] 登录 `/admin`，确认概览数字、音频试听、保存后 `/api/config` 立即变化。
- [ ] 日志落盘 + 轮转；JSON 日志含 requestId，确认无敏感字段。
- [ ] 备份：`sh deploy/backup.sh` 加到 cron，并把 `backups/` 同步到 COS。

## 8. 提审与发布

- [ ] 真机走一遍 `docs/00-prd-revised.md` 第 8 节全部验收项。
- [ ] 准备 3–5 张截图（深色、无广告弹窗、无空数据）。
- [ ] 提审 → 体验版 → 全量发布。
- [ ] 发布后 24 小时看：打开率、打卡完成率、音频点击→解锁转化、广告错误率。

## 9. 上线后再做（P6）

- [ ] 分享卡片（周报长图）与双人打卡 —— 解决"没有传播点"的问题。
- [ ] 更细的漏斗事件（解锁开始/失败、播放完成率）。
- [ ] 电商 CPS 选品位（睡眠周边），放在回顾页底部，不打断主流程。
- [ ] 后台多管理员、操作审计、COS 对象清理。
