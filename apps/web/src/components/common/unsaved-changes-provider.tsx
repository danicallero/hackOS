"use client";

import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { useLocale } from "@/lib/i18n";

export const UnsavedChangesContext = createContext({
  register: (_owner: object) => () => {},
  confirm: (): Promise<boolean> => Promise.resolve(false),
  navigate: (_href: string) => {},
});

const confirmationEvent = "hackos:confirm-discard";

/** In-page decisions use the same asynchronous alert as navigation (#1180). */
export function requestDiscardConfirmation(): Promise<boolean> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent(confirmationEvent, { detail: resolve }));
  });
}

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const router = useContext(AppRouterContext);
  const { t } = useLocale();
  const owners = useRef(new Set<object>());
  const pending = useRef<{ promise: Promise<boolean>; resolve: (value: boolean) => void } | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const navigating = useRef(false);
  const register = useCallback((owner: object) => {
    owners.current.add(owner);
    return () => {
      owners.current.delete(owner);
    };
  }, []);
  const confirm = useCallback(() => {
    if (pending.current) return pending.current.promise;
    let resolve!: (value: boolean) => void;
    const promise = new Promise<boolean>((done) => {
      resolve = done;
    });
    pending.current = { promise, resolve };
    setOpen(true);
    return promise;
  }, []);
  const settle = useCallback((accepted: boolean) => {
    const decision = pending.current;
    pending.current = null;
    setOpen(false);
    decision?.resolve(accepted);
  }, []);
  useEffect(() => {
    const onRequest = (event: Event) => {
      void confirm().then((event as CustomEvent<(value: boolean) => void>).detail);
    };
    window.addEventListener(confirmationEvent, onRequest);
    return () => {
      window.removeEventListener(confirmationEvent, onRequest);
      pending.current?.resolve(false);
      pending.current = null;
    };
  }, [confirm]);
  const guardedRouter = useMemo(() => {
    if (!router) return null;
    const navigate = async (
      method: "push" | "replace",
      href: string,
      options?: Parameters<typeof router.push>[1],
    ) => {
      if (new URL(href, window.location.href).href === window.location.href) return;
      if (navigating.current) return;
      navigating.current = true;
      try {
        if (owners.current.size && !(await confirm())) return;
        if (new URL(href, window.location.href).href === window.location.href) return;
        router[method](href, options);
      } finally {
        navigating.current = false;
      }
    };
    return {
      ...router,
      push: (href: string, options?: Parameters<typeof router.push>[1]) => {
        void navigate("push", href, options);
      },
      replace: (href: string, options?: Parameters<typeof router.replace>[1]) => {
        void navigate("replace", href, options);
      },
    };
  }, [router, confirm]);
  const navigate = useCallback(
    (href: string) => {
      if (href === window.location.href) return;
      if (router) router.push(href);
      else window.location.assign(href);
    },
    [router],
  );
  const value = useMemo(() => ({ register, confirm, navigate }), [register, confirm, navigate]);
  return (
    <UnsavedChangesContext.Provider value={value}>
      <AppRouterContext.Provider value={guardedRouter}>
        {children}
        <AlertModal
          open={open}
          onOpenChange={(next) => {
            if (!next) settle(false);
          }}
          title={t("unsavedChanges")}
          description={t("unsavedChangesConfirm")}
          cancelLabel={t("keepEditing")}
          confirmLabel={t("discardLibraryChanges")}
          destructive
          onConfirm={() => settle(true)}
        />
      </AppRouterContext.Provider>
    </UnsavedChangesContext.Provider>
  );
}
