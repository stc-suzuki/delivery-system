import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

// DELETE: 給油記録の取り消し（誤操作時）
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.fuelLog.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: '対象の給油記録が見つかりません' }, { status: 404 });
    }
    console.error(error);
    return NextResponse.json({ error: '給油記録の取り消しに失敗しました' }, { status: 500 });
  }
}
