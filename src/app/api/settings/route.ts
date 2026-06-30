import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const settings = await prisma.systemSetting.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });
    return NextResponse.json(settings);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '設定の取得に失敗しました' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      defaultDepartureTime,
      lunchBreakStart,
      lunchBreakEnd,
      defaultStopDurationMinutes,
      defaultCargoRatio,
    } = body;

    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(defaultDepartureTime) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(lunchBreakStart) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(lunchBreakEnd)
    ) {
      return NextResponse.json({ error: '時刻はHH:mm形式で入力してください' }, { status: 400 });
    }
    if (!Number.isInteger(defaultStopDurationMinutes) || defaultStopDurationMinutes <= 0) {
      return NextResponse.json({ error: '積み下ろし時間は正の整数で入力してください' }, { status: 400 });
    }
    if (!Number.isInteger(defaultCargoRatio) || defaultCargoRatio <= 0 || defaultCargoRatio > 100) {
      return NextResponse.json({ error: '荷量割合は1〜100の整数で入力してください' }, { status: 400 });
    }

    const settings = await prisma.systemSetting.upsert({
      where: { id: 'default' },
      update: {
        defaultDepartureTime,
        lunchBreakStart,
        lunchBreakEnd,
        defaultStopDurationMinutes,
        defaultCargoRatio,
      },
      create: {
        id: 'default',
        defaultDepartureTime,
        lunchBreakStart,
        lunchBreakEnd,
        defaultStopDurationMinutes,
        defaultCargoRatio,
      },
    });
    return NextResponse.json(settings);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '設定の更新に失敗しました' }, { status: 500 });
  }
}
