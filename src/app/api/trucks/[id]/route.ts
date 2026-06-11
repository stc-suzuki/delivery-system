import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { plateNo, model, capacityKg, status } = body;
    const truck = await prisma.truck.update({
      where: { id: params.id },
      data: {
        ...(plateNo !== undefined && { plateNo }),
        ...(model !== undefined && { model }),
        ...(capacityKg !== undefined && { capacityKg: Number(capacityKg) }),
        ...(status !== undefined && { status }),
      },
    });
    return NextResponse.json(truck);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'トラックの更新に失敗しました' }, { status: 500 });
  }
}
