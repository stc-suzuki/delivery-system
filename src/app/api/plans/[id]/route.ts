import { NextRequest, NextResponse } from 'next/server';
import { format } from 'date-fns';
import { prisma } from '@/lib/prisma';
import { canEditPlan } from '@/lib/planEditPolicy';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const plan = await prisma.deliveryPlan.findUnique({
      where: { id: params.id },
      include: {
        routes: {
          orderBy: { sortOrder: 'asc' },
          include: {
            truck: true,
            driver: true,
            stops: {
              orderBy: { stopOrder: 'asc' },
              include: { location: true },
            },
          },
        },
      },
    });
    if (!plan) {
      return NextResponse.json({ error: '配送計画が見つかりません' }, { status: 404 });
    }
    return NextResponse.json(plan);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '配送計画の取得に失敗しました' }, { status: 500 });
  }
}

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
    const { status, note, planDate } = body;

    const updated = await prisma.deliveryPlan.update({
      where: { id: params.id },
      data: {
        ...(status !== undefined && { status }),
        ...(note !== undefined && { note }),
        ...(planDate !== undefined && { planDate: new Date(planDate) }),
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '配送計画の更新に失敗しました' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const plan = await prisma.deliveryPlan.findUnique({
      where: { id: params.id },
      include: { routes: true },
    });
    if (!plan) {
      return NextResponse.json({ error: '配送計画が見つかりません' }, { status: 404 });
    }

    const hasStartedRoute = plan.routes.some(r => r.status !== 'PENDING');
    if (hasStartedRoute) {
      const body = await req.json().catch(() => ({}));
      const expected = format(new Date(plan.planDate), 'yyyy-MM-dd');
      if (body.confirmPlanDate !== expected) {
        return NextResponse.json(
          {
            error: '運送が開始されているルートが含まれています。確認のため計画日の入力が必要です',
            requiresConfirmation: true,
            planDate: expected,
          },
          { status: 409 }
        );
      }
    }

    await prisma.$transaction(async tx => {
      const routes = await tx.planRoute.findMany({ where: { planId: params.id } });
      const routeIds = routes.map(r => r.id);
      await tx.deliveryStop.deleteMany({ where: { routeId: { in: routeIds } } });
      await tx.trackingLog.deleteMany({ where: { routeId: { in: routeIds } } });
      await tx.planRoute.deleteMany({ where: { planId: params.id } });
      await tx.deliveryPlan.delete({ where: { id: params.id } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '配送計画の削除に失敗しました' }, { status: 500 });
  }
}
