import Papa from 'papaparse';

// 配送先・商品のCSV一括登録で使う、ファイルの読み取りまわりの処理

// ExcelでCSV保存するとShift_JISになるため、UTF-8として正しく読めなければShift_JISとして読む。
// UTF-8（BOMの有無を問わず）はそのまま読む
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

// 見出しは英語のほか、日本語の見出しも受け付ける
const LOCATION_HEADERS: Record<string, 'name' | 'address' | 'phone'> = {
  name: 'name',
  名称: 'name',
  名前: 'name',
  配送先名: 'name',
  配送先: 'name',
  address: 'address',
  住所: 'address',
  phone: 'phone',
  電話: 'phone',
  電話番号: 'phone',
  tel: 'phone',
};

const PRODUCT_HEADERS: Record<string, 'name' | 'width' | 'depth' | 'height'> = {
  name: 'name',
  商品名: 'name',
  名称: 'name',
  width: 'width',
  幅: 'width',
  'width(m)': 'width',
  '幅(m)': 'width',
  depth: 'depth',
  奥行き: 'depth',
  奥行: 'depth',
  'depth(m)': 'depth',
  '奥行き(m)': 'depth',
  height: 'height',
  高さ: 'height',
  'height(m)': 'height',
  '高さ(m)': 'height',
};

export function normalizeCsvHeader(header: string, aliases: Record<string, string> = LOCATION_HEADERS): string {
  const key = header.replace(/^﻿/, '').trim().toLowerCase();
  return aliases[key] ?? key;
}

type CsvRecord<K extends string> = { rowNo: number } & Record<K, string>;

// 1行目に必須の見出しがそろっていれば見出しに従って読み、それ以外の列は無視する。
// そろっていなければ見出しなしとみなし、columnsの列順で1行目から読む
// （見出しを付けずに作ったCSVで、1行目のデータが見出し扱いされて全件失敗していたため）
function parseCsvTable<K extends string>(
  text: string,
  aliases: Record<string, K>,
  columns: K[],
  required: K[]
): CsvRecord<K>[] {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  const rows = parsed.data.map(cols => cols.map(c => c.trim()));
  if (rows.length === 0) return [];

  const headers = rows[0].map(h => normalizeCsvHeader(h, aliases));
  const hasHeader = required.every(k => headers.includes(k));
  const indexOf = (k: K) => (hasHeader ? headers.indexOf(k) : columns.indexOf(k));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const firstRowNo = hasHeader ? 2 : 1;

  return dataRows.map((cols, i) => {
    const record = { rowNo: firstRowNo + i } as CsvRecord<K>;
    for (const k of columns) {
      const index = indexOf(k);
      (record as Record<K, string>)[k] = index >= 0 ? cols[index] ?? '' : '';
    }
    return record;
  });
}

export type LocationCsvRow = { rowNo: number; name: string; address: string; phone: string };

// 見出しが無ければ「名称,住所,電話番号」の列順として読む
export function parseLocationCsv(text: string): LocationCsvRow[] {
  return parseCsvTable(text, LOCATION_HEADERS, ['name', 'address', 'phone'], ['name', 'address']);
}

export type ProductCsvRow = { rowNo: number; name: string; width: string; depth: string; height: string };

// 見出しが無ければ「商品名,幅,奥行き,高さ」の列順として読む（商品マスタのExcelと同じ並び。
// その後ろの体積などの列は読まない）
export function parseProductCsv(text: string): ProductCsvRow[] {
  return parseCsvTable(text, PRODUCT_HEADERS, ['name', 'width', 'depth', 'height'], ['name', 'width', 'depth', 'height']);
}

// 寸法（m）を数値にする。全角数字も受け付け、0以下や数値でないものはnull
export function parseDimension(value: string): number | null {
  const ascii = value.replace(/[０-９．]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (ascii === '') return null;
  const n = Number(ascii);
  return Number.isFinite(n) && n > 0 ? n : null;
}
