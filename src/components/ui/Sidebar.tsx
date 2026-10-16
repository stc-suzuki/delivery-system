'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { format } from 'date-fns';
import { signOut, useSession } from 'next-auth/react';
import {
  LayoutDashboard,
  Plus,
  ClipboardList,
  FilePlus2,
  Truck,
  Database,
  MapPin,
  Building2,
  Users,
  Boxes,
  Settings,
  LayoutGrid,
  Route,
  UserCog,
  ClipboardCheck,
  type LucideIcon,
} from 'lucide-react';
import { dayStatusKind, type DayCapacity } from '@/lib/capacityOverviewStatus';

type NavItem = { href: string; label: string; icon: LucideIcon };

const ROLE_RANK: Record<string, number> = {
  STAFF: 0,
  DELIVERY_ADMIN: 1,
  SYSTEM_ADMIN: 2,
};

const NAV_ZONE_1: NavItem[] = [
  { href: '/dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/plans', label: '配送計画一覧', icon: ClipboardList },
  { href: '/tracking', label: 'リアルタイム追跡', icon: MapPin },
];

const NAV_ZONE_2: NavItem[] = [
  { href: '/plans/new', label: '配送計画の作成', icon: FilePlus2 },
  { href: '/truck-schedule', label: '稼働トラックの登録', icon: Truck },
  { href: '/capacity-overview', label: '荷物受付状況の確認', icon: ClipboardCheck },
];

const MASTER_NAV_ITEMS: NavItem[] = [
  { href: '/drivers', label: 'ドライバー管理', icon: Users },
  { href: '/trucks', label: 'トラック管理', icon: Truck },
  { href: '/locations', label: '配送先管理', icon: Building2 },
  { href: '/products', label: '商品管理', icon: Boxes },
  { href: '/users', label: 'ユーザー管理', icon: UserCog },
  { href: '/settings', label: 'システム設定', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [capacityWarningCount, setCapacityWarningCount] = useState(0);
  const [capacityOverCount, setCapacityOverCount] = useState(0);
  const [capacityTimeOverCount, setCapacityTimeOverCount] = useState(0);

  const role = (session?.user as { role?: string } | undefined)?.role ?? 'STAFF';
  // セッション読み込み中は最も制限の強い表示にしておき、権限外のゾーンが一瞬見えるのを防ぐ
  const rank = status === 'authenticated' ? ROLE_RANK[role] ?? 0 : 0;
  const canSeeDeliveryZone = rank >= 1;
  const canSeeMasterZone = rank >= 2;

  useEffect(() => {
    let cancelled = false;
    function refresh() {
      fetch(`/api/pool?date=${format(new Date(), 'yyyy-MM-dd')}`)
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (cancelled || !data) return;
          const locationIds = new Set((data.unassignedStops ?? []).map((s: { locationId: string }) => s.locationId));
          setUnassignedCount(locationIds.size);
        })
        .catch(() => {});
    }
    refresh();
    // /pool画面での保存直後にもバッジを即時更新するため、pathname変更（画面遷移）に加えて
    // カスタムイベント（pool:updated）でも再取得する
    window.addEventListener('pool:updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('pool:updated', refresh);
    };
  }, [pathname]);

  // 「荷物受付状況の確認」メニューの注意/超過件数バッジ。配送管理者以上のみが見られる画面なので、
  // その権限がない間はAPIを叩かない
  useEffect(() => {
    if (!canSeeDeliveryZone) return;
    let cancelled = false;
    function refresh() {
      fetch('/api/capacity-overview')
        .then(res => (res.ok ? res.json() : null))
        .then((data: { days?: DayCapacity[] } | null) => {
          if (cancelled || !data?.days) return;
          setCapacityWarningCount(data.days.filter(d => dayStatusKind(d) === 'warning').length);
          setCapacityOverCount(data.days.filter(d => dayStatusKind(d) === 'over').length);
          setCapacityTimeOverCount(data.days.filter(d => d.overTime).length);
        })
        .catch(() => {});
    }
    refresh();
    window.addEventListener('pool:updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('pool:updated', refresh);
    };
  }, [pathname, canSeeDeliveryZone]);

  function isActive(href: string) {
    return href === '/plans' ? pathname === '/plans' : pathname?.startsWith(href);
  }

  function renderZoneItem(item: NavItem, tint: 'blue' | 'blueSoft' | 'gray', indent = false) {
    const active = isActive(item.href);
    const Icon = item.icon;
    const textClass = tint === 'gray' ? 'text-gray-800' : tint === 'blue' ? 'text-blue-900' : 'text-indigo-900';
    const activeClass = `bg-white shadow-sm ${textClass}`;
    const inactiveClass = `${textClass} hover:bg-white/60`;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`flex items-center justify-between gap-2 whitespace-nowrap rounded-md py-2 text-sm font-medium ${
          indent ? 'pl-5 pr-2.5' : 'px-2.5'
        } ${active ? activeClass : inactiveClass}`}
      >
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0" />
          {item.label}
        </span>
        {item.href === '/capacity-overview' && (capacityOverCount + capacityTimeOverCount > 0 || capacityWarningCount > 0) && (
          <span className="flex shrink-0 items-center gap-1">
            {capacityOverCount + capacityTimeOverCount > 0 && (
              <span
                title={`容積超過+時間超過: ${capacityOverCount + capacityTimeOverCount}日`}
                className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white"
              >
                {capacityOverCount + capacityTimeOverCount}
              </span>
            )}
            {capacityWarningCount > 0 && (
              <span
                title={`容積警告: ${capacityWarningCount}日`}
                className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white"
              >
                {capacityWarningCount}
              </span>
            )}
          </span>
        )}
      </Link>
    );
  }

  // 区分の見出し。アイコンはヘッダーと同じ形の色付きタイルに入れる
  function renderZoneLabel(Icon: LucideIcon, label: string, tint: 'blue' | 'blueSoft' | 'gray') {
    const tileClass = tint === 'gray' ? 'bg-gray-600' : tint === 'blue' ? 'bg-blue-600' : 'bg-indigo-600';
    const textClass = tint === 'gray' ? 'text-gray-800' : tint === 'blue' ? 'text-blue-900' : 'text-indigo-900';
    return (
      <p className={`flex items-center gap-2 px-1.5 pb-1.5 pt-0.5 text-sm font-semibold ${textClass}`}>
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white ${tileClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        {label}
      </p>
    );
  }

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-gray-200 bg-white">
      <div className="flex items-center gap-3 border-b border-gray-200 bg-blue-900 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
          <Route className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-base font-bold leading-tight text-white">配送管理システム</h1>
          <p className="text-[11px] tracking-wide text-blue-300">Delivery Manager · v0.9</p>
        </div>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto p-2">
        {/* 一般権限で唯一データを入力する画面のため、参照用の業務メニューとは分けてボタンとして置く */}
        <Link
          href="/pool"
          className={`flex items-center justify-between gap-2 whitespace-nowrap mt-4 rounded-md bg-blue-600 px-2.5 py-[5px] text-sm font-semibold text-white hover:bg-blue-700 ${
            isActive('/pool') ? 'ring-2 ring-blue-300 ring-offset-1' : ''
          }`}
        >
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4 shrink-0" />
            荷物を受け付ける
          </span>
          {unassignedCount > 0 && (
            <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-blue-600">
              {unassignedCount}
            </span>
          )}
        </Link>

        <div className="space-y-0.5 rounded-lg bg-blue-100 p-1.5">
          {renderZoneLabel(LayoutGrid, '業務メニュー', 'blue')}
          {NAV_ZONE_1.map(item => renderZoneItem(item, 'blue', true))}
        </div>

        {canSeeDeliveryZone && (
          <div className="space-y-0.5 rounded-lg bg-indigo-100 p-1.5">
            {renderZoneLabel(Route, '配送管理メニュー', 'blueSoft')}
            {NAV_ZONE_2.map(item => renderZoneItem(item, 'blueSoft', true))}
          </div>
        )}

        {canSeeMasterZone && (
          <div className="space-y-0.5 rounded-lg bg-gray-200 p-1.5">
            {renderZoneLabel(Database, 'マスタ管理メニュー', 'gray')}
            {MASTER_NAV_ITEMS.map(item => renderZoneItem(item, 'gray', true))}
          </div>
        )}
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
