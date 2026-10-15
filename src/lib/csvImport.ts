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
