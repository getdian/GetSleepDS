[CmdletBinding()]
param(
  [int]$Port = 3100,
  [string]$AdminPassword = 'getsleep-local-admin-2026',
  [switch]$Memory,
  [switch]$Check,
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$serverDir = Join-Path $root 'server'
$dbName = 'getsleepds-dev-db'
$dbPort = 5434
$dbPassword = 'sleepdev_local_2026'
$dbUrl = "postgres://sleep:$dbPassword@127.0.0.1:$dbPort/sleep"

function Step($text) {
  Write-Host "[dev] $text" -ForegroundColor Cyan
}

if (-not (Test-Path -LiteralPath (Join-Path $serverDir 'src\index.js'))) {
  throw "找不到 server/src/index.js，请在项目根目录运行本脚本"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw '找不到 node，请先安装 Node.js 20+'
}

if (-not $Memory -and -not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw '找不到 docker；如只想跑内存模式，请加 -Memory'
}

if ($Check) {
  Step "项目：$root"
  Step "模式：$(if ($Memory) { '内存库（无 Docker）' } else { "PostgreSQL Docker($dbName :$dbPort) + 宿主机 API" })"
  Step "API：http://127.0.0.1:$Port"
  Step "后台：http://127.0.0.1:$Port/admin"
  Step "本地管理员：$AdminPassword"
  Step '检查通过（未启动任何进程）'
  exit 0
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  if ($Restart) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if (-not $proc -or $proc.CommandLine -notmatch 'src/index\.js') {
      throw "端口 $Port 被非本项目进程占用（PID $($listener.OwningProcess)），已停止启动"
    }
    Step "停止旧 API（PID $($listener.OwningProcess)）"
    Stop-Process -Id $listener.OwningProcess -Force
    Start-Sleep -Seconds 1
  } else {
    Step "API 已在 http://127.0.0.1:$Port 运行；如需重启请加 -Restart"
    exit 0
  }
}

if (-not $Memory) {
  $existing = docker ps -a --filter "name=^/$dbName$" --format '{{.Names}}'
  if ($existing) {
    Step "复用 PostgreSQL 容器 $dbName"
    docker start $dbName | Out-Null
  } else {
    Step "创建 PostgreSQL 容器 $dbName（端口 $dbPort）"
    docker run -d --name $dbName `
      -e POSTGRES_DB=sleep `
      -e POSTGRES_USER=sleep `
      -e POSTGRES_PASSWORD=$dbPassword `
      -p "$($dbPort):5432" `
      postgres:16-alpine | Out-Null
  }

  $ready = $false
  for ($i = 0; $i -lt 30; $i += 1) {
    docker exec $dbName pg_isready -U sleep -d sleep 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) {
    throw "PostgreSQL 未就绪；查看：docker logs $dbName"
  }
}

$env:NODE_ENV = 'development'
$env:PORT = "$Port"
$env:ALLOW_DEV_LOGIN = '1'
$env:ADMIN_PASSWORD = $AdminPassword
$env:CONFIG_SECRET = 'getsleep-local-config-2026'
$env:WX_APPID = 'wx378b0a7437d60998'
$env:TRUST_PROXY = '0'

if ($Memory) {
  $env:DB_MODE = 'memory'
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Step '数据库：内存（重启即丢）'
} else {
  $env:DB_MODE = 'postgres'
  $env:DATABASE_URL = $dbUrl
  Step "数据库：PostgreSQL $dbName :$dbPort"
}

Write-Host ''
Write-Host "  小程序 API  http://127.0.0.1:$Port"
Write-Host "  后台管理    http://127.0.0.1:$Port/admin"
Write-Host "  登录密码    $AdminPassword（仅本地）"
Write-Host '  Ctrl+C 停止 API；数据库容器会保留'
Write-Host ''

if ($Port -ne 3100) {
  Write-Warning '开发版小程序 config/env.js 默认指向 3100；改端口后需同步 env.js'
}

Push-Location $serverDir
try {
  node src/index.js
} finally {
  Pop-Location
}
