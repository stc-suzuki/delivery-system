import { format } from 'date-fns';
import { RefreshCw } from 'lucide-react';

type Props = {
  onRefresh: () => void;
  refreshing: boolean;
  updatedAt: Date | null;
  failed?: boolean;
};

// 「更新」ボタンと最終更新時刻。押すと画面を開き直さずにデータだけ読み直す
export default function RefreshButton({ onRefresh, refreshing, updatedAt, failed }: Props) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        更新
      </button>
      {failed ? (
        <span className="text-xs text-red-600">更新に失敗しました</span>
      ) : (
        updatedAt && <span className="text-xs text-gray-500">最終更新 {format(updatedAt, 'HH:mm')}</span>
      )}
    </div>
  );
}
