'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'ダッシュボード' },
  { href: '/locations', label: '配送先管理' },
  { href: '/drivers', label: 'ドライバー管理' },
  { href: '/trucks', label: 'トラック管理' },
  { href: '/plans', label: '配送計画' },
  { href: '/tracking', label: 'リアルタイム追跡' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-4">
        <h1 className="text-base font-bold text-gray-800">配送管理システム</h1>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {NAV_ITEMS.map(item => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded px-3 py-2 text-sm font-medium ${
                active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-gray-200 p-2">
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="block w-full rounded px-3 py-2 text-left text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          ログアウト
        </button>
      </div>
    </aside>
  );
}
