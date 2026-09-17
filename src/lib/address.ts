// 住所文字列から市区町村を抽出する。都道府県名を除いた先頭部分から、
// 「〇〇郡△△町/村」または「〇〇市/区」までを市区町村として扱う。
// 抽出できない場合は空文字を返す（呼び出し側でフォールバック値を判断する）
export function extractCity(address: string): string {
  const withoutPrefecture = address.replace(/^.{2,3}[都道府県]/, '');
  const match = withoutPrefecture.match(/^.+?郡.+?[町村]|^.+?[市区]/);
  return match ? match[0] : '';
}
