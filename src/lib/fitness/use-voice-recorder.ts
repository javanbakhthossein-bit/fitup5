"use client";

import { useState, useRef, useCallback } from "react";

/**
 * Hook برای ضبط صدا از میکروفون و تبدیل به متن
 * استفاده: const { isRecording, startRecording, stopRecording } = useVoiceRecorder(onTranscript);
 * دسترسی میکروفون فقط هنگام کلیک روی دکمه درخواست می‌شود.
 */
export function useVoiceRecorder(onTranscript: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      // ─── قطع موقت موزیک جیم مود هنگام ضبط ویس ───
      const gymAudio = document.querySelector("audio[data-gym-music]") as HTMLAudioElement | null;
      if (gymAudio && !gymAudio.paused) {
        gymAudio.pause();
        gymAudio.dataset.wasPlaying = "true";
      }

      // درخواست دسترسی به میکروفون — فقط هنگام کلیک کاربر
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());

        // ─── فعال‌سازی مجدد موزیک جیم مود پس از ضبط ───
        try {
          const gymAudio = document.querySelector("audio[data-gym-music]") as HTMLAudioElement | null;
          if (gymAudio && gymAudio.dataset.wasPlaying === "true") {
            gymAudio.play().catch(() => {});
            delete gymAudio.dataset.wasPlaying;
          }
        } catch {}

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size < 1000) return; // خیلی کوتاه

        setIsProcessing(true);
        try {
          const formData = new FormData();
          formData.append("audio", blob, "voice.webm");
          const res = await fetch("/api/coach/voice", {
            method: "POST",
            body: formData,
          });
          const data = await res.json();
          if (data.text && data.text.trim()) {
            onTranscript(data.text.trim());
          }
        } catch {
          setError("خطا در تبدیل صدا به متن");
        } finally {
          setIsProcessing(false);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (e: any) {
      if (e.name === "NotAllowedError") {
        setError("دسترسی به میکروفون رد شد. لطفاً در تنظیمات مرورگر اجازه دهید.");
      } else if (e.name === "NotFoundError") {
        setError("میکروفون یافت نشد.");
      } else {
        setError("خطا در دسترسی به میکروفون.");
      }
    }
  }, [onTranscript]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  return { isRecording, isProcessing, error, startRecording, stopRecording };
}
