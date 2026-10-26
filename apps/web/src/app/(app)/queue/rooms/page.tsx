"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { RoomManagement } from "@/components/queue/room-management";

export default function QueueRoomsPage() {
  const router = useRouter();
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "window") {
      router.replace("/settings/event?tab=judging");
    }
  }, [router]);
  return <RoomManagement />;
}
