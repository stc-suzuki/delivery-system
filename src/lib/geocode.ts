// 国土地理院（GSI）の住所検索APIを使用。APIキー・請求先登録が不要な無料サービス
export async function geocodeAddress(address: string) {
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(address)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ジオコーディング失敗: 該当する住所が見つかりませんでした');
  }
  const [lng, lat] = data[0].geometry.coordinates;
  const formattedAddress = data[0].properties.title as string;
  return { lat, lng, formattedAddress };
}
