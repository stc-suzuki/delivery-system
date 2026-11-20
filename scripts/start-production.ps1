# 本番のサーバーでシステムを起動する（Windows。設置・更新手順書 2.8節）。
# タスク スケジューラの「コンピューターの起動時」に登録して使う。手で実行してもよい。
#   powershell -ExecutionPolicy Bypass -File scripts\start-production.ps1
# 画面に出る記録は logs\server-年月日.log に追記する（起動した日の名前のファイル）。
# 事前に npm run build（本番用の組み立て）と .env.local の用意が必要。
# 注意: このファイルはBOM付きUTF-8で保存すること（Windows PowerShell 5.1対策）
param([int]$KeepDays = 90)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$logDir = Join-Path $root 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# 古い記録を消す
Get-ChildItem $logDir -Filter 'server-*.log' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
  Remove-Item -Force

$log = Join-Path $logDir ("server-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))
Add-Content -Path $log -Encoding UTF8 -Value ("==== 起動 {0} ====" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))

# npm start の標準出力・エラー出力をまとめて記録に追記する。止まるまで戻らない
$stopMark = Join-Path $logDir 'stopped-by-script'
if (Test-Path $stopMark) { Remove-Item $stopMark -Force }
cmd.exe /c "npm start >> `"$log`" 2>&1"
$code = $LASTEXITCODE
# stop-production.ps1 で止めた場合は、正常な停止として終了コード0にする
# （タスク スケジューラの「失敗した場合の再起動」で、止めたはずのシステムが立ち上がり直さないように）
if (Test-Path $stopMark) {
  Remove-Item $stopMark -Force
  Add-Content -Path $log -Encoding UTF8 -Value ("==== 停止 {0}（stop-production.ps1 による） ====" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
  exit 0
}
Add-Content -Path $log -Encoding UTF8 -Value ("==== 終了 {0}（終了コード {1}） ====" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $code)
exit $code
