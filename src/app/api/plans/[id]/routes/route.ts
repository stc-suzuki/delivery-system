import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canEditPlan } from '@/lib/planEditPolicy';
import { MAX_STOPS_PER_ROUTE } from '@/lib/planValidation';

// PATCH: 停車順のドラッグ&ドロップ並び替え、ルート間の停車地移動を保存
// body: { routes: { id: string; stops: { id: string; stopOrder: number }[] }[] }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const plan = await prisma.deliveryPlan.findUnique({ where: { id: params.id } });
    if (!plan) {
      return NextResponse.json({ error: '配送計画が見つかりません' }, { status: 404 });
    }
    if (!canEditPlan(plan)) {
      return NextResponse.json({ error: 'この配送計画は編集できません' }, { status: 403 });
    }

    const body = await req.json();
    const { routes } = body as {
      routes: {
        id: string;
        departureTime?: string | null;
        stops: {
          id: string;
          locationId?: string;
          stopOrder: number;
          scheduledTime?: string | null;
          isTimeFixed?: boolean;
        }[];
      }[];
    };

    if (!Array.isArray(routes)) {
      return NextResponse.json({ error: 'routes は配列で指定してください' }, { status: 400 });
    }

    for (const route of routes) {
      if (route.stops.length > MAX_STOPS_PER_ROUTE) {
        return NextResponse.json(
          { error: `1ルートあたりの停車地は最大${MAX_STOPS_PER_ROUTE}件までです` },
          { status: 400 }
        );
      }
    }

    await prisma.$transaction(async tx => {
      for (const route of routes) {
        const existing = await tx.planRoute.findUnique({ where: { id: route.id } });
        if (!existing || existing.planId !== params.id) {
          throw new Error(`ルート ${route.id} はこの計画に属していません`);
        }
        if (route.departureTime !== undefined) {
          await tx.planRoute.update({
            where: { id: route.id },
            data: { departureTime: route.departureTime ? new Date(route.departureTime) : null },
          });
        }
        for (const stop of route.stops) {
          await tx.deliveryStop.update({
            where: { id: stop.id },
            data: {
              routeId: route.id,
              stopOrder: stop.stopOrder,
              ...(stop.scheduledTime !== undefined
                ? {
                    scheduledTime: stop.scheduledTime ? new Date(stop.scheduledTime) : null,
                    isTimeFixed: stop.isTimeFixed ?? !!stop.scheduledTime,
                  }
                : {}),
            },
          });
        }
      }
    });

    const updatedPlan = await prisma.deliveryPlan.findUnique({
      where: { id: params.id },
      include: {
        routes: {
          orderBy: { sortOrder: 'asc' },
          include: {
            truck: true,
            driver: true,
            stops: { orderBy: { stopOrder: 'asc' }, include: { location: true } },
          },
        },
      },
    });

    return NextResponse.json(updatedPlan);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'ルートの更新に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
