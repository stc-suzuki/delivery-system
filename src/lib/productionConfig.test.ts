import { describe, expect, it } from 'vitest';
import { checkProductionConfig, MIN_SECRET_LENGTH } from './productionConfig';

const LONG_SECRET = 'a'.repeat(MIN_SECRET_LENGTH);

describe('checkProductionConfig', () => {
  it('長い暗号鍵と https のURLなら問題なし', () => {
    expect(checkProductionConfig({ NEXTAUTH_SECRET: LONG_SECRET, NEXTAUTH_URL: 'https://delivery.example.jp' })).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('暗号鍵が無ければ起動を止める', () => {
    const result = checkProductionConfig({ NEXTAUTH_URL: 'https://delivery.example.jp' });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('設定されていません');
  });

  it('空白だけの暗号鍵も無いものとして扱う', () => {
    expect(checkProductionConfig({ NEXTAUTH_SECRET: '   ', NEXTAUTH_URL: 'https://x.jp' }).errors).toHaveLength(1);
  });

  it('暗号鍵が32文字未満なら起動を止める（開発用の短い値の使い回しを防ぐ）', () => {
    const result = checkProductionConfig({ NEXTAUTH_SECRET: 'a'.repeat(MIN_SECRET_LENGTH - 1), NEXTAUTH_URL: 'https://x.jp' });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('短すぎます');
  });

  it('https でないURLは警告するが止めない', () => {
    const result = checkProductionConfig({ NEXTAUTH_SECRET: LONG_SECRET, NEXTAUTH_URL: 'http://delivery.example.jp' });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it('手元（localhost）は http でも警告しない', () => {
    for (const url of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://app.localhost:3000']) {
      expect(checkProductionConfig({ NEXTAUTH_SECRET: LONG_SECRET, NEXTAUTH_URL: url }).warnings).toEqual([]);
    }
  });

  it('URLが無ければ警告、形式が壊れていれば止める', () => {
    expect(checkProductionConfig({ NEXTAUTH_SECRET: LONG_SECRET }).warnings).toHaveLength(1);
    expect(checkProductionConfig({ NEXTAUTH_SECRET: LONG_SECRET, NEXTAUTH_URL: 'delivery' }).errors).toHaveLength(1);
  });
});
