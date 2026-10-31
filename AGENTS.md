# Agent 入口（跨工具约定）

任何 AI 编码工具（CodeBuddy / Codex / Claude Code / Cursor / Copilot / Aider / 其他）在本仓库开启新会话，
先按下面顺序读，建立**可核验**的事实基线再动手。本文件只做入口与纪律，不复制事实（避免与源码漂移）。

## 0. 阅读顺序（不要跳）

1. `context.md` —— 当前事实速查：项目在做什么、验证基线、风险清单、历史决策索引。
2. `DECISIONS.md` —— ADR 清单（编号即约定，**只增不改**）。
3. `docs/13-acceptance-checklist.md` —— 哪些验过、哪些没验（第 1 区机验 / 第 2 区待真机 / 第 3 区待外部输入）。
4. `docs/10-operations.md` §3.0 —— **线上生产现场**：目录、端口、Compose 项目名、三条红线。
5. 要改哪个模块，再读对应源码与测试；`docs/11-changelog.md` 有 130KB，只在追溯某次改动时按标题检索，不要通读。

## 1. 事实优先级（冲突时按此裁决）

**运行现场实测 > 代码 > `context.md` / `DECISIONS.md` / `docs/` > 模型记忆与推测。**

文档与现场不一致时：先按现场继续，同时**回写文档**，不要留一份会误导下一个人的说明。

## 2. 门禁（提交前必须跑，数字如实转述）

```bash
npm test          # 2026-10-31 基线：547 项 / 545 通过 / 0 失败 / 2 skip（PG 用例无 PG_TEST_URL 时 skip）
npm run check     # 3 页面 / 22 JSON / 17 WXML / 19 WXSS，主包约 760.8 KB
```

- 数字会随改动变化：**以本次输出为准**，不要照抄历史数字宣称通过。
- 没跑就说没跑；skip 要说明原因。

## 3. 六条防误导纪律

1. **第一轮只做取证汇报**：读完代码再下结论，不要先给方案再补证据。
2. **「线上/已部署」必须取现场证据**：`pwd`、`grep HOST_PORT .env`、`docker compose ps`、`docker compose config --services`。
   禁止用仓库模板默认值（如 3000）或记忆中的路径（如 `/srv/...`）代替现场。
3. **报告不是事实**：外部评审、子代理、历史注释的每条结论都要能给出 `文件:行号` 才采纳；对不上就标「未复现」。
4. **门禁断言「结构与位置」，不断言「关键字存在」**：`grep` 只能证明字符串在，不能证明接线正确（例如按钮存在但没绑定事件）。
5. **部署只做最小动作**：只重建 api、不覆盖 `docker-compose.yml` / `.env`、不整包解压到根目录。
6. **交付要能复现**：每条结论附命令与期望输出；视觉类结论必须写明「未机验」或给出截图路径。
   截图证据命名 `docs/assets/l4-*.png` 并入库；`review-*` / `test-*` 是临时探针图（已 gitignore），不能当证据引用。模拟器取证命令见 `context.md` §8。

## 4. 生产红线（违反会伤线上，详见 `docs/10-operations.md` §3.0）

- 生产目录 `/opt/1panel/www/sites/sleepDS/index`，`HOST_PORT=3004`，反代 `https://sleep.qfmaster.com`。
- 该机三个站点目录末级都叫 `index` → Compose 项目名同为 `index`：
  **禁止 `docker compose down`、禁止 `--remove-orphans`、禁止改 `name:`**（改项目名会换命名卷 = 连空库）。
- 迭代部署：`docker compose up -d --build --no-deps api`；出现 orphan 警告属正常，不要清理。
- 数据库只做加法迁移（`CREATE/ALTER ... IF NOT EXISTS`）；改列类型、删列必须先备份并单独评审。
- 归档日固定北京时间（`calendarDayKey`）；`dateKey` 只用于 UI 文案。
- 云备份默认关闭；`syncEnabled=false` 时不允许发出同步请求。
- 新增配置项必须五处同改：`server/src/lib/config-schema.js`、`server/config/app.config.json`、
  `miniprogram/config/fallback.js`、后台 `server/public/admin/admin.js`、文档。

## 5. 音频播放铁律（不可回退，细节与证据见 `docs/12` §10）

1. **会话只有一个写入口**：`lastTrackActive=false` 只允许 `miniprogram/utils/audio-session.js` 的 `markStopped()` 写（用户停止 / 定时到点 / 权益到期 / 清除数据）。外部中断、系统 `stop`、播放错误、`src` 被清空一律只改 `lastTrackPlaying`。
2. **可见性**：迷你条/音符 = 会话存活 **或** 仍在出声；只有业务终止才隐藏。冷启动残影（无 `src` + 本进程未起播 + 未出声）才允许清会话。
3. **中断恢复**：必须注册 `wx.onAudioInterruptionBegin/End` + `App.onHide/onShow` 补偿；只有“小程序内主动暂停/停止”能阻止自动恢复；续播要处理 `src` 被清空（按 `lastTrackId` 重建）与曲末 `seek(0)`。
4. **循环与切歌**：不得只依赖 `onTimeUpdate`（官方口径：仅小程序在前台才回调）；`player-state.armLoop` 定时器兜底曲末动作——**单曲循环**在 tail 1.2s 处 `seek(0)`，**列表循环**在 0.8s 处换下一首（必须早于 `ended`，否则重设 `src` 会丢微信浮窗）；`claimLoop`/`claimEnded` 保证同一轮只有一个组件处理。自动切歌走 `play(next, { auto: true })`，不得重置 10 秒 8 次的重播预算；播放模式切换后必须立即 `player.refreshTail()` 重排定时器。
5. **用户操作**：UI 停止必须 3 秒内二次点按确认；暂停/停止要清回环定时器；用户暂停后迟到的 `play` 不得抹掉暂停意图（800ms 宽限）。
6. **错误与坏源**：仍在出声时不得清会话、不得删缓存；坏源黑名单只在 `audio-cache`（`markBad/isBad/clearBad`），`peek` 跳过、重下成功解禁；自动重播 10 秒内最多 8 次。
7. **可观测**：中断上报 `audio_interrupt`（`begin|trackId` / `end|<秒>s|resume|skip`）；新增事件类型必须同步 `server/src/routes/events.js` 白名单与 `analytics`。
8. **回归门禁**：任何音频改动必须跑 `tests/audio-session|audio-cache|audio-timer|player-state` + `server/test/api|analytics`，并在模拟器复核四条：外部暂停→迷你条保留→回前台续播；应用内暂停→不续播；应用内停止→迷你条消失且不复活。

违反任一条 = 回退已验收的真机行为（历史故障：中断后不恢复、音乐还在响但迷你条消失、入睡页误显暂停、锁屏只播一轮）。**未真机验证前不得宣称音频行为已验收。**

## 6. 改动入口地图

| 需求 | 先看 |
|---|---|
| 计算算法 / 文案 | `miniprogram/utils/plan.js`、`pages/index/*`、`tests/plan.test.js` |
| 记录 / 归档 / 多段 | `utils/sessions.js`、`utils/storage.js`、`utils/sync.js`、`server/src/db/index.js`、`server/sql/001_init.sql` |
| 统计口径 | `utils/stats.js`、`pages/stats/*`、`utils/manual-sleep.js` |
| 音频 / 广告 / 解锁 | **先读 §5 铁律**；`components/audio-dock/*`、`components/now-playing/*`、`utils/audio-session.js`、`utils/player-state.js`、`utils/ad.js`、`server/src/routes/audio.js` |
| 运营后台 | `server/public/admin/admin.js`（`PANEL_META` / `collect` / `render` / `validatePayload`） |
| 部署 / 备份还原 | `docs/10-operations.md` §3.0 与 §3.8、`deploy/update.sh`、`deploy/1panel-up.sh`、`deploy/backup.sh` |
| 国际站（Web/SEO） | `docs/14-intl-prd.md`、`web/content/*`、`tools/build-web.mjs`、`web/assets/*` |

## 7. 各工具的文件名（都只指向本文件）

| 工具 | 读取的文件 |
|---|---|
| Codex / Gemini CLI / 多数新工具 | `AGENTS.md`（本文件） |
| Claude Code | `CLAUDE.md`（薄壳） |
| VS Code Copilot | `.github/copilot-instructions.md`（指针） |
| Cursor | `.cursor/rules/agents.mdc`（指针，`alwaysApply`） |

**规则只维护本文件**；其余文件只做指针，不复制内容，改这里不需要同步它们。
