// 配送先管理の地図で手で指定した位置（緯度・経度）の受け取り。/api/locations のPOST・PATCHから使う。

// 日本の範囲（おおよそ）。地図の誤操作で海外や0,0が登録されるのを防ぐ
const JAPAN_BOUNDS = { minLat: 20, maxLat: 46, minLng: 122, maxLng: 154 };

export type ManualPositionResult =
  | { ok: true; position: { lat: number; lng: number } | null }
  | { ok: false; error: string };

// lat・lngが両方とも未指定ならnull（＝住所検索で決める）。片方だけ・数値でない・日本の範囲外はエラー
export function parseManualPosition(lat: unknown, lng: unknown): ManualPositionResult {
  if (lat == null && lng == null) return { ok: true, position: null };
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: '地図で指定した位置（緯度・経度）が正しくありません' };
  }
  if (lat < JAPAN_BOUNDS.minLat || lat > JAPAN_BOUNDS.maxLat || lng < JAPAN_BOUNDS.minLng || lng > JAPAN_BOUNDS.maxLng) {
    return { ok: false, error: '地図で指定した位置が日本の範囲外です' };
  }
  return { ok: true, position: { lat, lng } };
}
