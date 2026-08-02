'use client';

import { createContext, useContext, useEffect, useState } from 'react';

import { checkForUpdates, UpdateStatus } from '@/lib/version_check';

const VERSION_CHECK_CACHE_KEY = 'moontv-version-check';
const VERSION_CHECK_CACHE_TTL = 30 * 60 * 1000;

interface VersionCheckContextType {
  updateStatus: UpdateStatus | null;
  isChecking: boolean;
}

const VersionCheckContext = createContext<VersionCheckContextType>({
  updateStatus: null,
  isChecking: true,
});

export const useVersionCheck = () => useContext(VersionCheckContext);

export const VersionCheckProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let idleId: number | undefined;
    let timerId: ReturnType<typeof setTimeout> | undefined;

    const checkUpdate = async () => {
      const status = await checkForUpdates();
      if (cancelled) return;

      setUpdateStatus(status);
      setIsChecking(false);
      sessionStorage.setItem(
        VERSION_CHECK_CACHE_KEY,
        JSON.stringify({ status, checkedAt: Date.now() })
      );
    };

    try {
      const cached = JSON.parse(
        sessionStorage.getItem(VERSION_CHECK_CACHE_KEY) || 'null'
      ) as { status?: UpdateStatus; checkedAt?: number } | null;
      if (
        cached?.status &&
        cached.checkedAt &&
        Date.now() - cached.checkedAt < VERSION_CHECK_CACHE_TTL
      ) {
        setUpdateStatus(cached.status);
        setIsChecking(false);
        return;
      }
    } catch {
      sessionStorage.removeItem(VERSION_CHECK_CACHE_KEY);
    }

    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(() => void checkUpdate(), {
        timeout: 2000,
      });
    } else {
      timerId = setTimeout(() => void checkUpdate(), 500);
    }

    return () => {
      cancelled = true;
      if (idleId !== undefined && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== undefined) clearTimeout(timerId);
    };
  }, []);

  return (
    <VersionCheckContext.Provider value={{ updateStatus, isChecking }}>
      {children}
    </VersionCheckContext.Provider>
  );
};
