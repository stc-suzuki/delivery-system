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

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', req.url);
    return NextResponse.redirect(loginUrl);
  }

  const role = typeof token.role === 'string' ? token.role : 'STAFF';
  const rank = ROLE_RANK[role] ?? 0;

  if (rank < requiredRank(req.nextUrl.pathname)) {
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
  ],
};
