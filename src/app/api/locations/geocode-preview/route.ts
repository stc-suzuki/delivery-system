import { NextRequest, NextResponse } from 'next/server';
import { geocodeAddress } from '@/lib/geocode';

export async function POST(req: NextRequest) {
  try {
    const { address } = await req.json();
    if (!address) {
      return NextResponse.json({ error: '住所を入力してください' }, { status: 400 });
    }
    const geo = await geocodeAddress(address);
    return NextResponse.json(geo);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : '住所確認に失敗しました';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
