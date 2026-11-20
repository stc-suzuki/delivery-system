// 本番用の初期化：空のDBを、システムを使い始められる最小限の状態にする（仕様書8.5節）。
//   1. 接続先のDBに業務のデータが1件でもあれば、何もせずに止まる（テスト用・運用中のDBを上書きしないため）
//   2. テーブルを作る（prisma migrate deploy。開発用の migrate dev は使わない）
//   3. システム管理者を1人だけ作る（パスワードは指定するか、指定がなければ推測されにくい値を作って1回だけ表示する）
//   4. システム設定の初期値を入れる（本社の名前・住所・出発時刻などは、初期化の後にシステム設定画面で直す）
// テスト用のトラック・ドライバー・配送先（prisma/seed.ts）は入れない。実際のデータは画面・CSVから登録する。
//
// 使い方（リポジトリのルートで）:
//   npm run db:init-production
//   接続先は .env.local の DATABASE_URL（アプリと同じ設定ファイル）。環境変数 DATABASE_URL を指定した場合はそちらが優先
//   任意の指定（環境変数）:
//     INIT_ADMIN_NAME      ログインに使う名前（既定「システム管理者」）
//     INIT_ADMIN_PASSWORD  パスワード（12文字以上。省略すると自動で作って表示する）
//     INIT_ADMIN_EMAIL     メールアドレス（ログインには使わないが必須の項目。既定 admin@example.invalid）
import { execSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { loadEnvConfig } from '@next/env';

// アプリと同じ設定ファイル（.env.local など）を読む。Prismaは .env.local を読まないため。
// すでに環境変数で指定された値は上書きしない
loadEnvConfig(process.cwd(), false);

// 1件でもあれば止める表（業務のデータ）。テーブル名はPrismaのモデル名どおり
const BUSINESS_TABLES = ['User', 'Driver', 'Truck', 'Location', 'Product', 'PlanRoute', 'DeliveryStop'];
const MIN_PASSWORD_LENGTH = 12;

function generatePassword(length = 16): string {
  // 読み間違えやすい文字（0/O、1/l/I）を除いた英数字と記号
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-_!#%+';
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join('');
}

function describeTarget(url: string | undefined): string {
  if (!url) return '（DATABASE_URL が未設定）';
  // パスワードは出さない
  return url.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');
}

async function businessRowCounts(prisma: PrismaClient): Promise<Record<string, number>> {
  const existing = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  const names = new Set(existing.map(r => r.table_name));
  const counts: Record<string, number> = {};
  for (const t of BUSINESS_TABLES) {
    if (!names.has(t)) continue; // まだテーブルが無い＝空のDB
    const rows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT count(*) AS c FROM "${t}"`);
    counts[t] = Number(rows[0].c);
  }
  return counts;
}

async function main() {
  console.log(`接続先: ${describeTarget(process.env.DATABASE_URL)}`);

  const name = process.env.INIT_ADMIN_NAME?.trim() || 'システム管理者';
  const email = process.env.INIT_ADMIN_EMAIL?.trim() || 'admin@example.invalid';
  const given = process.env.INIT_ADMIN_PASSWORD;
  if (given !== undefined && given.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`INIT_ADMIN_PASSWORD は${MIN_PASSWORD_LENGTH}文字以上にしてください`);
  }

  // 1. 中身の確認（テーブルを作る前に行う。中身のあるDBには一切手を加えない）
  const before = new PrismaClient();
  try {
    const counts = await businessRowCounts(before);
    const nonEmpty = Object.entries(counts).filter(([, n]) => n > 0);
    if (nonEmpty.length > 0) {
      console.error('このDBには既にデータがあるため、初期化を中止しました（何も変えていません）:');
      for (const [t, n] of nonEmpty) console.error(`  ${t}: ${n}件`);
      console.error('本番用の初期化は、新しく作った空のDBにだけ使ってください。');
      process.exit(1);
    }
  } finally {
    await before.$disconnect();
  }

  // 2. テーブルを作る
  console.log('テーブルを作ります（prisma migrate deploy）...');
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });

  // 3・4. システム管理者とシステム設定
  const password = given ?? generatePassword();
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async tx => {
      await tx.user.create({
        data: { name, email, password: await bcrypt.hash(password, 10), role: 'SYSTEM_ADMIN' },
      });
      await tx.systemSetting.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
    });

    const after = await businessRowCounts(prisma);
    console.log('');
    console.log('本番用の初期化が終わりました。');
    console.log(`  システム管理者: ${name}`);
    if (given === undefined) {
      console.log(`  パスワード（自動で作成。この画面にしか出ないので控えてください）: ${password}`);
    } else {
      console.log('  パスワード: 指定された値');
    }
    console.log(`  登録された件数: ${Object.entries(after).map(([t, n]) => `${t} ${n}`).join('、')}`);
    console.log('');
    console.log('次にすること: ログインして、システム設定画面で本社の名前・住所・出発時刻・定時・積載利用率などを確認・設定する。');
    console.log('その後、トラック・ドライバー・配送先・商品・利用者を登録する（配送先と商品はCSVで一括登録できる）。');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
