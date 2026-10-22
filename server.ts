import { createServer, type IncomingMessage } from 'http';
import next from 'next';
import { getToken } from 'next-auth/jwt';
import { Server } from 'socket.io';
import { setIO } from './src/lib/socket';

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

  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
