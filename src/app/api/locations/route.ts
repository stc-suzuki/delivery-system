import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { geocodeAddress } from '@/lib/geocode';
import { extractCity } from '@/lib/address';
import { parseManualPosition } from '@/lib/locationPosition';

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
    const { name, address, phone, lat, lng } = body;
    if (!name || !address) {
      return NextResponse.json({ error: '名称と住所は必須です' }, { status: 400 });
    }
    const manual = parseManualPosition(lat, lng);
    if (!manual.ok) {
      return NextResponse.json({ error: manual.error }, { status: 400 });
    }

    // 地図で位置を指定した場合は住所検索をしない（住所検索で見つからない住所も登録できる）
    const position = manual.position
      ? { lat: manual.position.lat, lng: manual.position.lng, formattedAddress: null, positionManual: true }
      : { ...(await geocodeAddress(address)), positionManual: false };
    const city = extractCity(address);

    const location = await prisma.location.create({
      data: {
        name,
        address,
        phone: phone ?? null,
        formattedAddress: position.formattedAddress,
        lat: position.lat,
        lng: position.lng,
        positionManual: position.positionManual,
        ...(city && { city }),
      },
    });

    return NextResponse.json(location, { status: 201 });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : '配送先の登録に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
