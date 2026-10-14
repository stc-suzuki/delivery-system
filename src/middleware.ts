import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

const ROLE_RANK: Record<string, number> = {
  STAFF: 0,
  DELIVERY_ADMIN: 1,
  SYSTEM_ADMIN: 2,
};

const MASTER_PATHS = ['/locations', '/drivers', '/trucks', '/products', '/users', '/settings'];

// 業務メニュー（ダッシュボード・荷物受付・配送計画一覧の閲覧・リアルタイム追跡）= 0
// 配送管理（配送計画の作成・詳細編集・稼働トラックの登録）= 1
// マスタ管理（各種マスタ・ユーザー管理・システム設定）= 2
function requiredRank(pathname: string): number {
  if (pathname === '/plans') return 0;
  if (pathname.startsWith('/plans/') || pathname.startsWith('/truck-schedule') || pathname.startsWith('/capacity-overview')) return 1;
  if (MASTER_PATHS.some(p => pathname.startsWith(p))) return 2;
  return 0;
}

function matchesPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

// ログインなしで呼べるAPI。ドライバー画面（/driver/[routeId]）はログインせずURLだけで使う仕様のため、
// その画面が呼ぶものだけを開けておく（/api/auth はNextAuth自身のログイン処理）
function isPublicApi(pathname: string, method: string): boolean {
  if (matchesPath(pathname, '/api/auth')) return true;
  if (pathname.startsWith('/api/driver/')) return method === 'GET' || method === 'PATCH';
  if (pathname === '/api/tracking' || pathname === '/api/tracking/fuel') return method === 'POST';
  if (pathname.startsWith('/api/tracking/stops/')) return method === 'PATCH';
  if (pathname.startsWith('/api/tracking/fuel/')) return method === 'DELETE';
  return false;
}

// APIに必要な権限。画面側のrequiredRankと同じ区分に合わせる。
// 参照（GET）は一般権限の画面（荷物受付・サイドバー等）もマスタや配送計画を読むため原則0とし、
// 変更系だけを画面の区分どおりに絞る
function requiredApiRank(pathname: string, method: string): number {
  if (matchesPath(pathname, '/api/users')) return 2;
  if (method === 'GET') return 0;
  if (MASTER_PATHS.some(p => matchesPath(pathname, `/api${p}`))) return 2;
  if (matchesPath(pathname, '/api/plans') || matchesPath(pathname, '/api/stops')) return 1;
  return 0;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');

  if (isApi && isPublicApi(pathname, req.method)) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    if (isApi) {
      return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', req.url);
    return NextResponse.redirect(loginUrl);
  }

  const role = typeof token.role === 'string' ? token.role : 'STAFF';
  const rank = ROLE_RANK[role] ?? 0;

  if (isApi) {
    if (rank < requiredApiRank(pathname, req.method)) {
      return NextResponse.json({ error: 'この操作を行う権限がありません' }, { status: 403 });
    }
    return NextResponse.next();
  }

  if (rank < requiredRank(pathname)) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/pool/:path*',
    '/plans/:path*',
    '/tracking/:path*',
    '/truck-schedule/:path*',
    '/capacity-overview/:path*',
    '/locations/:path*',
    '/drivers/:path*',
    '/trucks/:path*',
    '/products/:path*',
    '/users/:path*',
    '/settings/:path*',
    '/api/:path*',
  ],
};
