export { default } from 'next-auth/middleware';

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/locations/:path*',
    '/drivers/:path*',
    '/trucks/:path*',
    '/plans/:path*',
    '/tracking/:path*',
  ],
};
