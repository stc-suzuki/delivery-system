// 本番の起動手順（npm start）で、ログインの安全に関わる設定が本番向けになっているかを確かめる。
// server.ts が起動前に呼び、errors が1件でもあれば起動しない

/** NEXTAUTH_SECRET（ログインの暗号鍵）に求める最低の長さ。npm run secret:generate は64文字を作る */
export const MIN_SECRET_LENGTH = 32;

export type ProductionConfigCheck = {
  /** 起動を止めるもの */
  errors: string[];
  /** 起動はするが知らせるもの */
  warnings: string[];
};

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  );
}

export function checkProductionConfig(env: Record<string, string | undefined>): ProductionConfigCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  const secret = env.NEXTAUTH_SECRET?.trim() ?? '';
  if (!secret) {
    errors.push('NEXTAUTH_SECRET（ログインの暗号鍵）が設定されていません。npm run secret:generate で作った値を設定してください');
  } else if (secret.length < MIN_SECRET_LENGTH) {
    errors.push(
      `NEXTAUTH_SECRET（ログインの暗号鍵）が短すぎます（${secret.length}文字。${MIN_SECRET_LENGTH}文字以上が必要）。npm run secret:generate で作った値に替えてください`,
    );
  }

  const url = env.NEXTAUTH_URL?.trim() ?? '';
  if (!url) {
    warnings.push('NEXTAUTH_URL（このシステムの正式なURL）が設定されていません');
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && !isLocalHost(parsed.hostname)) {
        warnings.push(
          `NEXTAUTH_URL が https ではありません（${url}）。ドライバー画面の位置情報は https でないと動きません`,
        );
      }
    } catch {
      errors.push(`NEXTAUTH_URL の形式が正しくありません（${url}）`);
    }
  }

  return { errors, warnings };
}
