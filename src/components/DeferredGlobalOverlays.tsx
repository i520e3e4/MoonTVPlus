'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

const ChatFloatingWindow = dynamic(
  () => import('./watch-room/ChatFloatingWindow'),
  { ssr: false }
);
const DownloadBubble = dynamic(
  () => import('./DownloadBubble').then((module) => module.DownloadBubble),
  { ssr: false }
);
const DownloadPanel = dynamic(
  () => import('./DownloadPanel').then((module) => module.DownloadPanel),
  { ssr: false }
);

export function DeferredGlobalOverlays() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number }
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(() => setReady(true), {
        timeout: 1500,
      });
      return () => idleWindow.cancelIdleCallback?.(id);
    }

    const timeout = window.setTimeout(() => setReady(true), 500);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!ready) return null;

  return (
    <>
      <ChatFloatingWindow />
      <DownloadBubble />
      <DownloadPanel />
    </>
  );
}
