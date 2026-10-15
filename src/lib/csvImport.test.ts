import { describe, expect, it } from 'vitest';
import { decodeCsv, normalizeCsvHeader, parseLocationCsv } from './csvImport';

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

describe('parseLocationCsv', () => {
  it('見出しがあれば見出しに従って読む（列の順番が違っても良い）', () => {
    const rows = parseLocationCsv('電話番号,住所,名称\r\n028-000-0000, 栃木県宇都宮市本町1-1 ,A商店\r\n');
    expect(rows).toEqual([{ rowNo: 2, name: 'A商店', address: '栃木県宇都宮市本町1-1', phone: '028-000-0000' }]);
  });

  it('見出しが無ければ「名称,住所,電話番号」の順として1行目から読む', () => {
    const rows = parseLocationCsv('AAA商事,栃木県鹿沼市朝日町123,0289-66-1234\r\nBBB建築,栃木県小山市片岡2-2-2,024-123-1111\r\n');
    expect(rows).toEqual([
      { rowNo: 1, name: 'AAA商事', address: '栃木県鹿沼市朝日町123', phone: '0289-66-1234' },
      { rowNo: 2, name: 'BBB建築', address: '栃木県小山市片岡2-2-2', phone: '024-123-1111' },
    ]);
  });

  it('電話番号の列が無くても読む', () => {
    expect(parseLocationCsv('name,address\nA,住所1\n')).toEqual([{ rowNo: 2, name: 'A', address: '住所1', phone: '' }]);
  });

  it('空のファイル・空行だけのファイルは0件', () => {
    expect(parseLocationCsv('')).toEqual([]);
    expect(parseLocationCsv('\r\n\r\n')).toEqual([]);
  });
});
