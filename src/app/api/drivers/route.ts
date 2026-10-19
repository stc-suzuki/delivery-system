import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DriverStatus, DriverType } from '@prisma/client';

// 名前の比較用。空白（全角・半角）の有無や数の違いは同じ名前とみなす
function normalizeName(name: string): string {
  return name.replace(/[\s　]+/g, '');
}

export async function GET(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get('type');
    const status = req.nextUrl.searchParams.get('status');
    const drivers = await prisma.driver.findMany({
      where: {
        ...(type && { type: type as DriverType }),
        ...(status && { status: status as DriverStatus }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(drivers);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'ドライバーの取得に失敗しました' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, phone, type, allowDuplicateName } = body;
    if (!name || !phone || !type) {
      return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
    }
    // 二重登録の防止。同じ名前のドライバー（削除済みを含む）がいれば、画面で確認を取ってから
    // allowDuplicateName付きで送り直してもらう（同姓同名の別人もあり得るため、拒否はしない）
    if (!allowDuplicateName) {
      const key = normalizeName(name);
      const sameName = (await prisma.driver.findMany({ orderBy: { createdAt: 'asc' } })).filter(
        d => normalizeName(d.name) === key
      );
      if (sameName.length > 0) {
        return NextResponse.json(
          {
            error: '同じ名前のドライバーが登録されています',
            duplicateName: true,
            existing: sameName.map(d => ({ name: d.name, phone: d.phone, type: d.type, status: d.status })),
          },
          { status: 409 }
        );
      }
    }
    const driver = await prisma.driver.create({
      data: { name, phone, type },
    });
    return NextResponse.json(driver, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'ドライバーの登録に失敗しました' }, { status: 500 });
  }
}
