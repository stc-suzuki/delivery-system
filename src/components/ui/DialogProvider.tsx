'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { HelpCircle, AlertTriangle, Info } from 'lucide-react';

type ConfirmOptions = {
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
};

type WarnOptions = {
  title?: string;
  confirmLabel?: string;
  variant?: 'warning' | 'info';
  footer?: string;
};

type ConfirmRequest = { kind: 'confirm'; message: string; options: ConfirmOptions; resolve: (value: boolean) => void };
type WarnRequest = { kind: 'warn'; messages: string[]; options: WarnOptions; resolve: () => void };
type Request = ConfirmRequest | WarnRequest;

interface DialogContextValue {
  confirmDialog: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  warnDialog: (messages: string | string[], options?: WarnOptions) => Promise<void>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within DialogProvider');
  return ctx;
}

const ICON_STYLES = {
  default: { wrap: 'bg-blue-100', icon: 'text-blue-600', Icon: HelpCircle },
  danger: { wrap: 'bg-red-100', icon: 'text-red-600', Icon: AlertTriangle },
  warning: { wrap: 'bg-amber-100', icon: 'text-amber-600', Icon: AlertTriangle },
  info: { wrap: 'bg-blue-100', icon: 'text-blue-600', Icon: Info },
} as const;

export default function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  // ダイアログを開く直前にフォーカスされていた要素を覚えておき、閉じるときに戻す。
  // これをしないと、確認ボタン（フォーカス中）がDOMから消えた瞬間にブラウザがフォーカスを
  // document.bodyへ移し、その副作用でスクロール位置が先頭にリセットされてしまう
  // （一覧の途中の配送先を操作していた場合、閉じるたびに先頭行に戻って見えるバグの原因）
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  function rememberFocus() {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function restoreFocus() {
    const el = previouslyFocusedRef.current;
    previouslyFocusedRef.current = null;
    if (el && document.body.contains(el)) {
      el.focus({ preventScroll: true });
    }
  }

  const confirmDialog = useCallback((message: string, options: ConfirmOptions = {}) => {
    rememberFocus();
    return new Promise<boolean>(resolve => {
      setRequest({ kind: 'confirm', message, options, resolve });
    });
  }, []);

  const warnDialog = useCallback((messages: string | string[], options: WarnOptions = {}) => {
    rememberFocus();
    return new Promise<void>(resolve => {
      setRequest({ kind: 'warn', messages: Array.isArray(messages) ? messages : [messages], options, resolve });
    });
  }, []);

  useEffect(() => {
    if (!request) return;
    primaryButtonRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || !request) return;
      if (request.kind === 'confirm') {
        request.resolve(false);
      } else {
        request.resolve();
      }
      setRequest(null);
      restoreFocus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  function close(request: Request) {
    if (request.kind === 'confirm') {
      request.resolve(false);
    } else {
      request.resolve();
    }
    setRequest(null);
    restoreFocus();
  }

  function accept(request: Request) {
    if (request.kind === 'confirm') {
      request.resolve(true);
    } else {
      request.resolve();
    }
    setRequest(null);
    restoreFocus();
  }

  return (
    <DialogContext.Provider value={{ confirmDialog, warnDialog }}>
      {children}
      {request && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => close(request)}
        >
          {request.kind === 'confirm' ? (
            <div
              className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg"
              role="alertdialog"
              aria-modal="true"
              onClick={e => e.stopPropagation()}
            >
              <ConfirmBody request={request} />
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => close(request)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {request.options.cancelLabel ?? 'キャンセル'}
                </button>
                <button
                  ref={primaryButtonRef}
                  type="button"
                  onClick={() => accept(request)}
                  className={`rounded-md px-4 py-2 text-sm font-medium text-white ${
                    request.options.variant === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {request.options.confirmLabel ?? (request.options.variant === 'danger' ? '削除する' : 'OK')}
                </button>
              </div>
            </div>
          ) : (
            <div
              className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg"
              role="alertdialog"
              aria-modal="true"
              onClick={e => e.stopPropagation()}
            >
              <WarnBody request={request} />
              <div className="mt-4 flex justify-end">
                <button
                  ref={primaryButtonRef}
                  type="button"
                  onClick={() => accept(request)}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  {request.options.confirmLabel ?? '確認しました'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </DialogContext.Provider>
  );
}

function ConfirmBody({ request }: { request: ConfirmRequest }) {
  const style = ICON_STYLES[request.options.variant === 'danger' ? 'danger' : 'default'];
  const Icon = style.Icon;
  return (
    <div className="flex items-start gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${style.wrap}`}>
        <Icon className={`h-5 w-5 ${style.icon}`} aria-hidden="true" />
      </div>
      <p className="whitespace-pre-line text-sm leading-relaxed text-gray-800">{request.message}</p>
    </div>
  );
}

function WarnBody({ request }: { request: WarnRequest }) {
  const style = ICON_STYLES[request.options.variant === 'info' ? 'info' : 'warning'];
  const Icon = style.Icon;
  const defaultTitle = request.options.variant === 'info' ? 'お知らせ' : '以下の点にご注意ください';
  return (
    <div>
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${style.wrap}`}>
          <Icon className={`h-5 w-5 ${style.icon}`} aria-hidden="true" />
        </div>
        <p className="pt-1.5 text-sm font-medium text-gray-800">{request.options.title ?? defaultTitle}</p>
      </div>
      {request.messages.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {request.messages.map((m, i) => (
            <li key={i} className="whitespace-pre-line rounded-md bg-gray-50 px-3 py-2 text-sm leading-relaxed text-gray-700">
              {m}
            </li>
          ))}
        </ul>
      )}
      {request.options.footer && (
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-gray-600">{request.options.footer}</p>
      )}
    </div>
  );
}
