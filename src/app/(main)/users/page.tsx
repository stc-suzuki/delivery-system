'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { format } from 'date-fns';
import { UserCog } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useDialog } from '@/components/ui/DialogProvider';

type Role = 'SYSTEM_ADMIN' | 'DELIVERY_ADMIN' | 'STAFF';

type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
};

const ROLE_LABELS: Record<Role, string> = {
  SYSTEM_ADMIN: 'システム管理者',
  DELIVERY_ADMIN: '配送管理者',
  STAFF: '一般ユーザー',
};

export default function UsersPage() {
  const { data: session } = useSession();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id;
  const { confirmDialog, warnDialog } = useDialog();
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('STAFF');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function fetchUsers() {
    const res = await fetch('/api/users');
    setUsers(await res.json());
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  function startEdit(u: User) {
    setEditingId(u.id);
    setEmail(u.email);
    setPassword('');
    setName(u.name);
    setRole(u.role);
  }

  function resetForm() {
    setEditingId(null);
    setEmail('');
    setPassword('');
    setName('');
    setRole('STAFF');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (!editingId && !password) {
        throw new Error('パスワードを入力してください');
      }
      const url = editingId ? `/api/users/${editingId}` : '/api/users';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, role, ...(password && { password }) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      resetForm();
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(u: User) {
    if (!(await confirmDialog(`「${u.name}」を削除しますか？この操作は取り消せません。`, { variant: 'danger' }))) return;
    setDeletingId(u.id);
    try {
      const res = await fetch(`/api/users/${u.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (editingId === u.id) resetForm();
      fetchUsers();
    } catch (err) {
      await warnDialog(err instanceof Error ? err.message : '削除に失敗しました', { title: '削除できませんでした' });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UserCog}
        title="ユーザー管理"
        description="システムにログインできるユーザーの登録・権限を管理します。"
        tint="gray"
      />

      <div className="rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">{editingId ? 'ユーザー編集' : '新規登録'}</h2>
        {error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <input
            required
            placeholder="名前"
            value={name}
            onChange={e => setName(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="email"
            placeholder="メールアドレス"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            type="password"
            placeholder={editingId ? '変更する場合のみ入力' : 'パスワード'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <select
            value={role}
            onChange={e => setRole(e.target.value as Role)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="SYSTEM_ADMIN">システム管理者</option>
            <option value="DELIVERY_ADMIN">配送管理者</option>
            <option value="STAFF">一般ユーザー</option>
          </select>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '保存中...' : editingId ? '更新' : '登録'}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200">
                キャンセル
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#E5EAF2] bg-[#F2F5F9] shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">名前</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">メールアドレス</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">権限</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">登録日</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map(u => (
              <tr key={u.id}>
                <td className="px-4 py-2">{u.name}</td>
                <td className="px-4 py-2">{u.email}</td>
                <td className="px-4 py-2">{ROLE_LABELS[u.role]}</td>
                <td className="px-4 py-2">{format(new Date(u.createdAt), 'yyyy/MM/dd')}</td>
                <td className="flex gap-3 px-4 py-2">
                  <button onClick={() => startEdit(u)} className="text-xs text-blue-600 hover:underline">
                    編集
                  </button>
                  {u.id !== currentUserId ? (
                    <button
                      onClick={() => handleDelete(u)}
                      disabled={deletingId === u.id}
                      className="text-xs text-red-500 hover:underline disabled:opacity-50"
                    >
                      {deletingId === u.id ? '削除中...' : '削除'}
                    </button>
                  ) : (
                    <span className="text-xs text-gray-600" title="ログイン中の自分自身は削除できません">
                      （自分）
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
