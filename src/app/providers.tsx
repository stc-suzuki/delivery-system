'use client';

import { SessionProvider } from 'next-auth/react';
import DialogProvider from '@/components/ui/DialogProvider';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <DialogProvider>{children}</DialogProvider>
    </SessionProvider>
  );
}
