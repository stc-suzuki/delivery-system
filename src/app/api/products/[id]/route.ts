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

function todayInJapan(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

// 過去の荷物（Package）は商品名・寸法を自分で持っているため、商品を消しても表示に困らない
// （productIdはonDelete: SetNullで外れるだけ）。一方、荷物受付画面は商品の紐付けがない荷物を
// 保存時に捨ててしまうため、本日以降の未完了の荷物で使われている商品は削除させない
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const product = await prisma.product.findUnique({ where: { id: params.id } });
    if (!product) {
      return NextResponse.json({ error: '商品が見つかりません' }, { status: 404 });
    }

    // stopDateは@db.Date（UTCの0時）で保存されるため、日本時間の今日の日付をUTCの0時として比較する
    const activeCount = await prisma.package.count({
      where: {
        productId: params.id,
        stop: { stopDate: { gte: new Date(todayInJapan()) }, status: 'PENDING' },
      },
    });
    if (activeCount > 0) {
      return NextResponse.json(
        { error: `この商品は本日以降の未完了の荷物（${activeCount}件）で使われているため削除できません` },
        { status: 400 }
      );
    }

    await prisma.product.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '商品の削除に失敗しました' }, { status: 500 });
  }
}
