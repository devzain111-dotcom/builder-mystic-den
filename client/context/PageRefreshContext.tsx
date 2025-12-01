import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface PageRefreshContext {
  registerRefreshHandler: (handler: () => Promise<void>) => void;
  unregisterRefreshHandler: () => void;
  isRefreshing: boolean;
  refreshPage: () => Promise<void>;
}

const RefreshContext = createContext<PageRefreshContext | null>(null);

export function PageRefreshProvider({ children }: { children: ReactNode }) {
  const [refreshHandler, setRefreshHandler] = useState<
    (() => Promise<void>) | null
  >(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const registerRefreshHandler = useCallback(
    (handler: () => Promise<void>) => {
      setRefreshHandler(() => handler);
    },
    [],
  );

  const unregisterRefreshHandler = useCallback(() => {
    setRefreshHandler(null);
  }, []);

  const refreshPage = useCallback(async () => {
    if (!refreshHandler) return;
    try {
      setIsRefreshing(true);
      await refreshHandler();
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshHandler]);

  return (
    <RefreshContext.Provider
      value={{
        registerRefreshHandler,
        unregisterRefreshHandler,
        isRefreshing,
        refreshPage,
      }}
    >
      {children}
    </RefreshContext.Provider>
  );
}

export function usePageRefresh() {
  const ctx = useContext(RefreshContext);
  if (!ctx) {
    console.warn(
      "[usePageRefresh] Context not found - ensure component is wrapped with PageRefreshProvider",
    );
    return {
      registerRefreshHandler: () => {},
      unregisterRefreshHandler: () => {},
      isRefreshing: false,
      refreshPage: async () => {},
    };
  }
  return ctx;
}
