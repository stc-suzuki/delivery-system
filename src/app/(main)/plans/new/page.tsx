'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';

export default function NewPlanPage() {
  const router = useRouter();
  const created = useRef(false);

  useEffect(() => {
    if (created.current) return;
    created.current = true;
    fetch('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planDate: format(new Date(), 'yyyy-MM-dd') }),
    })
      .then(res => res.json())
      .then(data => router.replace(`/plans/${data.id}`))
      .catch(() => router.replace('/plans'));
  }, [router]);

  return <p className="text-gray-500">作成中...</p>;
}
