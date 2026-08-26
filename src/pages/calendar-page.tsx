import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Clock3, Plus, Trash2, X } from "lucide-react";
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

type MonthCursor = { year: number; month: number };
type DayCell = { day: number; key: string; weekend: boolean; today: boolean } | null;

const WEEK_HEADERS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

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
    autoChoose: row?.auto_choose ?? true,
    enabled: row?.enabled ?? true,
  };
}

function variantTitle(variant: CalendarVariantRow, state: CalendarState) {
  return state.contentTitles[variant.content_id] || variant.hook || "Contenuto";
}

function zonedDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: map.hour || "00",
    minute: map.minute || "00",
  };
}

function dateKeyFromInstant(value: string, timezone: string) {
  const parts = zonedDateParts(new Date(value), timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function monthFromTimezone(timezone: string): MonthCursor {
  const parts = zonedDateParts(new Date(), timezone);
  return { year: parts.year, month: parts.month - 1 };
}

function monthLabel(cursor: MonthCursor) {
  const label = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(cursor.year, cursor.month, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function buildMonthCells(cursor: MonthCursor, timezone: string): DayCell[] {
  const daysInMonth = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
  const firstUtcDay = new Date(Date.UTC(cursor.year, cursor.month, 1)).getUTCDay();
  const mondayOffset = (firstUtcDay + 6) % 7;
  const todayParts = zonedDateParts(new Date(), timezone);
  const cells: DayCell[] = Array.from({ length: mondayOffset }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const utcDay = new Date(Date.UTC(cursor.year, cursor.month, day)).getUTCDay();
    const mondayIndex = (utcDay + 6) % 7;
    cells.push({
      day,
      key: `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      weekend: mondayIndex >= 5,
      today: todayParts.year === cursor.year && todayParts.month === cursor.month + 1 && todayParts.day === day,
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function timeLabel(value: string, timezone: string) {
  const parts = zonedDateParts(new Date(value), timezone);
  return `${parts.hour}:${parts.minute}`;
}

export function CalendarPage() {
  const { selectedProfile } = useProfiles();
  const [state, setState] = useState<CalendarState>({ schedules: [], variants: [], jobs: [], contentTitles: {} });
  const [drafts, setDrafts] = useState<Record<SocialProvider, ScheduleDraft> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [variantId, setVariantId] = useState("");
  const [scheduleLocal, setScheduleLocal] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobTimes, setJobTimes] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<MonthCursor>(() => monthFromTimezone("Europe/Rome"));
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
      setJobTimes(Object.fromEntries(next.jobs.map((job) => [job.id, isoToZonedInput(job.scheduled_at, selectedProfile.timezone)])));
      setVariantId((current) => current && approved.some((variant) => variant.id === current) ? current : approved[0]?.id ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossibile caricare il calendario.");
    } finally {
      setLoading(false);
    }
  }, [selectedProfile]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (selectedProfile) setCursor(monthFromTimezone(selectedProfile.timezone));
  }, [selectedProfile?.id, selectedProfile?.timezone]);

  const variantMap = useMemo(() => new Map(state.variants.map((variant) => [variant.id, variant])), [state.variants]);
  const approvedVariants = useMemo(() => state.variants.filter((variant) => variant.eligible && variant.approval_status === "APPROVED"), [state.variants]);
  const monthCells = useMemo(() => selectedProfile ? buildMonthCells(cursor, selectedProfile.timezone) : [], [cursor, selectedProfile]);
  const jobsByDate = useMemo(() => {
    if (!selectedProfile) return new Map<string, CalendarJobRow[]>();
    const map = new Map<string, CalendarJobRow[]>();
    for (const job of state.jobs) {
      const key = dateKeyFromInstant(job.scheduled_at, selectedProfile.timezone);
      map.set(key, [...(map.get(key) ?? []), job]);
    }
    return map;
  }, [state.jobs, selectedProfile]);
  const selectedJob = selectedJobId ? state.jobs.find((job) => job.id === selectedJobId) ?? null : null;

  async function run(key: string, task: () => Promise<void>) {
    if (busy[key]) return;
    setBusy((current) => ({ ...current, [key]: true }));
    setError(null);
    try { await task(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Operazione non riuscita."); }
    finally { setBusy((current) => ({ ...current, [key]: false })); }
  }

  async function persistSchedule(provider: SocialProvider, draft = draftsRef.current?.[provider]) {
    if (!selectedProfile || !draft) return;
    const timer = scheduleTimersRef.current[provider];
    if (timer) clearTimeout(timer);
    delete scheduleTimersRef.current[provider];
    await saveProviderSchedule({
      profileId: selectedProfile.id,
      provider,
      timezone: draft.timezone,
      postsPerWeek: draft.postsPerWeek,
      preferredSlots: draft.preferredSlots,
      autoChoose: draft.autoChoose,
      enabled: draft.enabled,
    });
  }

  function queueSchedule(provider: SocialProvider, draft: ScheduleDraft) {
    const timer = scheduleTimersRef.current[provider];
    if (timer) clearTimeout(timer);
    scheduleTimersRef.current[provider] = setTimeout(() => {
      void persistSchedule(provider, draft).catch((reason) => setError(reason instanceof Error ? reason.message : "Salvataggio frequenza non riuscito."));
    }, 450);
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

  function changeMonth(delta: number) {
    setCursor((current) => {
      const date = new Date(Date.UTC(current.year, current.month + delta, 1));
      return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
    });
  }

  async function scheduleVariant() {
    if (!selectedProfile || !variantId || !scheduleLocal) return;
    await run("new-job", async () => {
      const scheduledAt = zonedLocalToIso(scheduleLocal, selectedProfile.timezone);
      await createCalendarJob({ profileId: selectedProfile.id, variantId, scheduledAt });
      setScheduleLocal("");
      await reload();
    });
  }

  async function reschedule(job: CalendarJobRow) {
    if (!selectedProfile) return;
    const local = jobTimes[job.id];
    if (!local) return;
    await run(`job-${job.id}`, async () => {
      await rescheduleCalendarJob({ profileId: selectedProfile.id, jobId: job.id, scheduledAt: zonedLocalToIso(local, selectedProfile.timezone) });
      setSelectedJobId(null);
      await reload();
    });
  }

  async function removeJob(job: CalendarJobRow) {
    if (!selectedProfile) return;
    await run(`remove-${job.id}`, async () => {
      await removeCalendarJob(selectedProfile.id, job.id);
      setSelectedJobId(null);
      await reload();
    });
  }

  if (!selectedProfile) return null;
  if (loading || !drafts) return <div className="page-content"><p>Caricamento calendario…</p></div>;

  return <div className="page-content calendar-page">
    <header className="page-header calendar-page-header">
      <div><p className="eyebrow">Calendario · {selectedProfile.name}</p><h1>Calendario contenuti</h1><p>Qui vedi cosa è previsto giorno per giorno. Sabato e domenica sono evidenziati, ma restano giorni pubblicabili.</p></div>
    </header>

    {error && <p className="form-error" role="alert">{error}</p>}

    <section className="month-calendar panel">
      <header className="month-toolbar">
        <div className="month-navigation"><button type="button" className="calendar-icon-button" onClick={() => changeMonth(-1)} aria-label="Mese precedente"><ChevronLeft size={18} /></button><h2>{monthLabel(cursor)}</h2><button type="button" className="calendar-icon-button" onClick={() => changeMonth(1)} aria-label="Mese successivo"><ChevronRight size={18} /></button></div>
        <button type="button" className="today-button" onClick={() => setCursor(monthFromTimezone(selectedProfile.timezone))}>Oggi</button>
      </header>

      <div className="month-scroll">
        <div className="month-grid">
          {WEEK_HEADERS.map((label, index) => <div className={`weekday-header ${index >= 5 ? "weekend" : ""}`} key={label}>{label}</div>)}
          {monthCells.map((cell, index) => {
            if (!cell) return <div className="calendar-day outside" key={`blank-${index}`} />;
            const jobs = jobsByDate.get(cell.key) ?? [];
            return <div className={`calendar-day ${cell.weekend ? "weekend" : ""} ${cell.today ? "today" : ""}`} key={cell.key}>
              <div className="day-number-row"><span className="day-number">{cell.day}</span>{cell.today && <small>Oggi</small>}</div>
              <div className="day-events">{jobs.map((job) => {
                const variant = variantMap.get(job.variant_id);
                const blocked = job.state === "BLOCKED_APPROVAL";
                return <button type="button" className={`calendar-event provider-${job.provider.toLowerCase()} ${blocked ? "blocked" : ""}`} key={job.id} onClick={() => setSelectedJobId(job.id)}>
                  <span>{timeLabel(job.scheduled_at, selectedProfile.timezone)} · {providerLabel(job.provider)}</span>
                  <strong>{variant ? variantTitle(variant, state) : "Contenuto"}</strong>
                </button>;
              })}</div>
            </div>;
          })}
        </div>
      </div>
    </section>

    {selectedJob && <section className="panel selected-calendar-item">
      <div><small>{providerLabel(selectedJob.provider)}</small><h2>{variantMap.get(selectedJob.variant_id) ? variantTitle(variantMap.get(selectedJob.variant_id)!, state) : "Contenuto programmato"}</h2><p>{selectedJob.state === "BLOCKED_APPROVAL" ? "Questo contenuto richiede una nuova approvazione." : "Puoi spostarlo o rimuoverlo dal calendario."}</p></div>
      <div className="selected-calendar-actions"><input type="datetime-local" value={jobTimes[selectedJob.id] ?? ""} onChange={(event) => setJobTimes((current) => ({ ...current, [selectedJob.id]: event.target.value }))} /><button type="button" className="secondary-button" disabled={selectedJob.state === "BLOCKED_APPROVAL" || busy[`job-${selectedJob.id}`]} onClick={() => void reschedule(selectedJob)}>Sposta</button><button type="button" className="danger-outline-button" disabled={busy[`remove-${selectedJob.id}`]} onClick={() => void removeJob(selectedJob)}><Trash2 size={15} /> Rimuovi</button><button type="button" className="calendar-icon-button" onClick={() => setSelectedJobId(null)} aria-label="Chiudi"><X size={17} /></button></div>
    </section>}

    <details className="panel calendar-settings">
      <summary>Frequenza automatica</summary>
      <p className="calendar-settings-intro">Imposta quante volte vuoi pubblicare per social. Le modifiche vengono memorizzate senza pulsanti di salvataggio.</p>
      <div className="schedule-card-grid compact-schedules">{SOCIAL_PROVIDERS.map(({ value, label }) => {
        const draft = drafts[value];
        return <article className="schedule-card" key={value} onBlurCapture={() => void persistSchedule(value).catch((reason) => setError(reason instanceof Error ? reason.message : "Salvataggio frequenza non riuscito."))}>
          <header><div><strong>{label}</strong><span>{draft.enabled ? "Attivo" : "Pausa"}</span></div><label className="switch-control"><input type="checkbox" checked={draft.enabled} onChange={(event) => patchDraft(value, { enabled: event.target.checked })} /><span>Abilitato</span></label></header>
          <div className="schedule-fields"><label>Post a settimana<input type="number" min={0} max={21} inputMode="numeric" value={draft.postsPerWeek} onChange={(event) => patchDraft(value, { postsPerWeek: clampPostsPerWeek(event.target.value) })} /></label><label>Fuso orario<input value={draft.timezone} onChange={(event) => patchDraft(value, { timezone: event.target.value })} /></label></div>
          <label className="auto-choice"><input type="checkbox" checked={draft.autoChoose} onChange={(event) => patchDraft(value, { autoChoose: event.target.checked })} /> Lascia scegliere al sistema i momenti migliori tra gli slot disponibili.</label>
          <div className="preferred-slots"><div className="preferred-slots-header"><strong>Slot preferiti</strong><button type="button" className="text-button" onClick={() => addSlot(value)}><Plus size={15} /> Aggiungi</button></div>{draft.preferredSlots.map((slot, index) => <div className="slot-row" key={`${value}-${index}`}><select value={slot.day} onChange={(event) => patchSlot(value, index, { day: Number(event.target.value) })}>{WEEK_DAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select><input type="time" value={slot.time} onChange={(event) => patchSlot(value, index, { time: event.target.value })} /><button className="slot-delete" type="button" aria-label="Rimuovi slot" onClick={() => removeSlot(value, index)}><X size={16} /></button></div>)}</div>
        </article>;
      })}</div>
    </details>

    <details className="panel calendar-manual">
      <summary>Aggiungi manualmente un contenuto</summary>
      <p>Serve solo come eccezione. Il flusso normale sarà automatico.</p>
      {approvedVariants.length === 0 ? <div className="empty-calendar"><Clock3 size={19} /><div><strong>Nessun contenuto approvato disponibile</strong><p>Quando il sistema avrà contenuti pronti compariranno qui.</p></div></div> : <div className="calendar-compose"><label>Contenuto<select value={variantId} onChange={(event) => setVariantId(event.target.value)}>{approvedVariants.map((variant) => <option value={variant.id} key={variant.id}>{providerLabel(variant.provider)} · {variantTitle(variant, state)}</option>)}</select></label><label>Data e ora<input type="datetime-local" value={scheduleLocal} onChange={(event) => setScheduleLocal(event.target.value)} /></label><button className="secondary-button" type="button" disabled={!variantId || !scheduleLocal || busy["new-job"]} onClick={() => void scheduleVariant()}><CalendarClock size={16} /> Aggiungi</button></div>}
    </details>
  </div>;
}
