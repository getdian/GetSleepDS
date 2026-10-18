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

## 2. 首次部署

```bash
unzip getsleep-mvp-20261019.zip -d /srv/getsleep
cd /srv/getsleep
cp .env.example .env
```

`.env` 必填：

| 变量 | 说明 |
|---|---|
| `POSTGRES_PASSWORD` | 只用字母数字，避免破坏 DATABASE_URL |
| `WX_APPID` | `wxaa4e654a147d030d` |
| `WX_SECRET` | 小程序 AppSecret，只放这里 |
| `ADMIN_PASSWORD` | 后台密码；生产不设会启动失败 |
| `CONFIG_SECRET` | COS 凭证加密密钥，固定后不要换 |
| `DOMAIN` | 用 Caddy 时填已备案域名 |

启动：

```bash
docker compose up -d --build
curl http://127.0.0.1:3000/api/ready
```

`/api/ready` 返回 `{"ok":true,"db":"ok"}` 才算就绪。

### HTTPS（二选一）

**A. 使用 Caddy（推荐）**

```bash
# .env 里 DOMAIN=api.example.com，DNS 已解析到本机，80/443 放行
docker compose --profile https up -d
```

Caddy 自动申请证书并反代 `api:3000`。

**B. 已有 Nginx**

- 反代到 `127.0.0.1:3000`
- `client_max_body_size 30m`
- 设置 `X-Forwarded-For`，并在 `.env` 设 `TRUST_PROXY=1`

> 生产后台 Cookie 带 `Secure`，必须走 HTTPS，否则 `/admin` 登录不上。

## 3. 配置

1. 打开 `https://你的域名/admin`，用 `ADMIN_PASSWORD` 登录。
2. 存储与上传：填 Bucket、Region、SecretId、SecretKey（子账号，仅该桶 PutObject），保存 → 测试连接 → 上传音频。
3. 环境音：改名称、分类、图标、顺序，保存。
4. 广告与解锁：流量主开通后填广告位 ID；没有就留空（直接解锁）。
5. 功能与缓存：按需开关；缓存上限/有效期别设太小。
6. **COS 防盗链**：放行 `servicewechat.com` 与站点域名，否则真机/H5 会 403。

小程序侧：

- 公众平台 → 开发管理 → 服务器域名：`request` 填 API 域名，`downloadFile` 填 COS 域名。
- `miniprogram/config/env.js` 改成 `https://你的域名`。
- 微信开发者工具重新编译上传。

## 4. 日常检查

```bash
docker compose ps
curl -fsS https://你的域名/api/ready
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
curl -fsS https://你的域名/api/ready
```

回滚：

```bash
docker compose down
# 切回上一版代码目录或镜像 tag
docker compose up -d
```

数据库变更目前是 `CREATE TABLE IF NOT EXISTS`，不破坏已有表；若后续加字段，先备份再执行迁移。

## 7. 上线前必须确认

- [ ] `/api/ready` 200
- [ ] `/admin` 能登录，保存配置后 `/api/config` 立即变化
- [ ] COS 测试连接成功，上传一条后能试听
- [ ] COS 防盗链放行 `servicewechat.com`
- [ ] 小程序 `env.js` 指向 HTTPS 域名
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
