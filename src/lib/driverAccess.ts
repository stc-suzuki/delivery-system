import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

// ドライバー用URL（/driver/[routeId]）はログインせずURLだけで使う仕様のため、URLが流出した場合の
// 被害を配送日の当日（日本時間）に限定する。ログイン済みの利用者（リアルタイム追跡画面からの
// 本部による代理操作など）は日付に関係なく操作できる

function todayInJapan(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

// routeDateは@db.Date（UTCの0時）で保存されるため、UTCの日付部分がそのまま配送日になる
function isRouteDateToday(routeDate: Date): boolean {
  return routeDate.toISOString().slice(0, 10) === todayInJapan();
}

// loggedIn: ログイン済みか（actor: 'DISPATCHER' の自己申告はログイン済みの場合だけ信用する）
// denied: アクセスを拒否する場合のエラー応答。問題なければnull
export async function checkDriverAccess(
  req: NextRequest,
  routeDate: Date
): Promise<{ loggedIn: boolean; denied: NextResponse | null }> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const loggedIn = token !== null;
  if (loggedIn || isRouteDateToday(routeDate)) {
    return { loggedIn, denied: null };
  }
  return {
    loggedIn,
    denied: NextResponse.json(
      { error: 'このURLの有効期限が切れています（配送日の当日のみ利用できます）', expired: true },
      { status: 403 }
    ),
  };
}
