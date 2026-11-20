# 本番のサーバーで動いているシステムを止める（Windows。設置・更新手順書 2.8節・3章）。
#   powershell -ExecutionPolicy Bypass -File scripts\stop-production.ps1
# タスク スケジューラの「終了」では、start-production.ps1 だけが止まり、その先で動いているシステム（node）は
# 残ってしまう。このスクリプトは、待ち受けているポートからシステムのプロセスを探して止める。
# ポートは -Port、なければ .env.local の PORT、なければ 3000。
# 注意: このファイルはBOM付きUTF-8で保存すること（Windows PowerShell 5.1対策）
param([int]$Port = 0)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if ($Port -eq 0) {
  $Port = 3000
  $envFile = Join-Path $root '.env.local'
  if (Test-Path $envFile) {
    $line = Get-Content $envFile -Encoding UTF8 | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -First 1
    if ($line -and ($line -match '=\s*"?(\d+)"?')) { $Port = [int]$Matches[1] }
  }
}

$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique)
if ($listeners.Count -eq 0) {
  Write-Output "ポート$Port で動いているシステムはありません（止まっています）"
  exit 0
}

foreach ($procId in $listeners) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId"
  if (-not $proc -or $proc.Name -ne 'node.exe') {
    Write-Output ("ポート{0} を使っているのはシステム（node.exe）ではありません（{1}、プロセス番号 {2}）。止めずに終了します" -f $Port, $proc.Name, $procId)
    exit 1
  }
  # 起動の仕組み上、親（tsx の node・npm の cmd）も残るため、親をたどって node・cmd もまとめて止める
  $targets = @($procId)
  $parentId = $proc.ParentProcessId
  for ($i = 0; $i -lt 4 -and $parentId; $i++) {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId"
    if (-not $parent -or ($parent.Name -ne 'node.exe' -and $parent.Name -ne 'cmd.exe')) { break }
    $targets += $parent.ProcessId
    $parentId = $parent.ParentProcessId
  }
  # start-production.ps1 に「スクリプトで止めた」ことを伝える印（失敗として再起動されないように）
  $logDir = Join-Path $root 'logs'
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
  Set-Content -Path (Join-Path $logDir 'stopped-by-script') -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  foreach ($t in $targets) { Stop-Process -Id $t -Force -ErrorAction SilentlyContinue }
  Write-Output ("ポート{0} のシステムを止めました（プロセス番号 {1}）" -f $Port, ($targets -join ', '))
}

Start-Sleep -Seconds 2
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  Write-Output "まだポート$Port で待ち受けています。もう一度実行するか、タスク マネージャーで node.exe を確かめてください"
  exit 1
}
exit 0
