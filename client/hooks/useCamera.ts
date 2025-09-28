import { useCallback, useEffect, useRef, useState } from "react";

export interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement>;
  isActive: boolean;
  isSupported: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  capture: () => Promise<string>;
}

export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSupported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const start = useCallback(async () => {
    if (!isSupported) {
      setError("الكاميرا غير مدعومة على هذا المتصفح");
      return;
    }
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsActive(true);
      }
    } catch (e) {
      setError("فشل تشغيل الكاميرا (تحقق من الأذونات)");
      setIsActive(false);
    }
  }, [isSupported]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch {}
      (videoRef.current as any).srcObject = null;
    }
    setIsActive(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) throw new Error("لا توجد معاينة للكاميرا");
    const canvas = document.createElement("canvas");
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("تعذر إنشاء لوحة الرسم");
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.92);
  }, []);

  return { videoRef, isActive, isSupported, error, start, stop, capture };
}
