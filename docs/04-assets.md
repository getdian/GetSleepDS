# 睡点 · 素材清单与版权留证

- 更新：2026-10-19
- 用途：上线前自查，也给审核/维权留证据

## 1. 音频

| id | 文件 | 时长 | 格式 | 大小 | 授权 | 状态 |
|---|---|---|---|---|---|---|
| `sleep-10001` | `sleep/sleep-10001.mp3` | 约 2:59 | MP3 48kHz / 256kbps | 5,712,384 B（5.7MB） | **待补**（目标 CC0 或自制） | 已在 COS，可用 |

- 地址：`https://img.qfmaster.com/sleep/sleep-10001.mp3`（同桶 `qfmaster-1322402212` / `ap-shanghai`）
- 实测（2026-10-19）：`HEAD 200`，`Content-Type: audio/mpeg`，`Content-Length: 5712384`；带 `Referer: https://servicewechat.com/...` 与 `https://sleep.qfmaster.com/` 均 200，当前未开启防盗链。若后续开启，需放行 `servicewechat.com` 与 `https://sleep.qfmaster.com`。
- 现在可以直接在后台 `/admin` → 存储与上传 → 上传音频，不必手动进 COS 控制台；上传后自动追加到音频列表。
- 标题已定“雨声”、分类“自然之声”：在后台 `/admin` 改名称与图标（写数据库；两处配置文件仅作兜底）。
- 优化建议：256kbps 对睡眠环境音明显偏高。重压到 96–128kbps 单声道，文件可降到 2MB 左右，首播更快、流量更省；loop 接缝用 0.5–1s 淡入淡出处理。

## 2. 音频合规要求

- 只使用 **CC0 / Public Domain / 自己录制** 的素材；不要用“免费下载”但授权不明的音频。
- 每条音频保留：
  1. 原始素材页面链接与授权声明截图；
  2. 下载文件与剪辑后文件的 SHA-256；
  3. 剪映/剪辑工程截图（证明做过淡入淡出与裁剪）；
  4. 上传 COS 的时间与对象 Key。
- 审核若要求“音频版权说明”，直接用上表 + 上述材料。

## 3. 图标

| 文件 | 规格 | 来源 |
|---|---|---|
| `assets/tab-home(-active).png` | 81×81 PNG | `tools/gen_assets.py` 生成 |
| `assets/tab-stats(-active).png` | 81×81 PNG | 同上 |
| `assets/tab-audio(-active).png` | 81×81 PNG | 同上 |
| `assets/icon-rain/wave/fire/noise/night.png` | 96×96 PNG | 同上 |

- 图标为几何图形程序生成，不涉及第三方版权。
- 改图标只需改脚本后重跑：`python tools/gen_assets.py`（需要 Pillow）。

## 4. 配置位置

| 项 | 位置 |
|---|---|
| 音频列表、标题、分类、图标、URL | 后台 `/admin`（写 `app_config` 表）；`server/config/app.config.json` 与 `miniprogram/config/fallback.js` 仅作种子/兜底 |
| COS 凭证与上传 | 后台 `/admin` → 存储与上传（SecretKey 加密入库） |
| 广告位与解锁策略 | 后台 `/admin` → 广告与解锁 |
| API 域名 | `miniprogram/config/env.js` |
| 上传白名单 | 微信公众平台 → 开发管理 → 服务器域名 |

## 5. 待补

- [ ] `sleep-10001` 的内容确认与标题
- [ ] CC0 授权链接/截图、原始文件哈希
- [ ] 重压后的 96–128kbps 版本（可选）
- [ ] 第 2–6 条音频（雨声/海浪/篝火/白噪音/夜虫），在后台直接上传
- [ ] COS 防盗链放行 `servicewechat.com` 与 H5 域名
