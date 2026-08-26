import { useCallback, useEffect, useRef, useState } from "react";

export type AutoSaveStatus = "IDLE" | "WAITING" | "SAVING" | "SAVED" | "ERROR";

export function useAutoSaveDraft<T>(save: (draft: T) => Promise<void>, delayMs = 550) {
  const [draft, setDraftState] = useState<T | null>(null);
  const [status, setStatus] = useState<AutoSaveStatus>("IDLE");
  const [error, setError] = useState<string | null>(null);
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const draftRef = useRef<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);

  useEffect(() => { saveRef.current = save; }, [save]);

  const replaceDraft = useCallback((next: T) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    draftRef.current = next;
    setDraftState(next);
    versionRef.current += 1;
    savedVersionRef.current = versionRef.current;
    setError(null);
    setStatus("SAVED");
  }, []);

  const setDraft = useCallback((updater: T | ((current: T) => T)) => {
    setDraftState((current) => {
      if (current === null) return current;
      const next = typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
      draftRef.current = next;
      return next;
    });
    versionRef.current += 1;
    setError(null);
    setStatus("WAITING");
  }, []);

  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const current = draftRef.current;
    const version = versionRef.current;
    if (current === null || version <= savedVersionRef.current) return;
    setStatus("SAVING");
    try {
      await saveRef.current(current);
      savedVersionRef.current = Math.max(savedVersionRef.current, version);
      if (versionRef.current === version) setStatus("SAVED");
      else setStatus("WAITING");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Salvataggio automatico non riuscito.");
      setStatus("ERROR");
      throw reason;
    }
  }, []);

  useEffect(() => {
    if (draft === null || versionRef.current <= savedVersionRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void flush().catch(() => undefined); }, delayMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [draft, delayMs, flush]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const current = draftRef.current;
    if (current !== null && versionRef.current > savedVersionRef.current) void saveRef.current(current).catch(() => undefined);
  }, []);

  return { draft, replaceDraft, setDraft, flush, status, error };
}
