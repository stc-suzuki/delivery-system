import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { geocodeAddress } from '@/lib/geocode';
import { extractCity } from '@/lib/address';
import { BulkLocationResult } from '@/types';
import { decodeCsv, parseLocationCsv } from '@/lib/csvImport';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'CSVファイルが指定されていません' }, { status: 400 });
    }

    // file.text()はUTF-8決め打ちのため、ExcelのShift_JISのCSVが文字化けして住所が引けなかった
    const text = decodeCsv(new Uint8Array(await file.arrayBuffer()));
    const rows = parseLocationCsv(text);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'CSVに登録するデータがありません（ファイルが空か、保存されていない可能性があります）' },
        { status: 400 }
      );
    }

    const result: BulkLocationResult = { success: 0, failed: 0, errors: [] };

    for (const row of rows) {
      const { rowNo } = row;
      try {
        if (!row.name || !row.address) {
          throw new Error('名称または住所が未入力です');
        }
        const geo = await geocodeAddress(row.address);
        const city = extractCity(row.address);
        await prisma.location.create({
          data: {
            name: row.name,
            address: row.address,
            phone: row.phone || null,
            formattedAddress: geo.formattedAddress,
            lat: geo.lat,
            lng: geo.lng,
            ...(city && { city }),
          },
        });
        result.success += 1;
      } catch (err) {
        result.failed += 1;
        const message = err instanceof Error ? err.message : '不明なエラー';
        result.errors.push(`${rowNo}行目: ${message}`);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'CSV一括登録に失敗しました' }, { status: 500 });
  }
}
