import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Check, CircleAlert, Clock3, LoaderCircle, Plus, Save, Trash2, X } from "lucide-react";
import { useProfiles } from "../features/profiles/profile-context";
import {
  createCalendarJob,
  loadCalendarState,
  removeCalendarJob,
  rescheduleCalendarJob,
  saveProviderSchedule,
  type CalendarJobRow,
  type CalendarState,
  type CalendarVariantRow,
} from "../features/calendar/calendar-store";
import {
  SOCIAL_PROVIDERS,
  WEEK_DAYS,
  clampPostsPerWeek,
  formatZonedDateTime,
  isoToZonedInput,
  normalizePreferredSlots,
  zonedLocalToIso,
  type PreferredSlot,
  type SocialProvider,
} from "../features/calendar/calendar-workflow";
import "../calendar.css";

type ScheduleDraft = {
  provider: SocialProvider;
  timezone: string;
  postsPerWeek: number;
  preferredSlots: PreferredSlot[];
  autoChoose: boolean;
  enabled: boolean;
};
type ScheduleSaveStatus = "SAVED" | "WAITING" | "SAVING" | "ERROR";

function providerLabel(provider: string) {
  return SOCIAL_PROVIDERS.find((item) => item.value === provider)?.label ?? provider;
}

function makeScheduleDraft(provider: SocialProvider, timezone: string, state: CalendarState): ScheduleDraft {
  const row = state.schedules.find((schedule) => schedule.provider === provider);
  return {
    provider,
    timezone: row?.timezone || timezone || "Europe/Rome",
    postsPerWeek: row?.posts_per_week ?? 3,
    preferredSlots: normalizePreferredSlots(row?.preferred_slots),
    autoChoose: row?.auto_choose ?? false,
    enabled: row?.enabled ?? true,
  };
}

function variantTitle(variant: CalendarVariantRow, state: CalendarState) {
  const title = state.contentTitles[variant.content_id] || variant.hook || "Contenuto";
  return `${providerLabel(variant.provider)} · ${variant.format} · ${title}`;
}

export function CalendarPage() {
  const { selectedProfile } = useProfiles();
  const [state, setState] = useState<CalendarState>({ schedules: [], variants: [], jobs: [], contentTitles: {} });
  const [drafts, setDrafts] = useState<Record<SocialProvider, ScheduleDraft> | null>(null);
  const [scheduleSaveStatus, setScheduleSaveStatus] = useState<Record<SocialProvider, ScheduleSaveStatus> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [variantId, setVariantId] = useState("");
  const [scheduleLocal, setScheduleLocal] = useState("");
  const [jobTimes, setJobTimes] = useState<Record<string, string>>({});
  const draftsRef = useRef<Record<SocialProvider, ScheduleDraft> | null>(null);
  const scheduleTimersRef = useRef<Partial<Record<SocialProvider, ReturnType<typeof setTimeout>>>>({});

  const reload = useCallback(async () => {
    if (!selectedProfile) return;
    setLoading(true);
    setError(null);
    try {
      const next = await loadCalendarState(selectedProfile.id);
      const approved = next.variants.filter((variant) => variant.eligible && variant.approval_status === "APPROVED");
      const nextDrafts = Object.fromEntries(SOCIAL_PROVIDERS.map(({ value }) => [value, makeScheduleDraft(value, selectedProfile.timezone, next)])) as Record<SocialProvider, ScheduleDraft>;
      setState(next);
      setDrafts(nextDrafts);
      draftsRef.current = nextDrafts;
      setScheduleSaveStatus(Object.fromEntries(SOCIAL_PROVIDERS.map(({ value }) => [value, "SAVED"])) as Record<SocialProvider, ScheduleSaveStatus>);
      setJobTimes(Object.fromEntries(next.jobs.map((job) => [job.id, isoToZonedInput(job.scheduled_at, selectedProfile.timezone)])));
      setVariantId((current) => current && approved.some((variant) => variant.id === current) ? current : approved[0]?.id ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossibile caricare il calendario.");
    } finally {
      setLoading(false);
    }
  }, [selectedProfile]);

  useEffect(() => { void reload(); }, [reload]);

  const variantMap = useMemo(() => new Map(state.variants.map((variant) => [variant.id, variant])), [state.variants]);
  const approvedVariants = useMemo(() => state.variants.filter((variant) => variant.eligible && variant.approval_status === "APPROVED"), [state.variants]);

  async function run(key: string, task: () => Promise<void>, success?: string) {
    if (busy[key]) return;
    setBusy((current) => ({ ...current, [key]: true }));
    setError(null);
    setNotice(null);
    try {
      await task();
      if (success) setNotice(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Operazione non riuscita.");
    } finally {
      setBusy((current) => ({ ...current, [key]: false }));
    }
  }

  async function persistSchedule(provider: SocialProvider, draft = draftsRef.current?.[provider]) {
    if (!selectedProfile || !draft) return;
    const timer = scheduleTimersRef.current[provider];
    if (timer) clearTimeout(timer);
    delete scheduleTimersRef.current[provider];
    setScheduleSaveStatus((current) => current ? ({ ...current, [provider]: "SAVING" }) : current);
    try {
      await saveProviderSchedule({
        profileId: selectedProfile.id,
        provider,
        timezone: draft.timezone,
        postsPerWeek: draft.postsPerWeek,
        preferredSlots: draft.preferredSlots,
        autoChoose: draft.autoChoose,
        enabled: draft.enabled,
      });
      setScheduleSaveStatus((current) => current ? ({ ...current, [provider]: "SAVED" }) : current);
    } catch (reason) {
      setScheduleSaveStatus((current) => current ? ({ ...current, [provider]: "ERROR" }) : current);
      throw reason;
    }
  }

  function queueSchedule(provider: SocialProvider, draft: ScheduleDraft) {
    const timer = scheduleTimersRef.current[provider];
    if (timer) clearTimeout(timer);
    setScheduleSaveStatus((current) => current ? ({ ...current, [provider]: "WAITING" }) : current);
    scheduleTimersRef.current[provider] = setTimeout(() => {
      void persistSchedule(provider, draft).catch((reason) => setError(reason instanceof Error ? reason.message : "Salvataggio frequenza non riuscito."));
    }, 500);
  }

  function patchDraft(provider: SocialProvider, patch: Partial<ScheduleDraft>) {
    setDrafts((current) => {
      if (!current) return current;
      const nextDraft = { ...current[provider], ...patch };
      const next = { ...current, [provider]: nextDraft };
      draftsRef.current = next;
      queueSchedule(provider, nextDraft);
      return next;
    });
  }

  useEffect(() => () => {
    const current = draftsRef.current;
    if (!current) return;
    for (const { value } of SOCIAL_PROVIDERS) {
      const timer = scheduleTimersRef.current[value];
      if (!timer) continue;
      clearTimeout(timer);
      void persistSchedule(value, current[value]).catch(() => undefined);
    }
  }, []);

  function addSlot(provider: SocialProvider) {
    const draft = drafts?.[provider];
    if (!draft) return;
    patchDraft(provider, { preferredSlots: normalizePreferredSlots([...draft.preferredSlots, { day: 1, time: "09:00" }]) });
  }

  function patchSlot(provider: SocialProvider, index: number, patch: Partial<PreferredSlot>) {
    const draft = drafts?.[provider];
    if (!draft) return;
    const next = draft.preferredSlots.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot);
    patchDraft(provider, { preferredSlots: next });
  }

  function removeSlot(provider: SocialProvider, index: number) {
    const draft = drafts?.[provider];
    if (!draft) return;
    patchDraft(provider, { preferredSlots: draft.preferredSlots.filter((_, slotIndex) => slotIndex !== index) });
  }

  async function scheduleVariant() {
    if (!selectedProfile || !variantId || !scheduleLocal) return;
    await run("new-job", async () => {
      const scheduledAt = zonedLocalToIso(scheduleLocal, selectedProfile.timezone);
      await createCalendarJob({ profileId: selectedProfile.id, variantId, scheduledAt });
      setScheduleLocal("");
      await reload();
    }, "Contenuto inserito nel calendario. Non verrà pubblicato finché le API social non saranno collegate.");
  }

  async function reschedule(job: CalendarJobRow) {
    if (!selectedProfile) return;
    const local = jobTimes[job.id];
    if (!local) return;
    await run(`job-${job.id}`, async () => {
      const scheduledAt = zonedLocalToIso(local, selectedProfile.timezone);
      await rescheduleCalendarJob({ profileId: selectedProfile.id, jobId: job.id, scheduledAt });
      await reload();
    }, "Programmazione aggiornata.");
  }

  async function removeJob(job: CalendarJobRow) {
    if (!selectedProfile) return;
    await run(`remove-${job.id}`, async () => {
      await removeCalendarJob(selectedProfile.id, job.id);
      await reload();
    }, "Programmazione rimossa.");
  }

  if (!selectedProfile) return null;
  if (loading || !drafts || !scheduleSaveStatus) return <div className="page-content"><p>Caricamento calendario…</p></div>;

  return <div className="page-content">
    <header className="page-header">
      <div><p className="eyebrow">Calendario · {selectedProfile.name}</p><h1>Frequenze e programmazione</h1><p>Frequenze e preferenze vengono salvate automaticamente.</p></div>
    </header>

    <section className="calendar-warning"><CircleAlert size={20} /><div><strong>Programmazione reale, pubblicazione social non ancora attiva</strong><p>Le date vengono salvate davvero nel database. I contenuti restano nello stato interno “SCHEDULED” e non possono essere inviati ai social finché OAuth e pubblicazione reale non saranno collegati.</p></div></section>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}

    <section className="calendar-section">
      <div className="section-heading"><div><h2>Frequenza per social</h2><p>Configura separatamente quante pubblicazioni settimanali vuoi per questo profilo.</p></div></div>
      <div className="schedule-card-grid">
        {SOCIAL_PROVIDERS.map(({ value, label }) => {
          const draft = drafts[value];
          const saveState = scheduleSaveStatus[value];
          return <article className="schedule-card" key={value} onBlurCapture={() => void persistSchedule(value).catch((reason) => setError(reason instanceof Error ? reason.message : "Salvataggio frequenza non riuscito."))}>
            <header><div><strong>{label}</strong><span>{draft.enabled ? "Attivo" : "Pausa"}</span></div><label className="switch-control"><input type="checkbox" checked={draft.enabled} onChange={(event) => patchDraft(value, { enabled: event.target.checked })} /><span>Abilitato</span></label></header>
            <div className="schedule-fields">
              <label>Post a settimana<input type="number" min={0} max={21} inputMode="numeric" value={draft.postsPerWeek} onChange={(event) => patchDraft(value, { postsPerWeek: clampPostsPerWeek(event.target.value) })} /></label>
              <label>Fuso orario<input value={draft.timezone} onChange={(event) => patchDraft(value, { timezone: event.target.value })} /></label>
            </div>
            <label className="auto-choice"><input type="checkbox" checked={draft.autoChoose} onChange={(event) => patchDraft(value, { autoChoose: event.target.checked })} /> Permetti al sistema di scegliere tra gli slot preferiti quando l’apprendimento sarà attivo.</label>
            <div className="preferred-slots">
              <div className="preferred-slots-header"><strong>Slot preferiti</strong><button type="button" className="text-button" onClick={() => addSlot(value)}><Plus size={15} /> Aggiungi</button></div>
              {draft.preferredSlots.length === 0 ? <p className="muted-small">Nessuno slot preferito: la frequenza resta salvata, ma non viene inventato un orario.</p> : null}
              {draft.preferredSlots.map((slot, index) => <div className="slot-row" key={`${value}-${index}`}>
                <select value={slot.day} onChange={(event) => patchSlot(value, index, { day: Number(event.target.value) })}>{WEEK_DAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select>
                <input type="time" value={slot.time} onChange={(event) => patchSlot(value, index, { time: event.target.value })} />
                <button className="slot-delete" type="button" aria-label="Rimuovi slot" onClick={() => removeSlot(value, index)}><X size={16} /></button>
              </div>)}
            </div>
            <span className={`autosave-mini ${saveState.toLowerCase()}`}>{saveState === "WAITING" || saveState === "SAVING" ? <><LoaderCircle className="spin" size={12} /> Salvataggio…</> : saveState === "ERROR" ? "Errore salvataggio" : <><Check size={12} /> Salvato automaticamente</>}</span>
          </article>;
        })}
      </div>
    </section>

    <section className="calendar-section panel">
      <div className="section-heading"><div><h2>Programma un contenuto approvato</h2><p>Solo le varianti idonee e già approvate possono entrare nel calendario.</p></div><CalendarClock size={22} /></div>
      {approvedVariants.length === 0 ? <div className="empty-calendar"><Check size={20} /><div><strong>Nessuna variante approvata disponibile</strong><p>Approva prima un contenuto nella sezione Revisioni.</p></div></div> : <div className="calendar-compose">
        <label>Contenuto<select value={variantId} onChange={(event) => setVariantId(event.target.value)}>{approvedVariants.map((variant) => <option value={variant.id} key={variant.id}>{variantTitle(variant, state)}</option>)}</select></label>
        <label>Data e ora ({selectedProfile.timezone})<input type="datetime-local" value={scheduleLocal} onChange={(event) => setScheduleLocal(event.target.value)} /></label>
        <button className="primary-button" type="button" disabled={!variantId || !scheduleLocal || busy["new-job"]} onClick={() => void scheduleVariant()}><CalendarClock size={16} /> {busy["new-job"] ? "Programmazione…" : "Aggiungi al calendario"}</button>
      </div>}
    </section>

    <section className="calendar-section">
      <div className="section-heading"><div><h2>Contenuti in calendario</h2><p>{state.jobs.length} programmazioni interne per questo profilo.</p></div></div>
      {state.jobs.length === 0 ? <div className="panel empty-calendar"><Clock3 size={20} /><div><strong>Calendario vuoto</strong><p>Nessun contenuto è ancora stato programmato.</p></div></div> : <div className="calendar-job-list">
        {state.jobs.map((job) => {
          const variant = variantMap.get(job.variant_id);
          const title = variant ? variantTitle(variant, state) : `${providerLabel(job.provider)} · contenuto`;
          const blocked = job.state === "BLOCKED_APPROVAL";
          return <article className={`calendar-job ${blocked ? "calendar-job-blocked" : ""}`} key={job.id}>
            <div className="calendar-job-main"><span className={blocked ? "blocked-badge" : "scheduled-badge"}>{blocked ? "Sospeso: approvazione richiesta" : "Programmato internamente"}</span><h3>{title}</h3><p>{formatZonedDateTime(job.scheduled_at, selectedProfile.timezone)} · {selectedProfile.timezone}</p><small>{blocked ? "Il contenuto è stato modificato o riaperto. Riapprovalo prima di poter confermare nuovamente la data." : "Nessun tentativo di pubblicazione verrà eseguito prima del collegamento reale del social."}</small></div>
            <div className="calendar-job-actions"><input aria-label={`Nuova data per ${title}`} type="datetime-local" value={jobTimes[job.id] ?? ""} onChange={(event) => setJobTimes((current) => ({ ...current, [job.id]: event.target.value }))} /><button className="secondary-button" type="button" disabled={blocked || busy[`job-${job.id}`]} onClick={() => void reschedule(job)}><Save size={15} /> {blocked ? "Riapprova prima" : "Sposta"}</button><button className="danger-outline-button" type="button" disabled={busy[`remove-${job.id}`]} onClick={() => void removeJob(job)}><Trash2 size={15} /> Rimuovi</button></div>
          </article>;
        })}
      </div>}
    </section>
  </div>;
}
