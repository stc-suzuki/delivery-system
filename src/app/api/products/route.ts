import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const products = await prisma.product.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json(products);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '商品の取得に失敗しました' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, width, depth, height } = body;
    if (!name || !width || !depth || !height) {
      return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
    }
    const product = await prisma.product.create({
      data: {
        name,
        width: Number(width),
        depth: Number(depth),
        height: Number(height),
      },
    });
    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '商品の登録に失敗しました' }, { status: 500 });
  }
}
