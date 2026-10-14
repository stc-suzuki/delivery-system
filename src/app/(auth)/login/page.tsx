'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await signIn('credentials', {
      name,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError('名前またはパスワードが正しくありません');
      return;
    }
    router.push(callbackPath());
    router.refresh();
  }

  // ログイン前に開こうとしていた画面へ戻る。ミドルウェアが付けるcallbackUrlは「/plans/xxx?date=...」の
  // ような相対パス。外部サイトへ飛ばされないよう、「/」始まり（「//」始まりは除く）の場合だけ使う
  function callbackPath(): string {
    const callbackUrl = new URLSearchParams(window.location.search).get('callbackUrl');
    if (callbackUrl && callbackUrl.startsWith('/') && !callbackUrl.startsWith('//')) {
      return callbackUrl;
    }
    return '/dashboard';
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 overflow-hidden rounded-lg bg-white p-8 pt-0 shadow"
      >
        <h1 className="-mx-8 mb-4 bg-blue-900 px-8 py-4 text-xl font-bold text-center text-white">配送管理システム Ver0.9</h1>
        {error && (
          <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700">名前</label>
          <input
            type="text"
            required
            value={name}
            onChange={e => setName(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">パスワード</label>
          <input
            type="password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'ログイン中...' : 'ログイン'}
        </button>
      </form>
    </div>
  );
}
