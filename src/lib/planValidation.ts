import { prisma } from '@/lib/prisma';
import { isDefaultDayOff } from '@/lib/driverSchedule';

export const MAX_STOPS_PER_ROUTE = 40;

export type PackageInput = { productId: string; name: string; width: number; depth: number; height: number };

// 荷物入力（商品マスタ参照＋寸法）のバリデーション。エラーがあればメッセージを返し、なければnull。
// optimize/pool両エンドポイントで共通利用する。
export async function validatePackagesInput(
  locationIds: string[],
  packages: Record<string, PackageInput[]> | undefined
): Promise<string | null> {
  if (!packages) return null;

  const referencedProductIds = new Set<string>();
  for (const id of locationIds) {
    const pkgs = packages[id];
    if (pkgs === undefined) continue;
    for (const p of pkgs) {
      if (!p.productId || typeof p.productId !== 'string') {
        return '荷物は商品マスタから選択してください';
      }
      if (!p.name || typeof p.name !== 'string') {
        return '荷物の名前を入力してください';
      }
      if (![p.width, p.depth, p.height].every(v => typeof v === 'number' && v > 0)) {
        return '荷物の寸法（幅・奥行き・高さ）は正の数値で指定してください';
      }
      referencedProductIds.add(p.productId);
    }
  }
  if (referencedProductIds.size > 0) {
    const foundProducts = await prisma.product.findMany({ where: { id: { in: Array.from(referencedProductIds) } } });
    if (foundProducts.length !== referencedProductIds.size) {
      return '指定された商品が見つかりません';
    }
  }
  return null;
}

export async function checkTruckAvailable(
  routeDate: Date,
  truckId: string,
  excludeRouteId?: string
): Promise<boolean> {
  const existing = await prisma.planRoute.findFirst({
    where: {
      truckId,
      routeDate,
      ...(excludeRouteId ? { id: { not: excludeRouteId } } : {}),
    },
  });
  return !existing;
}

export async function checkDriverAvailable(
  routeDate: Date,
  driverId: string,
  excludeRouteId?: string
): Promise<boolean> {
  const existing = await prisma.planRoute.findFirst({
    where: {
      driverId,
      routeDate,
      ...(excludeRouteId ? { id: { not: excludeRouteId } } : {}),
    },
  });
  return !existing;
}

export async function checkDriverNotOnDayOff(
  date: Date,
  driverId: string
): Promise<boolean> {
  if (isDefaultDayOff(date)) return false;
  const dayOff = await prisma.driverDayOff.findUnique({
    where: { driverId_date: { driverId, date } },
  });
  return !dayOff;
}
