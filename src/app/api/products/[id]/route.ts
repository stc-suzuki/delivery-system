import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { name, width, depth, height } = body;
    const product = await prisma.product.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(width !== undefined && { width: Number(width) }),
        ...(depth !== undefined && { depth: Number(depth) }),
        ...(height !== undefined && { height: Number(height) }),
      },
    });
    return NextResponse.json(product);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '商品の更新に失敗しました' }, { status: 500 });
  }
}
