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

### 3.1 上传与解压

1. 1Panel → 文件 → `/opt` → 新建 `getsleep`。
2. 上传 `getsleep-<label>.zip` 到 `/opt/getsleep`。
3. 右键解压到当前目录。
4. 确认目录内有 `docker-compose.yml`、`server/`、`.env.example`、`deploy/1panel-up.sh`。

### 3.2 创建 `.env`

复制 `.env.example` 为 `.env`，填写：

```dotenv
POSTGRES_PASSWORD=<随机强密码，只用字母数字>
WX_APPID=wx378b0a7437d60998
WX_SECRET=<小程序 AppSecret>
ADMIN_PASSWORD=<后台强密码>
CONFIG_SECRET=<固定随机串，设置后不要换>
TRUST_PROXY=1
# 可选：如果服务器 3000 已被占用或多站点统一编排（如 3001~3003 已用），可指定 3004
# HOST_PORT=3004
```

不需要 `DOMAIN`（1Panel 管证书）。不要把 `.env` 提交、截图或发给别人。

### 3.3 启动

```bash
cd /opt/getsleep
bash deploy/1panel-up.sh
```

脚本会：

- 校验 `.env` 必填项；
- 读取 `HOST_PORT`（默认 3000）；
- `docker compose up -d --build`；
- 轮询 `http://127.0.0.1:${HOST_PORT}/api/ready`；
- 打印容器状态和下一步 1Panel 配置。

### 3.4 1Panel 反向代理 + HTTPS

1. 1Panel → 网站 → 创建网站 → **反向代理**。
2. 域名：`sleep.qfmaster.com`
3. 代理地址：`http://127.0.0.1:3000`（若在 `.env` 中设置了 `HOST_PORT=3004`，这里就填 `http://127.0.0.1:3004`）。
4. 申请 Let's Encrypt 证书，开启“强制 HTTPS”。
5. 网站“配置文件”里加：

```nginx
client_max_body_size 30m;
```

6. 保存并重载 OpenResty。

> compose 已把 API 绑在 `127.0.0.1:${HOST_PORT}`，只允许本机反代。不要额外对公网放行该端口。
>
> 常见误区：1Panel 创建网站填写的“代号”主目录（如 `/opt/1panel/www/sites/sleepDS`）是 OpenResty 站点的配置目录；项目源码及 Docker 运行目录请放在独立的 `/opt/getsleep`，不要解压覆盖到站点主目录。

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

### 3.8 升级与回滚

```bash
cd /opt/getsleep
# 保留 .env、backups/
unzip -o getsleep-<new>.zip
bash deploy/1panel-up.sh
```

回滚：切回上一版代码目录/镜像后 `docker compose up -d`，数据库 volume 不动。升级前：

```bash
sh deploy/backup.sh
```

新增表通过启动 DDL `CREATE TABLE IF NOT EXISTS` 自动补建；以后加列必须用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`。

## 4. 标准口令

| 你说 | 执行 |
|---|---|
| 启动极客混跑模式 | `npm run dev:geek` |
| 打包 / 打包部署 | `npm run pack` |
| 检查部署配置 | `npm run deploy:check` |
| 1Panel 上线 | 上传最新 zip → `bash deploy/1panel-up.sh` → 1Panel 反代 |
