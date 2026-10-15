import { describe, expect, it } from 'vitest';
import { decodeCsv, normalizeCsvHeader } from './csvImport';

// 「テスト」をShift_JISで表したバイト列
const SJIS_TEST = [0x83, 0x65, 0x83, 0x58, 0x83, 0x67];

function concat(a: ArrayLike<number>, b: ArrayLike<number>): Uint8Array {
  return new Uint8Array([...Array.from(a), ...Array.from(b)]);
}

describe('decodeCsv', () => {
  it('UTF-8はそのまま読む', () => {
    expect(decodeCsv(new TextEncoder().encode('name\nテスト'))).toBe('name\nテスト');
  });

  it('UTF-8のBOMは取り除く', () => {
    const bytes = concat([0xef, 0xbb, 0xbf], new TextEncoder().encode('name\nテスト'));
    expect(decodeCsv(bytes)).toBe('name\nテスト');
  });

  it('Excelで保存したShift_JISのCSVも文字化けせずに読む', () => {
    const bytes = concat(new TextEncoder().encode('name\r\n'), SJIS_TEST);
    expect(decodeCsv(bytes)).toBe('name\r\nテスト');
  });
});

describe('normalizeCsvHeader', () => {
  it('英語の見出しはそのまま（大文字・前後の空白は吸収）', () => {
    expect(normalizeCsvHeader(' Name ')).toBe('name');
    expect(normalizeCsvHeader('ADDRESS')).toBe('address');
  });

  it('日本語の見出しを読み替える', () => {
    expect(normalizeCsvHeader('名称')).toBe('name');
    expect(normalizeCsvHeader('配送先名')).toBe('name');
    expect(normalizeCsvHeader('住所')).toBe('address');
    expect(normalizeCsvHeader('電話番号')).toBe('phone');
  });

  it('知らない見出しは小文字にしてそのまま返す', () => {
    expect(normalizeCsvHeader('Memo')).toBe('memo');
  });
});
