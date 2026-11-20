// 本番のDBに、プログラムの更新で増えたテーブルの変更（マイグレーション）を反映する（設置・更新手順書 3章）。
// Prismaのコマンドは .env.local を読まないため、アプリと同じ設定ファイル（.env.local など）を先に読んでから
// prisma migrate deploy を実行する。開発用の migrate dev（DBを作り直すことがある）は使わない。
//
// 使い方（リポジトリのルートで）: npm run db:deploy
// 反映するものが無ければ「No pending migrations to apply.」と出て何も変えない。
import { execSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd(), false);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL が設定されていません（.env.local を確かめてください）');
  process.exit(1);
}
// パスワードは出さない
console.log(`接続先: ${url.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@')}`);

execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
