import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { geocodeAddress } from '@/lib/geocode';

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get('q');
    const locations = await prisma.location.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { address: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(locations);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '配送先の取得に失敗しました' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, address, phone } = body;
    if (!name || !address) {
      return NextResponse.json({ error: '名称と住所は必須です' }, { status: 400 });
    }

    const geo = await geocodeAddress(address);

    const location = await prisma.location.create({
      data: {
        name,
        address,
        phone: phone ?? null,
        formattedAddress: geo.formattedAddress,
        lat: geo.lat,
        lng: geo.lng,
      },
    });

    return NextResponse.json(location, { status: 201 });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : '配送先の登録に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
