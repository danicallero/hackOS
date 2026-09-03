"use client";

import jsQR from "jsqr";
import { CameraIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

/** True only when this browser exposes a camera the page can request. */
export function hasCameraSupport(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * Camera QR scan as an alternate way to fill the same search box a station
 * operator would otherwise type or paste into — it feeds the existing lookup
 * flow rather than a lookup path of its own. Samples video frames onto a
 * canvas and decodes them with jsQR on a requestAnimationFrame loop; the
 * stream is torn down on close/unmount.
 */
export function QrScanButton({ onDecode }: { onDecode: (value: string) => void }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        tick();
      } catch {
        if (!cancelled) setError(t("cameraAccessFailed"));
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
      if (code?.data) {
        onDecode(code.data);
        setOpen(false);
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    }

    void start();
    return () => {
      cancelled = true;
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
    };
  }, [open, onDecode, t]);

  if (!hasCameraSupport()) return null;

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <CameraIcon className="size-4" />
        {t("openCamera")}
      </Button>
      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError("");
        }}
        title={t("openCamera")}
        size="sm"
      >
        <div className="space-y-3">
          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : (
            <div className="relative overflow-hidden rounded-lg bg-black">
              <video
                ref={videoRef}
                className="aspect-square w-full object-cover"
                muted
                playsInline
              />
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" />
          <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(false)}>
            <XIcon className="size-4" />
            {t("cancel")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
