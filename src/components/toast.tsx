"use client";

import { createContext, useCallback, useContext, useState } from "react";
import clsx from "clsx";

interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: "default" | "success" | "alert";
}

const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x, { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 4200);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-[min(92vw,380px)] -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-5 sm:translate-x-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pop pointer-events-auto rounded-2xl px-4 py-3 shadow-[0_18px_40px_-16px_rgba(43,16,48,0.55)]",
              t.tone === "success" ? "bg-stem text-white" : t.tone === "alert" ? "bg-peony text-white" : "bg-ink text-paper",
            )}
          >
            <p className="text-sm font-semibold">{t.title}</p>
            {t.body && <p className="mt-0.5 text-[13px] opacity-80">{t.body}</p>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
