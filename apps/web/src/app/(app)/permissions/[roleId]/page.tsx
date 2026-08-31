"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

// H8: the role editor used to live at its own route; it's now the right-hand
// panel of the single master-detail /permissions page (selection is
// ?role=<id>, not a navigation). This route survives only as a redirect so
// existing deep links — e.g. a user's permissions tab linking to one of
// their roles — keep working.
export default function RoleRedirectPage() {
  const router = useRouter();
  const params = useParams<{ roleId: string }>();

  useEffect(() => {
    router.replace(`/permissions?role=${params.roleId}`);
  }, [router, params.roleId]);

  return null;
}
