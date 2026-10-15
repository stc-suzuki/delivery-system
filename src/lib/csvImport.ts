import Papa from 'papaparse';

// 配送先のCSV一括登録で使う、ファイルの読み取りまわりの処理

// ExcelでCSV保存するとShift_JISになるため、UTF-8として正しく読めなければShift_JISとして読む。
// UTF-8（BOMの有無を問わず）はそのまま読む
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

// 見出しは英語（name,address,phone）のほか、日本語の見出しも受け付ける
const HEADER_ALIASES: Record<string, 'name' | 'address' | 'phone'> = {
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

export function normalizeCsvHeader(header: string): string {
  const key = header.replace(/^﻿/, '').trim().toLowerCase();
  return HEADER_ALIASES[key] ?? key;
}

export type LocationCsvRow = { rowNo: number; name: string; address: string; phone: string };

// 1行目に名称と住所の見出しがあれば見出しに従って読む。無ければ見出しなしとみなし、
// 「名称,住所,電話番号」の列順で1行目から読む（見出しを付けずに作ったCSVで、
// 1行目のデータが見出し扱いされて全件失敗していたため）
export function parseLocationCsv(text: string): LocationCsvRow[] {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  const rows = parsed.data.map(cols => cols.map(c => c.trim()));
  if (rows.length === 0) return [];

  const headers = rows[0].map(normalizeCsvHeader);
  const hasHeader = headers.includes('name') && headers.includes('address');
  const index = hasHeader
    ? { name: headers.indexOf('name'), address: headers.indexOf('address'), phone: headers.indexOf('phone') }
    : { name: 0, address: 1, phone: 2 };
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const firstRowNo = hasHeader ? 2 : 1;

  return dataRows.map((cols, i) => ({
    rowNo: firstRowNo + i,
    name: cols[index.name] ?? '',
    address: cols[index.address] ?? '',
    phone: index.phone >= 0 ? cols[index.phone] ?? '' : '',
  }));
}
