"use client";

import { UserPlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "@/components/common/modal";
import { Spinner } from "@/components/common/spinner";
import { type UserOption, UserPicker } from "@/components/common/user-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { UserList, UserListItem } from "@/lib/types";

const PICKER_ID = "add-member-user-picker";

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
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserListItem | null>(null);
  const [adding, setAdding] = useState(false);

  const existingSet = useMemo(() => new Set(existing), [existing]);

  const search = useMemo(
    () =>
      async (query: string): Promise<UserOption[]> => {
        const result = await api.get<UserList>("/api/users", {
          query: { q: query || undefined, limit: 20 },
        });
        return result.users.filter((user) => !existingSet.has(user.id));
      },
    [existingSet],
  );

  function reset() {
    setSelectedUserId("");
    setSelectedUser(null);
  }

  async function handleAdd() {
    if (!selectedUserId) return;
    setAdding(true);
    try {
      onAdd(Number(selectedUserId), selectedUser ?? undefined);
      reset();
    } finally {
      setAdding(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) reset();
      }}
      icon={UserPlusIcon}
      title={t("addMemberLabel")}
    >
      <div className="space-y-3">
        <Label htmlFor={PICKER_ID}>{t("addMemberLabel")}</Label>
        <UserPicker
          id={PICKER_ID}
          value={selectedUserId}
          onChange={(value, user) => {
            setSelectedUserId(value);
            setSelectedUser(user as UserListItem | null);
          }}
          search={search}
          inDialog
        />
        <Button disabled={!selectedUserId || adding} onClick={handleAdd}>
          {adding && <Spinner />}
          {t("addAction")}
        </Button>
      </div>
    </Modal>
  );
}
