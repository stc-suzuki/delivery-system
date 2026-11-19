# db-backup.ps1・db-restore.ps1 で共通に使う処理（接続先の読み取り、PostgreSQLの道具の場所）
# ※ BOM付きUTF-8で保存すること

function Get-DatabaseUrl {
  if ($env:DATABASE_URL) { return $env:DATABASE_URL }
  foreach ($f in @('.env.local', '.env')) {
    if (Test-Path $f) {
      $line = Get-Content $f -Encoding UTF8 | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
      if ($line) { return ($line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'") }
    }
  }
  throw 'DATABASE_URL が見つかりません（環境変数か、.env.local・.env に書いてください）'
}

function Get-DbConnection {
  $url = Get-DatabaseUrl
  $m = [regex]::Match($url, '^postgres(?:ql)?://([^:/@]+)(?::([^@]*))?@([^:/?]+)(?::(\d+))?/([^?]+)')
  if (-not $m.Success) { throw 'DATABASE_URL の形式を読み取れません（postgresql://ユーザー:パスワード@ホスト:ポート/DB名）' }
  [pscustomobject]@{
    User     = [uri]::UnescapeDataString($m.Groups[1].Value)
    Password = [uri]::UnescapeDataString($m.Groups[2].Value)
    Host     = $m.Groups[3].Value
    Port     = $(if ($m.Groups[4].Success) { $m.Groups[4].Value } else { '5432' })
    Database = $m.Groups[5].Value
  }
}

function Resolve-PgBin([string]$PgBin) {
  if ($PgBin) { return $PgBin }
  $cmd = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
  if ($cmd) { return (Split-Path $cmd.Source) }
  $found = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($found) { return $found.DirectoryName }
  throw 'pg_dump が見つかりません。-PgBin でPostgreSQLのbinフォルダを指定してください'
}

# 全テーブルの件数（復元の確認に使う）。列名を日本語にするとpsqlへ渡すときに文字コードが崩れるため英字にする
$TableCountSql = @"
SELECT table_name,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int AS row_count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
"@
