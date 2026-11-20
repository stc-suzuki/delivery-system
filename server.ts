import { createServer, type IncomingMessage } from 'http';
import { loadEnvConfig } from '@next/env';
import next from 'next';
import { getToken } from 'next-auth/jwt';
import { Server } from 'socket.io';
import { setIO } from './src/lib/socket';
import { checkProductionConfig } from './src/lib/productionConfig';

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

// ブラウザからの接続は、このシステム自身の画面（同じホスト）からのものだけを受け付ける。
// WebSocketはCORSの制限を受けないため、Originヘッダーで明示的に確認する
function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const dev = process.env.NODE_ENV !== 'production';

// 本番の起動手順では、設定ファイル（.env.local など）を先に読み、ログインの暗号鍵などが本番向けになっているかを
// 起動前に確かめる（仕様書8.6節）。.env.local の読み込みは本来Nextが行うが、それでは待ち受け設定（HOSTNAME・PORT）を
// 読む時点に間に合わないため、ここで先に読む（同じ内容を読むだけ。すでに環境変数にある値は上書きしない）
if (!dev) {
  loadEnvConfig(process.cwd(), false);
  const { errors, warnings } = checkProductionConfig(process.env);
  for (const message of warnings) console.warn(`[設定の注意] ${message}`);
  if (errors.length > 0) {
    for (const message of errors) console.error(`[設定の誤り] ${message}`);
    console.error('本番の起動を中止しました。仕様書8.6節を参照してください');
    process.exit(1);
  }
}

const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = Number(process.env.PORT) || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // URLの分解はNext側に任せる（以前はNode.jsの古いurl.parse()で分けて渡しており、起動のたびに
  // 非推奨の警告（DEP0169）が出ていた）
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  const io = new Server(httpServer, {
    path: '/api/socket',
    allowRequest: (req, callback) => callback(null, isSameOrigin(req)),
  });

  // リアルタイム配信（追跡画面の地図）はNextのミドルウェアを通らないため、
  // 接続時にここでログイン済みかを確認する。受け取るのは業務メニューの追跡画面だけで、ドライバー画面は接続しない
  io.use(async (socket, nextMiddleware) => {
    const token = await getToken({
      req: { cookies: parseCookies(socket.request.headers.cookie), headers: socket.request.headers } as unknown as Parameters<typeof getToken>[0]['req'],
      secret: process.env.NEXTAUTH_SECRET,
    }).catch(() => null);
    if (!token) {
      nextMiddleware(new Error('ログインが必要です'));
      return;
    }
    nextMiddleware();
  });

  io.on('connection', socket => {
    console.log('クライアント接続:', socket.id);
    socket.on('disconnect', () => {
      console.log('クライアント切断:', socket.id);
    });
  });

  setIO(io);

  // 待ち受けに失敗した場合（ポートが使用中など）は、理由を表示して終了する
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[起動の失敗] ポート${port}は別のプログラムが使っています。前に起動したものが動いたままでないか確かめるか、PORT を変えてください`);
    } else {
      console.error('[起動の失敗]', err);
    }
    process.exit(1);
  });

  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
