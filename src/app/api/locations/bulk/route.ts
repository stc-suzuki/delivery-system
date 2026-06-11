import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { prisma } from '@/lib/prisma';
import { geocodeAddress } from '@/lib/geocode';
import { BulkLocationResult } from '@/types';

type CsvRow = { name: string; address: string; phone?: string };

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'CSVファイルが指定されていません' }, { status: 400 });
    }

    const text = await file.text();
    const parsed = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true });

    const result: BulkLocationResult = { success: 0, failed: 0, errors: [] };

    for (let index = 0; index < parsed.data.length; index++) {
      const row = parsed.data[index];
      const rowNo = index + 2; // ヘッダー行を考慮
      try {
        if (!row.name || !row.address) {
          throw new Error('name または address が未入力です');
        }
        const geo = await geocodeAddress(row.address);
        await prisma.location.create({
          data: {
            name: row.name,
            address: row.address,
            phone: row.phone ?? null,
            formattedAddress: geo.formattedAddress,
            lat: geo.lat,
            lng: geo.lng,
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
