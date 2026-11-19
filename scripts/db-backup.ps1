# DBのバックアップを1つ作る（PostgreSQLのpg_dump、カスタム形式）。古いバックアップは保存日数を過ぎたら消す。
# 使い方（このフォルダの1つ上＝リポジトリのルートで）:
#   powershell -ExecutionPolicy Bypass -File scripts\db-backup.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\db-backup.ps1 -OutDir D:\backup\delivery -KeepDays 30
# 接続先は環境変数 DATABASE_URL、なければ .env.local・.env の DATABASE_URL を使う。パスワードは画面に出さない。
# 毎日決まった時刻に動かすには、Windowsのタスク スケジューラにこのコマンドを登録する（仕様書8.4節）。
# ※ このファイルはBOM付きUTF-8で保存すること（Windows PowerShell 5.1はBOMなしをShift_JISとして読み、日本語で行が崩れる）
param(
  [string]$OutDir = "db_backups",
  [int]$KeepDays = 30,
  [string]$PgBin = ""
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'db-common.ps1')

$conn = Get-DbConnection
$bin = Resolve-PgBin $PgBin
New-Item -ItemType Directory -Force $OutDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$file = Join-Path $OutDir "$($conn.Database)_$stamp.dump"

$env:PGPASSWORD = $conn.Password
try {
  # --no-owner/--no-privileges：別のサーバー・別のユーザーにも戻せるよう、所有者と権限の情報は入れない
  & (Join-Path $bin 'pg_dump.exe') -h $conn.Host -p $conn.Port -U $conn.User -d $conn.Database -Fc --no-owner --no-privileges -f $file
  if ($LASTEXITCODE -ne 0) { throw "pg_dumpが失敗しました（終了コード $LASTEXITCODE）" }

  # 作ったファイルが読めて、テーブルのデータが入っているかを確かめる
  $list = & (Join-Path $bin 'pg_restore.exe') -l $file
  if ($LASTEXITCODE -ne 0) { throw "作ったバックアップを読めませんでした: $file" }
  $tables = @($list | Where-Object { $_ -match 'TABLE DATA' }).Count
  if ($tables -eq 0) { throw "バックアップにテーブルのデータがありません: $file" }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

$size = [Math]::Round((Get-Item $file).Length / 1KB)
"バックアップしました: $file（$size KB、テーブル $tables 個）"

# 保存日数を過ぎたバックアップを消す（このスクリプトが作った名前のものだけ）
$limit = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem $OutDir -Filter "$($conn.Database)_*.dump" | Where-Object { $_.LastWriteTime -lt $limit } | ForEach-Object {
  Remove-Item $_.FullName
  "古いバックアップを消しました: $($_.Name)"
}
