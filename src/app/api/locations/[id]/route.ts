import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { geocodeAddress } from '@/lib/geocode';
import { extractCity } from '@/lib/address';

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
    const { name, address, phone } = body;

    const addressChanged = address !== undefined && address !== existing.address;
    const geo = addressChanged ? await geocodeAddress(address) : undefined;
    const city = addressChanged ? extractCity(address) : '';

    const location = await prisma.location.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(address !== undefined && { address }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(geo && { lat: geo.lat, lng: geo.lng, formattedAddress: geo.formattedAddress }),
        ...(city && { city }),
      },
    });
    return NextResponse.json(location);
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
