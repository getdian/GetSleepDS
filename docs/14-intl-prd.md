# 国际站 PRD（Web / SEO / 订阅优先）

> 版本：v0.1 · 2026-10-23 · 状态：阶段 0 已验真，进入阶段 1
> 上游：`docs/00-prd-revised.md`（小程序）、`AGENTS.md`（事实优先级与红线）

## 1. 背景与结论

小程序是当前唯一在线形态，变现依赖微信流量主。要做成可持续的生意，需要一条不受单一平台政策影响的收入线。

- **不做**「把小程序翻译成 H5 再挂 AdSense」：激励视频在 Web 无对应机制，`AdSense` 也不允许诱导点击。
- **做**「SEO 工具站获客 + 订阅变现 + 广告兜底」：用免费的睡眠计算器吃自然流量，用跨设备同步/提醒/报告收费。
- 参考案例 ssstik.io（免费工具 + 广告 + 多语言 SEO）可借鉴其**结构与获客**，但其"高频重复 + 平台缝隙"两个前提在本品类不成立，故**不能照搬其变现公式**。

## 2. 目标与非目标

**目标（12 个月）**
1. 自然搜索月访问 10 万 PV（英语区为主，西语区验证流量）。
2. 付费转化 ≥ 1.5%（免费用户注册率 ≥ 8%）。
3. 月经常性收入（MRR）≥ $5,000。

**非目标（第一年）**
- 不做原生 App（Web 验证后再封装）。
- 不做音频播放（版权/带宽/成本，且 AdSense 无 rewarded）。
- 不做社交、社区、UGC。
- 不做多端 UI 对齐（Web 只做「算 + 存 + 分享」）。

## 3. 商业模式（按优先级）

| 层 | 内容 | 定价 | 说明 |
|---|---|---|---|
| 主 | Plus 订阅 | $4.99/月 或 $29/年 | 跨设备同步、自定义提醒、多段分析、导出、去广告 |
| 主 | Lifetime 买断 | $59 一次性 | 降低决策门槛，现金流前置 |
| 辅 | Affiliate | 佣金 | 床垫/枕头/遮光帘/白噪音硬件，仅内容位，不做弹窗 |
| 兜底 | 展示广告 | RPM | 结果页底部单槽，需先接 CMP；**不作为收入目标** |

约束：**不接插页/重定向广告**。睡眠场景 + 健康类内容（YMYL）风险高，且会毁掉订阅转化。

## 4. 目标市场与切口

- 英语区（US/CA/AU/UK）验证付费；西语区（ES/MX/CO）验证流量成本。
- 切口（避开 sleepcalculator.com 等老站的正面竞争）：
  1. **轮班/夜班**（night shift）——现有站点都是朝九晚五视角。
  2. **时差/跨时区**（jet lag）——与本项目已有的时区能力天然契合。
  3. **多段睡眠**（分段/补觉）——小程序已有 `sessions` 多段模型。

## 5. 产品范围（MVP）

**必须**
- 双向计算：给定起床时间推入睡；给定入睡时间推起床（5/4/3 周期 + 6 周期补觉档）。
- 入睡耗时可选（0/10/15/20/30 分钟）。
- 本地保存（localStorage），按用户时区归档。
- 分享（Web Share API / 复制链接）。
- 多语言（en / es）、每语言独立 URL 前缀。
- SEO：SSG 静态页、canonical、hreflang、JSON-LD（FAQPage + WebApplication）、sitemap、robots。
- 合规：免责声明（非医疗建议）、隐私政策、Cookie 说明（为后续 CMP 预留）。

**第二阶段**
- 账号（匿名 device → magic link）、跨端同步（复用 `/api/records/sync`，换 subject）。
- 订阅（Paddle，代缴 VAT）、免费额度与付费墙。
- 展示广告（AdSense + Google 认证 CMP）。

## 6. 信息架构与 URL

```
/                          en 首页（sleep calculator）
/what-time-should-i-go-to-bed
/what-time-should-i-wake-up
/90-minute-sleep-cycle
/7-hours-of-sleep
/night-shift-sleep-calculator
/jet-lag-sleep-calculator
/nap-calculator
/es/                       西语首页
/es/a-que-hora-debo-dormir
/es/calculadora-turno-nocturno
/privacy  /terms  /about
```

## 7. 数据模型（时区）

已拍板：**记录级时区，默认 +480，主键不变**。

- 记录新增 `tzOffsetMin`（分钟，东为正；UTC-8 = -480）。
- `day` 由**记录自身**时区推导：`dayKeyOf(wakeAt, tzOffsetMin)`。
- 旧数据缺省 480，行为与今天完全一致，无需回填。
- 服务端 `sleep_records` 增列 `tz_offset_min SMALLINT NOT NULL DEFAULT 480`（加法迁移）。
- 同一夜在两个时区设备上产生两个 day 的概率，由「记录自身时区」消除。

## 8. 接口

| 接口 | 现状 | 国际站用途 |
|---|---|---|
| `GET /api/config` | 可用，`no-store` | 读站点文案/开关；改为 `max-age=30`，加 CORS |
| `POST /api/records/sync` | **依赖 `wx.login` code** | 阶段 2 换 subject 后可用 |
| `POST /api/events` | 依赖 code | 阶段 2 |
| `GET /api/summary` | 可用 | 阶段 2 历史统计 |

## 9. 配置与后台

新增配置段 `web`（后台可视化，无需重启）：

```json
{
  "web": {
    "enabled": true,
    "brand": "SleepCycle",
    "tagline": "Find your best bedtime",
    "ctaUrl": "",
    "adsenseClient": "",
    "analyticsId": "",
    "locales": ["en", "es"],
    "disclaimer": "Not medical advice."
  }
}
```

下发路径：`app_config` JSONB → `GET /api/config` → 构建时快照进静态页（构建期读取）+ 运行时兜底。

## 10. 指标与止损线

| 指标 | 阶段 1 目标（4 周） |
|---|---|
| GSC 收录率 | ≥ 60% |
| 非品牌词 impression | ≥ 1 |
| 自然 UV | ≥ 100 |
| LCP（移动 4G） | < 2.0s |
| CLS | < 0.1 |

**止损**：4 周内非品牌词点击为 0 且 UV < 100 → 停止投入，把 core 复用到小程序付费能力。

## 11. 里程碑

| 阶段 | 内容 | 产出 |
|---|---|---|
| 0 | 可行性取证（已完成） | 本文件 §7 决策 |
| 1 | core 复用 + 静态站 + 10 页 + 度量 | `web/dist` 可部署 |
| 2 | 账号 + 同步 | 跨设备可用 |
| 3 | 订阅 + 付费墙 | 首笔收入 |
| 4 | 广告 + affiliate | 兜底收入 |

## 12. 风险

1. **YMYL**：健康类站点需要署名、引用、免责声明齐备，否则难以稳定排名。
2. **SEO 滞后**：3–6 个月才见效果，不能作为短期现金流。
3. **薄内容**：程序化生成的页面若无独特内容会被判 thin content，甚至影响 AdSense 审核。
4. **双端漂移**：Web 若复制一份算法，必然分叉（`server/public/site/demo.js` 已经复制过一份 `sleepDayOf`）。**唯一允许的做法是构建时引用 `miniprogram/utils` 的纯函数**。
5. **主体与税务**：海外收款需要独立主体/ Paddle 代缴，不能用小程序主体收入混算。

## 13. 验收（阶段 1）

- [ ] `npm test` 全绿，含跨时区用例。
- [ ] `node tools/build-web.mjs` 产出 ≥ 10 个页面，每页有 title/description/h1/canonical/hreflang/JSON-LD。
- [ ] 构建产物无外链依赖（可离线打开），Lighthouse 移动 ≥ 90。
- [ ] `GET /api/config` 带 CORS 与缓存头，跨域可读。
- [ ] 后台可编辑 `web` 段并保存成功。
