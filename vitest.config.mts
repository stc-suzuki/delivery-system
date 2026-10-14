import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 計算部分（src/lib）の自動テスト用の設定。`npm test` で全件を実行する。
// 時刻を扱うテストが実行環境のタイムゾーンに左右されないよう、npm scripts側で TZ=Asia/Tokyo を指定している
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
