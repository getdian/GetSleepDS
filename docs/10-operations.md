# 常用操作：极客混跑、打包、1Panel 部署

> 这是“说一句话就能执行”的标准入口。用户说「启动极客混跑模式」= 执行 `npm run dev:geek`；说「打包部署」= 执行 `npm run pack`，再按本文第 3 节上传 1Panel。

## 1. 启动极客混跑模式

**命令（Windows PowerShell，项目根目录）：**

```powershell
npm run dev:geek
```

等价于：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/dev.ps1
```

它会做：

1. 确保本机有 Node.js 20+ 和 Docker。
2. 启动/复用 PostgreSQL 容器 `getsleepds-dev-db`，映射 `127.0.0.1:5434`。
3. 在**宿主机**（不是 Docker）启动 API，端口 `3100`，连上面的 PG。
4. 开发登录 `ALLOW_DEV_LOGIN=1`，不需要真实 AppSecret。
5. 打印 API、后台、管理员密码；`Ctrl+C` 只停 API，数据库容器保留。

默认值：

| 项 | 值 |
|---|---|
| API | `http://127.0.0.1:3100` |
| 后台 | `http://127.0.0.1:3100/admin` |
| 本地管理员 | `getsleep-local-admin-2026` |
| PostgreSQL | `getsleepds-dev-db`，`127.0.0.1:5434` |
| 小程序 API | `miniprogram/config/env.js` 开发版固定 `127.0.0.1:3100` |

常用参数：

```powershell
# 只检查环境，不启动
powershell -File deploy/dev.ps1 -Check

# 端口被旧 API 占用时强制重启（只杀 src/index.js）
powershell -File deploy/dev.ps1 -Restart

# 不用 Docker，内存库联调（重启即丢）
powershell -File deploy/dev.ps1 -Memory

# 换本地后台密码
powershell -File deploy/dev.ps1 -AdminPassword "my-local-pass"
```

小程序端：微信开发者工具导入**仓库根目录**（`project.config.json` 已指向 `miniprogram/`），详情 → 本地设置 → 勾选“不校验合法域名”。

停止：

```powershell
# Ctrl+C 停 API；数据库保留。需要彻底停数据库：
docker stop getsleepds-dev-db
```

> 只有本地开发才用 `ALLOW_DEV_LOGIN=1`；生产由 compose 设置 `NODE_ENV=production`，不会启用。

## 2. 打包

**命令（项目根目录）：**

```powershell
npm run pack
# 指定标签
npm run pack -- -Label 20261019-l4
```

等价于：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/pack.ps1
```

打包前默认执行：

- `npm test`
- `npm run check`

任一失败就拒绝出包。确认要跳过时：

```powershell
npm run pack -- -Label 20261019-l4 -SkipChecks
```

产物：

```
release-artifacts/getsleep-<label>.zip
release-artifacts/getsleep-<label>.zip.sha256
release-artifacts/stage-<label>/RELEASE-MANIFEST.json
```

压缩包只收源码/文档/部署文件：

- ✅ `miniprogram/`、`server/`、`docs/`、`deploy/`、`tests/`、`tools/check.mjs`、根配置
- ❌ `.env`、`node_modules/`、`dist/`、`release-artifacts/`、`project.private.config.json`、日志/数据库/预览图

> 不要上传 `stage-*` 或旧 `dist/`；只上传 `getsleep-<label>.zip`。

## 3. 1Panel 部署

> **先读现场，再下命令。** 仓库里的 `docker-compose.yml` 只是模板（`HOST_PORT` 默认 3000），线上真实值在服务器 `.env` 里。任何部署动作前先跑：
>
> ```bash
> cd /opt/1panel/www/sites/sleepDS/index   # 生产实际目录（2026-10-23 实测）
> pwd && ls .env docker-compose.yml
> grep -E '^HOST_PORT=' .env                # 本机为 3004
> docker compose ps
> ```

### 3.0 生产现场事实（2026-10-23 实测，勿按“首次部署”假设）

| 项 | 实际值 |
|---|---|
| 源码 / Docker 运行目录 | `/opt/1panel/www/sites/sleepDS/index` |
| 监听端口 | `HOST_PORT=3004` → `127.0.0.1:3004 → 容器 3000` |
| 反向代理 | `https://sleep.qfmaster.com` → `http://127.0.0.1:3004` |
| Compose 项目名 | `index`（**与 `/opt/1panel/www/sites/fde/index`、`/opt/1panel/www/sites/mmreen/index` 同名**） |
| 同项目容器 | `index-api-1`、`index-db-1`，另有 `fde-system`、`mmreen-web-prod` |
| 数据库 | `postgres:16-alpine`，卷 `index_pgdata` |

**三条红线（违反会波及另外两个站点）**

1. 禁止 `docker compose down`、禁止 `up --remove-orphans` —— Compose 按项目名操作，会连带停掉 fde / mmreen。
2. 禁止给 compose 加 `name:` 或改项目名 —— 命名卷会从 `index_pgdata` 换成新名字，等于连到空库。
3. 禁止整包 `unzip` 覆盖到根目录 —— 会覆盖服务器上的 `docker-compose.yml`（生产版本）与 `.env`。

### 3.1 上传与覆盖代码

1. 上传 `getsleep-<label>.zip` 到 `/opt/1panel/www/sites/sleepDS/index`。
2. 解压到临时目录，再按目录覆盖（跳过 compose 与 `.env`）：

```bash
cd /opt/1panel/www/sites/sleepDS/index
sha256sum getsleep-<label>.zip            # 与发版时记录的值比对
rm -rf /tmp/getsleep-release && mkdir -p /tmp/getsleep-release
unzip -oq getsleep-<label>.zip -d /tmp/getsleep-release
cp -a /tmp/getsleep-release/server/. ./server/
cp -a /tmp/getsleep-release/deploy/. ./deploy/
cp -a /tmp/getsleep-release/miniprogram/. ./miniprogram/
cp -a /tmp/getsleep-release/tests/. ./tests/
cp -a /tmp/getsleep-release/tools/. ./tools/ 2>/dev/null || true
```

3. 覆盖后确认版本标记（以 2026-10-23 轮为例，可用包内 `RELEASE-MANIFEST.json` 的 head 反查）：

```bash
grep -c "signKey" server/src/services/admin-auth.js   # 2
grep -c "np-ico-stop" miniprogram/components/now-playing/now-playing.wxss  # 1
```

### 3.2 创建 `.env`

复制 `.env.example` 为 `.env`，填写：

```dotenv
POSTGRES_PASSWORD=<随机强密码，只用字母数字>
WX_APPID=wx378b0a7437d60998
WX_SECRET=<小程序 AppSecret>
ADMIN_PASSWORD=<后台强密码>
CONFIG_SECRET=<固定随机串，设置后不要换>
TRUST_PROXY=1
# 生产必填：1Panel/Nginx 反代填 1；确认无代理的直连部署填 0。
# 未设置时生产环境会拒绝启动（避免全站共用同一个限流桶）。
# 本机生产值（2026-10-23 实测）：3004；不设则默认 3000
HOST_PORT=3004
```

不需要 `DOMAIN`（1Panel 管证书）。不要把 `.env` 提交、截图或发给别人。

### 3.2.1 订阅消息与运行环境（后台可视化配置）

结束入睡提醒使用一次性订阅消息。**模板 ID 不需要写 `.env`**，在后台 `/admin` →「小程序与提醒」填写并保存即可，立即生效（无需重启容器）；`.env` 的 `WX_REMINDER_TEMPLATE_ID` 只保留为历史部署的兼容兜底。

**获取模板 ID（微信公众平台）**

1. 用小程序管理员扫码登录 `https://mp.weixin.qq.com`。
2. 左侧「功能 → 订阅消息」→「公共模板库」搜索“睡眠 / 提醒 / 打卡”，选一个同时含 **提醒事项（thing1）** 与 **提醒时间（time2）** 的模板；「我的模板」里已有则直接用。
3. 进入模板详情，复制 **模板 ID**（43 位字母/数字/下划线/短横线）。
4. 后台「小程序与提醒」粘贴模板 ID，确认跳转路径为 `pages/sleep/sleep?end=1`，勾选「启用到点提醒」，点「保存并生效」。

**字段对应（服务端发送时的 data）**

| 关键词 | 代码字段 | 值 |
|---|---|---|
| 提醒事项 | `thing1` | 结束入睡 |
| 提醒时间 | `time2` | 预计起床时间（北京时间 HH:mm） |

字段名以模板详情里的「关键词」为准；对不上时微信返回 `47003`，发送失败并标记为 `failed`，用户不会再收到该条。

**字段映射（不同模板关键词不同）**

不同模板的关键词不一样，后台「小程序与提醒 → 模板字段映射」可配置：

| 模板关键词 | 提醒事项字段 | 提醒时间字段 |
|---|---|---|
| `thing1` + `time2`（默认） | `thing1` | `time2` |
| `time1` + `thing2`（如「睡觉到点提醒」） | `thing2` | `time1` |

发送时按映射构造 data：`{[thingKey]: "结束入睡", [timeKey]: "HH:mm"}`。字段名必须与模板详情完全一致，否则微信返回 `47003`。

**示例：模板「睡觉到点提醒」（编号 26461）**

- 模板 ID：`nGzp1p6O2q4R8tu5LD-5MxImt9r-HIW9MpBPRF_zMO0`
- 模板字段：提醒时间 `time1`、超时惩罚 `thing2`
- 后台填法：模板 ID 填上面的值 → 提醒事项字段名填 `thing2` → 提醒时间字段名填 `time1` → 勾选启用 → 保存
- 实际消息会显示「超时惩罚：结束入睡」。技术上可用，但该模板第二个字段的展示名是「超时惩罚」，睡前场景措辞偏负面；正式版建议在「我的模板 → 申请模板」申请一个 `thing`（提醒事项）+ `time`（提醒时间）的睡眠提醒模板。

**一次性订阅规则**：用户每点一次小程序里的「到点提醒我结束」授权一次，只能收到一条；未配置模板或用户拒绝时，客户端自动回退为“加入手机日历”。

**运行环境（只读）**：同一面板展示 AppID / AppSecret / `TRUST_PROXY` / 数据库是否就绪。这些属于密钥或启动参数，只能在 `.env` 配置并重启容器，后台只显示状态、不保存也不回显：

- AppID / AppSecret：公众平台「开发 → 开发管理 → 开发设置」；Secret 只显示一次，重置后旧值立即失效。
- `TRUST_PROXY`：1Panel/Nginx 反代填 `1`，确认无代理的直连填 `0`；未设置时生产拒绝启动。
- 数据库：`DB_MODE=postgres`（生产）或 `memory`（仅本地/测试）。

**验证**：后台保存后，`curl -s https://<域名>/api/config | jq .reminder` 应返回 `{"enabled":true,"templateId":"…","page":"pages/sleep/sleep?end=1"}`；重开小程序，在入睡页点「到点提醒我结束」应弹出微信订阅授权，而不是“订阅提醒暂未配置”。

### 3.3 启动 / 迭代部署

```bash
cd /opt/1panel/www/sites/sleepDS/index
docker compose up -d --build --no-deps api
```

只点名单服务 api：`--no-deps` 不会动 db，也不会碰同项目名下另外两个站点的容器。

`deploy/1panel-up.sh` 内部是 `docker compose up -d --build`（全项目口径）。多站点同机时优先用上面这条；脚本仍可用于校验 `.env` 必填项与等待 `/api/ready`。

出现 `Found orphan containers ([fde-system mmreen-web-prod])` 属正常提示，**不要**据此加 `--remove-orphans`。

判定成功：构建日志里 `COPY . .` 不是 `CACHED`；`docker compose ps` 中 `index-api-1` 的 `CREATED` 变成 `seconds ago`，而另两个站点的创建时间不变。

### 3.4 1Panel 反向代理 + HTTPS

1. 1Panel → 网站 → 创建网站 → **反向代理**。
2. 域名：`sleep.qfmaster.com`
3. 代理地址：`http://127.0.0.1:3004`（必须与 `.env` 的 `HOST_PORT` 一致）。
4. 申请 Let's Encrypt 证书，开启“强制 HTTPS”。
5. 网站“配置文件”里加：

```nginx
client_max_body_size 30m;
```

6. 保存并重载 OpenResty。

> compose 已把 API 绑在 `127.0.0.1:${HOST_PORT}`，只允许本机反代。不要额外对公网放行该端口。
>
> 现场事实：本机源码就放在 1Panel 站点目录下（`/opt/1panel/www/sites/sleepDS/index`），与同机 fde、mmreen 两个站点共用 Compose 项目名 `index`。因此：只重建 api、不覆盖 `docker-compose.yml`、不执行 `docker compose down`。

### 3.5 微信公众平台

- `request 合法域名`：`https://sleep.qfmaster.com`
- `downloadFile 合法域名`：`https://img.qfmaster.com`
- 环境音 URL 使用 `https://img.qfmaster.com/sleep/*.mp3`

### 3.6 上线后后台配置

打开 `https://sleep.qfmaster.com/admin`，用 `.env` 的 `ADMIN_PASSWORD` 登录：

1. **存储与上传**：Bucket `qfmaster-1322402212`、Region `ap-shanghai`、域名 `https://img.qfmaster.com`、路径 `sleep`、SecretId/SecretKey；保存 → 测试连接。
2. **环境音**：确认雨声 URL，补充分类/图标/顺序，保存。
3. **广告与解锁**：有流量主填广告位 ID；没有留空（直接解锁）。
4. **功能与缓存**：按需开关。
5. **用户数据**：客服/合规按 openid 查询/删除；删除会写 erasure 水位。

### 3.7 验证

```bash
curl -fsS https://sleep.qfmaster.com/api/ready
```

返回 `{"ok":true,"db":"ok"}`；再打开 `/admin` 登录。真机验证音频、锁屏、广告、海报。

### 3.8 升级、备份与还原

#### 升级（先备份，再覆盖代码，只重建 api）

```bash
cd /opt/1panel/www/sites/sleepDS/index
sh deploy/backup.sh                       # 见下「备份产物」
sha256sum getsleep-<label>.zip            # 与发版值比对
rm -rf /tmp/getsleep-release && mkdir -p /tmp/getsleep-release
unzip -oq getsleep-<label>.zip -d /tmp/getsleep-release
cp -a /tmp/getsleep-release/server/. ./server/
cp -a /tmp/getsleep-release/deploy/. ./deploy/
cp -a /tmp/getsleep-release/miniprogram/. ./miniprogram/
docker compose up -d --build --no-deps api
curl -fsS http://127.0.0.1:3004/api/ready
```

#### 备份产物（建议再同步一份到本地/对象存储）

| 类型 | 服务器路径 | 生成方式 |
|---|---|---|
| 数据库 | `backups/sleep-<时间戳>.sql.gz`、`backups/manual-<时间戳>.sql.gz` | `sh deploy/backup.sh` 或手工 `pg_dump` |
| 生产 compose | `/root/sleepDS-compose-<时间戳>.yml` | `cp docker-compose.yml /root/...` |
| 密钥 | `/root/sleepDS-env-<时间戳>.bak`（`chmod 600`） | `cp .env /root/...` |
| 源码 | `/root/sleepDS-src-<时间戳>.tgz` | `tar czf ... --exclude=backups --exclude=node_modules .` |
| 发版包 | `release-artifacts/getsleep-<label>.zip` + `.sha256` | 本地 `npm run pack` |

`backup.sh` 不可用时手工 dump：

```bash
DB_USER=$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2-); DB_USER=${DB_USER:-sleep}
DB_NAME=$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2-);   DB_NAME=${DB_NAME:-sleep}
STAMP=$(date +%Y%m%d-%H%M%S)
docker compose exec -T db pg_dump -U "$DB_USER" "$DB_NAME" > backups/manual-$STAMP.sql
grep -c 'PostgreSQL database dump complete' backups/manual-$STAMP.sql   # 必须为 1
gzip -c backups/manual-$STAMP.sql > backups/manual-$STAMP.sql.gz
```

#### 还原

**代码回滚**（不动数据库）

```bash
cd /opt/1panel/www/sites/sleepDS/index
tar xzf /root/sleepDS-src-<时间戳>.tgz
docker compose up -d --build --no-deps api
```

**compose 被覆盖**

```bash
cp /root/sleepDS-compose-<时间戳>.yml docker-compose.yml
docker compose config --services      # 本机应只有 db / api
```

**数据库还原**（会丢弃当前数据，二次确认后再执行）

```bash
docker compose stop api
docker compose exec -T db psql -U sleep -d sleep \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
gunzip -c backups/sleep-<时间戳>.sql.gz | docker compose exec -T db psql -U sleep -d sleep
docker compose start api
curl -fsS http://127.0.0.1:3004/api/ready
```

> 新版 `pg_dump` 会在文件首尾写 `\restrict` / `\unrestrict` 元命令，必须用**同版本或更新**的 `psql` 导入（直接用容器内的 psql 即可），本地老客户端会报语法错误。

#### 部署后必查

```bash
docker compose ps                                   # api seconds ago；另两个站点创建时间不变
curl -fsS http://127.0.0.1:3004/api/ready
curl -fsS https://sleep.qfmaster.com/api/ready
docker compose logs --tail=200 api | grep -iE "error|failed" || echo "no error"
```

后台 `/admin` 需重新登录：改密签名密钥改为按库凭据派生后，旧 Cookie 必然失效（预期行为）。

新增表通过启动 DDL `CREATE TABLE IF NOT EXISTS` 自动补建；以后加列必须用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`。

## 4. 标准口令

| 你说 | 执行 |
|---|---|
| 启动极客混跑模式 | `npm run dev:geek` |
| 打包 / 打包部署 | `npm run pack` |
| 检查部署配置 | `npm run deploy:check` |
| 1Panel 上线 | 上传最新 zip → `bash deploy/1panel-up.sh` → 1Panel 反代 |
