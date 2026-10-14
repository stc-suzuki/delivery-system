import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }));

import { getToken } from 'next-auth/jwt';
import { checkDriverAccess } from './driverAccess';

const req = {} as NextRequest;
// 配送日はDBに「UTCの0時」で保存されている
const routeDate = new Date('2026-10-14T00:00:00.000Z');

describe('checkDriverAccess（ドライバー用URLの有効期限）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getToken).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ログインなしでも、配送日の当日（日本時間）なら使える', async () => {
    vi.setSystemTime(new Date('2026-10-14T00:00:00+09:00'));
    expect((await checkDriverAccess(req, routeDate)).denied).toBeNull();

    vi.setSystemTime(new Date('2026-10-14T23:59:00+09:00'));
    expect((await checkDriverAccess(req, routeDate)).denied).toBeNull();
  });

  it('日本時間の0時を過ぎると、ログインなしでは使えない', async () => {
    vi.setSystemTime(new Date('2026-10-15T00:00:00+09:00'));
    const { denied } = await checkDriverAccess(req, routeDate);
    expect(denied?.status).toBe(403);
    expect(await denied?.json()).toMatchObject({ expired: true });
  });

  it('配送日より前の日も、ログインなしでは使えない', async () => {
    vi.setSystemTime(new Date('2026-10-13T23:59:00+09:00'));
    expect((await checkDriverAccess(req, routeDate)).denied?.status).toBe(403);
  });

  it('ログイン済み（本部の代理操作）なら、日付に関係なく使える', async () => {
    vi.mocked(getToken).mockResolvedValue({ role: 'DELIVERY_ADMIN' });
    vi.setSystemTime(new Date('2026-10-20T10:00:00+09:00'));
    const result = await checkDriverAccess(req, routeDate);
    expect(result.denied).toBeNull();
    expect(result.loggedIn).toBe(true);
  });

  it('ログインなしの場合は loggedIn が false（代理操作の記録を認めない判断に使う）', async () => {
    vi.setSystemTime(new Date('2026-10-14T10:00:00+09:00'));
    expect((await checkDriverAccess(req, routeDate)).loggedIn).toBe(false);
  });
});
