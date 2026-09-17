import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DriverStatus, DriverType } from '@prisma/client';

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
    const { name, phone, type, licenseNo } = body;
    if (!name || !phone || !type || !licenseNo) {
      return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
    }
    const driver = await prisma.driver.create({
      data: { name, phone, type, licenseNo },
    });
    return NextResponse.json(driver, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'ドライバーの登録に失敗しました' }, { status: 500 });
  }
}
