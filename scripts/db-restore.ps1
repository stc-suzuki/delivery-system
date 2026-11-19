# バックアップ（db-backup.ps1で作った .dump）からDBを戻す。
# 使い方（リポジトリのルートで）:
#   ① 別のDBに戻して中身を確かめる（ふだんの復元の練習。今のDBには触れない）
#      powershell -ExecutionPolicy Bypass -File scripts\db-restore.ps1 -File db_backups\delivery_db_20261119_170000.dump -TargetDb delivery_db_restore_test -CreateDb
#   ② 今使っているDBを、バックアップの時点に戻す（障害時。先にアプリを止める。戻す前の状態も自動でバックアップする）
#      powershell -ExecutionPolicy Bypass -File scripts\db-restore.ps1 -File <ファイル> -TargetDb delivery_db -Overwrite
# 接続先（サーバー・ユーザー・パスワード）は DATABASE_URL のものを使い、DB名だけ -TargetDb に替える。
# ※ BOM付きUTF-8で保存すること
param(
  [Parameter(Mandatory = $true)][string]$File,
  [Parameter(Mandatory = $true)][string]$TargetDb,
  [switch]$CreateDb,
  [switch]$Overwrite,
  [string]$PgBin = ""
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'db-common.ps1')

if (-not (Test-Path $File)) { throw "バックアップのファイルがありません: $File" }
$conn = Get-DbConnection
$bin = Resolve-PgBin $PgBin

# 今アプリが使っているDBへの上書きは、-Overwrite を付けたときだけ行う
if ($TargetDb -eq $conn.Database -and -not $Overwrite) {
  throw "$TargetDb は今アプリが使っているDBです。上書きして戻す場合は、アプリを止めてから -Overwrite を付けてください（別のDB名なら -CreateDb で新しく作って戻せます）"
}

$env:PGPASSWORD = $conn.Password
try {
  $psql = Join-Path $bin 'psql.exe'
  $common = @('-h', $conn.Host, '-p', $conn.Port, '-U', $conn.User)

  if ($CreateDb) {
    & (Join-Path $bin 'createdb.exe') @common $TargetDb
    if ($LASTEXITCODE -ne 0) { throw "DB $TargetDb を作れませんでした（同じ名前のDBが既にあるかもしれません）" }
    "DB $TargetDb を作りました"
  }

  if ($Overwrite) {
    # 戻す前の今の状態も残しておく（戻した後に「やはり直前の状態が必要」となったときのため）
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $before = Join-Path (Split-Path $File) "$($TargetDb)_before-restore_$stamp.dump"
    & (Join-Path $bin 'pg_dump.exe') @common -d $TargetDb -Fc --no-owner --no-privileges -f $before
    if ($LASTEXITCODE -ne 0) { throw '戻す前の状態をバックアップできなかったため、中止しました' }
    "戻す前の状態をバックアップしました: $before"
  }

  # --single-transaction：途中で失敗したら何も変えない。--clean --if-exists：今ある表を消してから作り直す
  & (Join-Path $bin 'pg_restore.exe') @common -d $TargetDb --clean --if-exists --no-owner --no-privileges --single-transaction $File
  if ($LASTEXITCODE -ne 0) { throw "復元に失敗しました（終了コード $LASTEXITCODE）。--single-transaction のため、DBは変わっていません" }
  "復元しました: $File → $TargetDb"

  # 戻した中身の件数を出す（バックアップ元の件数と見比べる）
  & $psql @common -d $TargetDb -c $TableCountSql
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
