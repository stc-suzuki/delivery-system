// ログインの暗号鍵（NEXTAUTH_SECRET）に使う、推測できないランダムな値を作って表示する。
// 使い方: npm run secret:generate
// 表示された値を本番の .env.local の NEXTAUTH_SECRET= の後ろに貼る。値はどこにも保存しない
import { randomBytes } from 'node:crypto';

// 48バイト＝384ビット。base64url（英数字と - _ だけ）で64文字になり、.env にそのまま書ける
const secret = randomBytes(48).toString('base64url');
console.log(secret);
