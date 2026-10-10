"use client";

import { type ComponentProps, useCallback, useEffect, useRef } from "react";
import { type UserOption, UserPicker } from "@/components/common/user-picker";
import { api } from "@/lib/api";
import {
  type CandidateFetcher,
  type ImportedIdentity,
  safeSuggestion,
  searchIdentityCandidates,
} from "./identity-matches";

export const fetchMemberCandidates: CandidateFetcher = async (q, limit) =>
  (
    await api.get<{ users: UserOption[] }>("/api/projects/member-candidates", {
      query: { q, limit },
    })
  ).users;

/**
 * `UserPicker` props for linking an imported person to an account (H17). The
 * first result set after the picker opens with its empty query may preselect
 * one safe suggestion; once the operator has typed or chosen, it never does.
 */
export function useIdentityPicker(
  person: ImportedIdentity,
  value: string,
  onChange: (value: string, user: UserOption | null) => void,
  fetchUsers: CandidateFetcher,
) {
  const personRef = useRef(person);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const fetchRef = useRef(fetchUsers);
  useEffect(() => {
    personRef.current = person;
    valueRef.current = value;
    onChangeRef.current = onChange;
    fetchRef.current = fetchUsers;
  });
  const completeByQuery = useRef(new Map<string, boolean>());
  const attempted = useRef(false);

  const search = useCallback(async (query: string) => {
    const result = await searchIdentityCandidates(personRef.current, query, fetchRef.current);
    completeByQuery.current.set(query, result.complete);
    return result.users;
  }, []);

  const onResults = useCallback((query: string, users: UserOption[]) => {
    if (attempted.current) return;
    attempted.current = true;
    if (query || valueRef.current) return;
    const suggested = safeSuggestion(
      personRef.current,
      users,
      completeByQuery.current.get(query) ?? false,
    );
    if (suggested) onChangeRef.current(String(suggested.id), suggested);
  }, []);

  return { search, onResults };
}

/** Account picker for an imported person, with profile-based suggestions (H17). */
export function IdentityAccountPicker({
  person,
  value,
  onChange,
  fetchUsers = fetchMemberCandidates,
  ...props
}: { person: ImportedIdentity; fetchUsers?: CandidateFetcher } & Omit<
  ComponentProps<typeof UserPicker>,
  "search" | "onResults" | "minQueryLength"
>) {
  const { search, onResults } = useIdentityPicker(person, value, onChange, fetchUsers);
  return (
    <UserPicker
      {...props}
      value={value}
      onChange={onChange}
      search={search}
      onResults={onResults}
    />
  );
}
