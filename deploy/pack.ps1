[CmdletBinding()]
param(
  [string]$Label = (Get-Date -Format 'yyyyMMdd-HHmmss'),
  [switch]$SkipChecks,
  [switch]$ServerOnly
)

$ErrorActionPreference = 'Stop'

function Get-Sha256([string]$path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [IO.File]::OpenRead($path)
    try {
      $bytes = $sha.ComputeHash($stream)
      return ([BitConverter]::ToString($bytes)).Replace('-', '')
    } finally {
      $stream.Dispose()
    }
  } finally {
    $sha.Dispose()
  }
}

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { throw '无法定位 deploy 目录；请用 -File deploy/pack.ps1 调用' }
$root = [IO.Path]::GetFullPath((Join-Path $scriptDir '..'))
if ($Label -notmatch '^[A-Za-z0-9_-]+$') { throw 'Label 只能包含字母、数字、下划线和短横线' }

$pkgPrefix = if ($ServerOnly) { 'getsleep-server-' } else { 'getsleep-' }
$stagePrefix = if ($ServerOnly) { 'stage-server-' } else { 'stage-' }
$artifactDir = Join-Path $root 'release-artifacts'
$stage = Join-Path $artifactDir ($stagePrefix + $Label)
$zipPath = Join-Path $artifactDir ($pkgPrefix + $Label + '.zip')
$shaPath = $zipPath + '.sha256'
if ((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $zipPath)) {
  throw "发布目录或 zip 已存在：$Label；请换一个 Label"
}

Push-Location $root
try {
  if (-not $SkipChecks) {
    Write-Host '[pack] npm test' -ForegroundColor Cyan
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npm) { $npm = (Get-Command npm -ErrorAction Stop).Source }
    & $npm test
    if ($LASTEXITCODE -ne 0) { throw 'npm test 未通过，拒绝打包' }
    Write-Host '[pack] npm run check' -ForegroundColor Cyan
    & $npm run check
    if ($LASTEXITCODE -ne 0) { throw 'npm run check 未通过，拒绝打包' }
  }

  $paths = & git -C $root -c core.quotepath=false ls-files --cached --others --exclude-standard
  if ($LASTEXITCODE -ne 0) { throw '无法枚举 git 文件' }

  $allowed = @()
  foreach ($relative in ($paths | Sort-Object -Unique)) {
    $p = $relative.Replace('\', '/')
    if ($ServerOnly) {
      $ok = $p -match '^server/' -or $p -match '^deploy/(update\.sh|1panel-up\.sh)$'
    } else {
      $ok = $p -match '^(README\.md|context\.md|DECISIONS\.md|package\.json|project\.config\.json|docker-compose\.yml|\.env\.example)$' -or
        $p -match '^deploy/' -or
        $p -match '^docs/' -or
        $p -match '^miniprogram/' -or
        $p -match '^server/' -or
        $p -match '^tests/' -or
        $p -match '^tools/(check\.mjs|gen_assets\.py|gen_demo_audio\.py)$'
    }
    if (-not $ok) { continue }
    if ($p -match '(^|/)(node_modules|dist|release-artifacts|backups?|logs?|coverage|\.git)(/|$)') { continue }
    if ($p -match '(^|/)project\.private\.config\.json$') { continue }
    if ($p -match '(^|/)\.env($|\.)' -and $p -notmatch '\.env\.example$') { continue }
    if ($p -match '(^|/)tools/_preview') { continue }
    if ($p -match '\.(log|zip|sha256|db|db-journal|db-wal|db-shm|pem|key|p12|pfx)$') { continue }
    $source = Join-Path $root $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
    $allowed += $p
  }

  if ($ServerOnly) {
    $required = @(
      'server/Dockerfile',
      'server/package.json',
      'server/package-lock.json',
      'server/sql/001_init.sql',
      'server/public/admin/index.html',
      'deploy/update.sh'
    )
  } else {
    $required = @(
      'docker-compose.yml',
      '.env.example',
      'server/Dockerfile',
      'server/package.json',
      'server/package-lock.json',
      'server/sql/001_init.sql',
      'server/public/admin/index.html',
      'miniprogram/app.json',
      'miniprogram/pages/index/index.wxml',
      'project.config.json',
      'deploy/1panel-up.sh'
    )
  }
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  foreach ($p in $required) {
    if ($allowed -notcontains $p) { throw "缺少发布依赖：$p" }
  }

  $manifest = @()
  foreach ($p in $allowed) {
    $source = Join-Path $root $p
    $dest = [IO.Path]::GetFullPath((Join-Path $stage $p))
    if (-not $dest.StartsWith($stage + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw "路径越界：$p"
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
    Copy-Item -LiteralPath $source -Destination $dest
    $manifest += [ordered]@{
      path = $p
      bytes = (Get-Item -LiteralPath $dest).Length
      sha256 = (Get-Sha256 $dest)
    }
  }

  $head = (& git -C $root rev-parse HEAD).Trim()
  $dirty = [bool]((& git -C $root status --porcelain) -ne $null)
  $meta = [ordered]@{
    label = $Label
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    head = $head
    workingTreeDirty = $dirty
    files = $manifest
  }
  $metaJson = $meta | ConvertTo-Json -Depth 6
  $manifestPath = Join-Path $stage 'RELEASE-MANIFEST.json'
  [IO.File]::WriteAllText($manifestPath, $metaJson, [Text.UTF8Encoding]::new($false))

  foreach ($asm in @('System.IO.Compression', 'System.IO.Compression.FileSystem')) {
    [void][System.Reflection.Assembly]::LoadWithPartialName($asm)
    try { Add-Type -AssemblyName $asm -ErrorAction Stop } catch {}
  }
  if (-not ('System.IO.Compression.ZipArchive' -as [type])) { throw '无法加载 System.IO.Compression' }

  $zipStream = [IO.File]::Create($zipPath)
  try {
    $archive = New-Object -TypeName 'System.IO.Compression.ZipArchive' -ArgumentList @($zipStream, 'Create', $false, [Text.Encoding]::UTF8)
    try {
      $prefix = $stage.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
      foreach ($dir in (Get-ChildItem -LiteralPath $stage -Recurse -Directory)) {
        $name = $dir.FullName.Substring($prefix.Length).Replace('\', '/') + '/'
        [void]$archive.CreateEntry($name, 'Optimal')
      }
      foreach ($file in (Get-ChildItem -LiteralPath $stage -Recurse -File)) {
        $name = $file.FullName.Substring($prefix.Length).Replace('\', '/')
        $entry = $archive.CreateEntry($name, 'Optimal')
        $target = $entry.Open()
        try {
          $sourceStream = [IO.File]::OpenRead($file.FullName)
          try { $sourceStream.CopyTo($target) } finally { $sourceStream.Dispose() }
        } finally { $target.Dispose() }
      }
    } finally { $archive.Dispose() }
  } finally { $zipStream.Dispose() }

  $hash = (Get-Sha256 $zipPath)
  $size = (Get-Item -LiteralPath $zipPath).Length
  [IO.File]::WriteAllText($shaPath, "$hash  $(Split-Path -Leaf $zipPath)`n", [Text.UTF8Encoding]::new($false))
  Write-Host "[pack] zip: $zipPath" -ForegroundColor Green
  Write-Host "[pack] files: $($manifest.Count); bytes: $size"
  Write-Host "[pack] sha256: $hash"
  Write-Host "[pack] manifest: $manifestPath"
} finally {
  Pop-Location
}
