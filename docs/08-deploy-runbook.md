# 睡点 · 部署与运维 Runbook（L4 交付包）

- 适用：单机 Docker Compose，2核4G/3M 起步
- 入口：`/` 落地页、`/demo/` H5、`/admin/` 后台、`/api/*`

## 1. 包内容

```
miniprogram/            小程序源码（微信开发者工具导入仓库根目录）
server/                 API、后台页面、H5/落地页、测试
deploy/Caddyfile        HTTPS 反向代理配置（可选 profile）
deploy/backup.sh        每日 pg_dump
docker-compose.yml      db + api（+ 可选 caddy）
.env.example            环境变量模板
docs/                   需求、架构、上线、后台、H5、审查、本 runbook
tools/                  资源生成与静态检查
tests/ server/test/     单测
```

不含 `node_modules`、`.env`、`.git`、`dist/`。

## 2. 首次部署（1Panel，推荐）

目标拓扑：

```
微信小程序 / H5
   │  https://sleep.qfmaster.com
   ▼
1Panel OpenResty（443，证书由 1Panel 申请）
   │  http://127.0.0.1:3000
   ▼
docker compose: api:3000 ── db:5432（命名 volume）
   │
   └── 音频：https://img.qfmaster.com/sleep/*.mp3（既有 COS 桶）
```

### 2.1 上传与解压

1. 1Panel → 文件 → 进入 `/opt`（或你习惯的目录），新建 `getsleep`。
2. 把发布 zip 上传到该目录，右键“解压”到当前目录。
3. 确认目录里有 `docker-compose.yml`、`server/`、`.env.example`。

等价命令：

```bash
mkdir -p /opt/getsleep
cd /opt/getsleep
unzip getsleep-mvp-YYYYMMDD.zip
```

### 2.2 创建 `.env`

在 1Panel 文件编辑器里复制 `.env.example` 为 `.env`，至少填：

| 变量 | 值 |
|---|---|
| `POSTGRES_PASSWORD` | 随机强密码，只用字母数字 |
| `WX_APPID` | `wx378b0a7437d60998` |
| `WX_SECRET` | 小程序 AppSecret |
| `ADMIN_PASSWORD` | 后台强密码（生产不设会启动失败） |
| `CONFIG_SECRET` | 固定随机串，用来加密 COS SecretKey；设置后不要改 |
| `TRUST_PROXY` | `1`（1Panel 反代后必须设，否则限流共用代理 IP） |

不需要 `DOMAIN`（1Panel 管证书）；不要把 `.env` 提交或发给别人。

### 2.3 启动

```bash
cd /opt/getsleep
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3000/api/ready
```

`/api/ready` 返回 `{"ok":true,"db":"ok"}` 才算就绪。首次构建 2–5 分钟属正常。

### 2.4 1Panel 反向代理 + HTTPS

1. 1Panel → 网站 → 创建网站 → 选择“反向代理”。
2. 域名填 `sleep.qfmaster.com`；代理地址填 `http://127.0.0.1:3000`。
3. 保存后到“HTTPS”申请 Let's Encrypt 证书，开启“强制 HTTPS”。
4. 在网站“配置文件”里给对应 `server {}` 加 `client_max_body_size 30m;`，否则后台上传 25MB 音频会被 413；保存并重载 OpenResty。
5. 打开 `https://sleep.qfmaster.com/api/ready` 验证；再打开 `/admin` 登录。

> 如果 1Panel 的 OpenResty 跑在 Docker 里而 `127.0.0.1:3000` 不通，不要把 3000 直接对公网开放；应让 1Panel 与 compose 使用同一 Docker 网络，或只在内网/安全组放行 3000 后临时改端口绑定。最省事的方案仍是 1Panel OpenResty 跑在宿主机，反代 `127.0.0.1:3000`。
>
> 不要在对公网放行 3000；只放行 80/443，3000 仅供本机反代。
>
> 生产后台 Cookie 带 `Secure`，必须走 HTTPS，否则 `/admin` 登录不上。

### 2.5 备用：compose 自带 Caddy

只有服务器没有 1Panel/Nginx 时才用：

```bash
# .env 里 DOMAIN=sleep.qfmaster.com，DNS 已解析，80/443 放行
docker compose --profile https up -d
```

Caddy 会自动申请证书并反代 `api:3000`。与 1Panel 同时跑会争 80/443，不要同时启用。

## 3. 配置

1. 打开 `https://sleep.qfmaster.com/admin`，用 `ADMIN_PASSWORD` 登录。
2. 存储与上传：Bucket `qfmaster-1322402212`、Region `ap-shanghai`、访问域名 `https://img.qfmaster.com`、路径 `sleep`，填 SecretId/SecretKey（子账号，仅该桶 PutObject），保存 → 测试连接。
3. 环境音：首条雨声保持 `https://img.qfmaster.com/sleep/sleep-10001.mp3`；改名称/分类/图标/顺序后“保存并生效”。
4. 广告与解锁：流量主开通后填广告位 ID；没有就留空（直接解锁）。
5. 功能与缓存：按需开关；缓存上限/有效期别设太小。
6. 用户数据：客服/合规需要时按 openid 查询、删除云端数据；删除会写全量清除水位，用户下次同步时本机旧睡眠记录也会被清除（后台确认文案已明确）。无睡眠记录但有解锁/事件数据的用户也可删除。
7. **COS 防盗链**：放行 `servicewechat.com` 与 `https://sleep.qfmaster.com`，否则真机/H5 会 403；若暂时不开防盗链可先匿名读。

小程序侧：

- 公众平台 → 开发管理 → 服务器域名：`request` 合法域名填 `https://sleep.qfmaster.com`；`downloadFile` 合法域名填 `https://img.qfmaster.com`（已添加则跳过）。
- `miniprogram/config/env.js` 已按 `envVersion` 自动切：开发版 `127.0.0.1:3100`，体验/正式版 `https://sleep.qfmaster.com`，**不用手改**。
- 微信开发者工具重新编译上传。

## 4. 日常检查

```bash
docker compose ps
curl -fsS https://sleep.qfmaster.com/api/ready
docker compose logs -f --tail=200 api
```

日志是 JSON，含 `requestId/method/path/status/ms`，可带 `X-Request-Id` 复现单次请求。

## 5. 备份与恢复

```bash
sh deploy/backup.sh
# 恢复
gunzip -c backups/sleep-YYYYmmdd-HHMMSS.sql.gz | docker compose exec -T db psql -U sleep -d sleep
```

建议 cron：

```cron
0 4 * * * cd /srv/getsleep && sh deploy/backup.sh >> backups/backup.log 2>&1
```

把 `backups/` 同步到 COS 或另一台机器；只留本机不算备份。

## 6. 升级与回滚

升级：

```bash
git pull            # 或解压新包覆盖（保留 .env、backups/）
docker compose up -d --build
curl -fsS https://sleep.qfmaster.com/api/ready
```

回滚：

```bash
docker compose down
# 切回上一版代码目录或镜像 tag
docker compose up -d
```

数据库变更目前是 `CREATE TABLE IF NOT EXISTS`（新增 `sleep_record_deletions`、`user_erasures`），不破坏已有表；启动时 `db.init()` 会自动补建，升级前仍建议先跑 `deploy/backup.sh`。若后续加字段，先备份再执行 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`。

## 7. 上线前必须确认

- [ ] `/api/ready` 200
- [ ] `/admin` 能登录，保存配置后 `/api/config` 立即变化
- [ ] COS 测试连接成功，上传一条后能试听
- [ ] COS 防盗链放行 `servicewechat.com`
- [ ] 体验版/正式版自动命中 `https://sleep.qfmaster.com`（`env.js` 无需手改）
- [ ] 真机：播放 → 锁屏 10 分钟 → 定时关闭
- [ ] 真机：未看完广告不解锁；看完写 24h
- [ ] 备份 cron 生效
- [ ] 已设置 `ADMIN_PASSWORD、CONFIG_SECRET、WX_SECRET`，且不在仓库里

## 8. 已知限制

- 单实例：限流、配置缓存、事件队列都在进程内。
- 上传走 API 中转，3M 带宽下 5MB 约十几秒。
- 后台退出只清 Cookie，已签发 token 7 天内有效；需要强制下线就改 `ADMIN_SECRET` 重启。
- 删除音频不会删 COS 对象。
- 定时关闭在锁屏后可能漂移（小程序 JS 被挂起）。
