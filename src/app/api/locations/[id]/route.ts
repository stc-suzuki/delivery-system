import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { geocodeAddress } from '@/lib/geocode';
import { extractCity } from '@/lib/address';
import { parseManualPosition } from '@/lib/locationPosition';
import { recomputePendingRoutesFromToday } from '@/lib/recomputeRoutes';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const existing = await prisma.location.findUnique({ where: { id: params.id } });
    if (!existing) {
      return NextResponse.json({ error: '配送先が見つかりません' }, { status: 404 });
    }

    const body = await req.json();
    const { name, address, phone, lat, lng } = body;
    const manual = parseManualPosition(lat, lng);
    if (!manual.ok) {
      return NextResponse.json({ error: manual.error }, { status: 400 });
    }

    // 位置の決め方：地図で指定されていればその位置。指定がなく住所が変わった場合は住所検索で決め直す
    // （手で指定した位置も捨てる。住所が変われば場所も変わるはずなので）。どちらでもなければ今の位置のまま
    const addressChanged = address !== undefined && address !== existing.address;
    const position = manual.position
      ? { lat: manual.position.lat, lng: manual.position.lng, formattedAddress: null, positionManual: true }
      : addressChanged
      ? { ...(await geocodeAddress(address)), positionManual: false }
      : undefined;
    const city = addressChanged ? extractCity(address) : '';

    const location = await prisma.location.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(address !== undefined && { address }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(position && {
          lat: position.lat,
          lng: position.lng,
          formattedAddress: position.formattedAddress,
          positionManual: position.positionManual,
        }),
        ...(city && { city }),
      },
    });

    // 位置が変わったら、この配送先を含む今日以降のまだ出発していないルートの到着予定を計算し直す
    const positionChanged = location.lat !== existing.lat || location.lng !== existing.lng;
    const recomputedRoutes = positionChanged ? await recomputePendingRoutesFromToday(location.id) : 0;
    return NextResponse.json({ ...location, recomputedRoutes });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : '配送先の更新に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const location = await prisma.location.findUnique({ where: { id: params.id } });
    if (!location) {
      return NextResponse.json({ error: '配送先が見つかりません' }, { status: 404 });
    }

    const stopCount = await prisma.deliveryStop.count({ where: { locationId: params.id } });
    if (stopCount > 0) {
      return NextResponse.json(
        { error: 'この配送先には配送計画・プールの停車地データが存在するため削除できません' },
        { status: 400 }
      );
    }

    await prisma.location.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: '配送先の削除に失敗しました' }, { status: 500 });
  }
}
