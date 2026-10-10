"use client";

import { useParams } from "next/navigation";
import { PersonDetail } from "./person-detail";

export default function PersonPage() {
  const params = useParams<{ userId: string }>();
  return <PersonDetail userId={Number(params.userId)} />;
}
