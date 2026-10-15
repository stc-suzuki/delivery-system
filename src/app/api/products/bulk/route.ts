import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { BulkImportResult } from '@/types';
import { decodeCsv, parseDimension, parseProductCsv } from '@/lib/csvImport';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'CSVファイルが指定されていません' }, { status: 400 });
    }

    const rows = parseProductCsv(decodeCsv(new Uint8Array(await file.arrayBuffer())));
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'CSVに登録するデータがありません（ファイルが空か、保存されていない可能性があります）' },
        { status: 400 }
      );
    }

    // 同じ名前の商品は登録しない（同じファイルを2回取り込んで重複するのを防ぐ。寸法の変更は画面の編集で行う）
    const existing = await prisma.product.findMany({ select: { name: true } });
    const knownNames = new Set(existing.map(p => p.name));

    const result: BulkImportResult = { success: 0, failed: 0, errors: [] };

    for (const row of rows) {
      try {
        if (!row.name) throw new Error('商品名が未入力です');
        if (knownNames.has(row.name)) throw new Error(`「${row.name}」は既に登録されています（寸法を変える場合は一覧の「編集」から）`);
        const width = parseDimension(row.width);
        const depth = parseDimension(row.depth);
        const height = parseDimension(row.height);
        if (width === null || depth === null || height === null) {
          throw new Error('幅・奥行き・高さは0より大きい数値（m）で入力してください');
        }
        await prisma.product.create({ data: { name: row.name, width, depth, height } });
        knownNames.add(row.name);
        result.success += 1;
      } catch (err) {
        result.failed += 1;
        const message = err instanceof Error ? err.message : '不明なエラー';
        result.errors.push(`${row.rowNo}行目: ${message}`);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'CSV一括登録に失敗しました' }, { status: 500 });
  }
}
