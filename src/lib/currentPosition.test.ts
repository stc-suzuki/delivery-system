import { describe, expect, it } from 'vitest';
import { resolveCurrentPosition } from './currentPosition';

const depot = { lat: 36.5657, lng: 139.8836 };
const gps = { lat: 36.7, lng: 139.9 };
const stop = { lat: 36.4, lng: 140.0 };

describe('resolveCurrentPosition（出発済みのトラックの今いる場所）', () => {
  it('帰社済みなら、位置情報や配達完了地点があっても本社', () => {
    expect(resolveCurrentPosition({ atDepot: true, lastLog: gps, lastCompletedStop: stop }, depot)).toEqual(depot);
  });

  it('帰社前は、最後に送られてきた位置を配達完了地点より優先する', () => {
    expect(resolveCurrentPosition({ atDepot: false, lastLog: gps, lastCompletedStop: stop }, depot)).toEqual(gps);
  });

  it('位置情報がなければ、最後に配達完了を押した配送先', () => {
    expect(resolveCurrentPosition({ atDepot: false, lastLog: null, lastCompletedStop: stop }, depot)).toEqual(stop);
  });

  it('どれも無ければ本社', () => {
    expect(resolveCurrentPosition({ atDepot: false, lastLog: null, lastCompletedStop: null }, depot)).toEqual(depot);
  });
});
