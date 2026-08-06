"use client";

import { UserPlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/common/modal";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { UserList, UserListItem } from "@/lib/types";
import { userDisplayName } from "../helpers";

export function AddMemberModal({
  open,
  onOpenChange,
  existing,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: number[];
  onAdd: (userId: number, user?: UserListItem) => void;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserListItem[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setSearching(true);
    const handle = setTimeout(() => {
      api
        .get<UserList>("/api/users", { query: { q: query || undefined, limit: 20 } })
        .then((r) => {
          if (active) setResults(r.users);
        })
        .catch((err) => {
          if (active) toast.error(err instanceof ApiError ? err.message : t("couldNotSearchUsers"));
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query, open, t]);

  const existingSet = new Set(existing);

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) setQuery("");
      }}
      icon={UserPlusIcon}
      title={t("addMemberLabel")}
    >
      <div className="space-y-3">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchUsersEllipsisPlaceholder")}
        />
        <div className="max-h-72 overflow-y-auto">
          {searching && results.length === 0 ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : results.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {t("noUsersFoundPeriod")}
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {results.map((user) => {
                const already = existingSet.has(user.id);
                return (
                  <li key={user.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{userDisplayName(user, t)}</p>
                      <p className="text-muted-foreground truncate text-xs">{user.email}</p>
                    </div>
                    <Button
                      size="sm"
                      variant={already ? "ghost" : "outline"}
                      disabled={already}
                      onClick={() => onAdd(user.id, user)}
                    >
                      {already ? t("added") : t("addAction")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
