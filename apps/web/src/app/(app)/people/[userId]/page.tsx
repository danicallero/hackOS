"use client";

import { useParams, useSearchParams } from "next/navigation";
import { PersonDetail } from "./person-detail";

export default function PersonPage() {
  const params = useParams<{ userId: string }>();
  const search = useSearchParams();
  return <PersonDetail userId={Number(params.userId)} companyId={Number(search.get("company"))} />;
}
