import { describe, expect, it } from 'vitest';
import { parseManualPosition } from './locationPosition';

describe('parseManualPosition（地図で指定した配送先の位置）', () => {
  it('両方とも未指定なら、住所検索で決める（null）', () => {
    expect(parseManualPosition(undefined, undefined)).toEqual({ ok: true, position: null });
    expect(parseManualPosition(null, null)).toEqual({ ok: true, position: null });
  });

  it('日本の範囲内の数値なら、その位置を使う', () => {
    expect(parseManualPosition(36.3145, 139.8003)).toEqual({ ok: true, position: { lat: 36.3145, lng: 139.8003 } });
  });

  it('片方だけ・数値でない値はエラー', () => {
    expect(parseManualPosition(36.3, undefined).ok).toBe(false);
    expect(parseManualPosition('36.3', '139.8').ok).toBe(false);
    expect(parseManualPosition(Number.NaN, 139.8).ok).toBe(false);
  });

  it('日本の範囲外（0,0や緯度経度の取り違え）はエラー', () => {
    expect(parseManualPosition(0, 0).ok).toBe(false);
    expect(parseManualPosition(139.8, 36.3).ok).toBe(false);
  });
});
