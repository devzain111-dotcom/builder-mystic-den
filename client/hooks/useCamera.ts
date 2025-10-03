import { useCallback, useEffect, useRef, useState } from "react";

export interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement>;
  isActive: boolean;
  isSupported: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  capture: () => Promise<string>;
  switchCamera: () => Promise<void>;
}

export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSupported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const start = useCallback(async () => {
    if (!isSupported) { setError("الكاميرا غير مدعومة على هذا المتصفح"); return; }
    if (typeof window !== "undefined" && location.protocol !== "https:" && location.hostname !== "localhost") {
      setError("يلزم HTTPS لتشغيل الكاميرا على الهاتف"); return;
    }
    try {
      setError(null);
      // Close previous stream if any
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const tryGet = (c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c);
      let stream: MediaStream | null = null;
      // 1) Prefer front camera
      try { stream = await tryGet({ video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
      catch (err: any) {
        // 2) Fallback to back camera
        try { stream = await tryGet({ video: { facingMode: { ideal: "environment" } }, audio: false }); }
        catch (e2) {
          // 3) Any camera
          stream = await tryGet({ video: true, audio: false });
        }
      }
      // 4) If permitted, pick explicit front device when available
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const vids = devices.filter((d) => d.kind === "videoinput");
        const front = vids.find((d) => /front|face|وجه/i.test(d.label));
        const currentLabel = stream?.getVideoTracks()[0]?.label || "";
        if (front && !/front|face|وجه/i.test(currentLabel)) {
          stream?.getTracks().forEach((t) => t.stop());
          stream = await tryGet({ video: { deviceId: { exact: front.deviceId } }, audio: false });
        }
      } catch {}

      if (!stream) throw new Error("no-stream");
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.setAttribute("playsinline", "");
        videoRef.current.setAttribute("autoplay", "");
        (videoRef.current as any).srcObject = stream;
        await videoRef.current.play().catch(()=>{});
        setIsActive(true);
      }
    } catch (e: any) {
      if (e?.name === "NotAllowedError") setError("رُفض الإذن بالكاميرا. افتح الإعدادات واسمح بالكاميرا للموقع");
      else if (e?.name === "NotFoundError") setError("لا توجد كاميرا متاحة على هذا الجهاز");
      else setError("فشل تشغيل الكاميرا (تحقق من الأذونات)");
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
