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
import {
  jobDisplayStatus,
  jobMatchesFilters,
  shiftDateKey,
  variantDisplayStatus,
  variantMatchesFilters,
  visibleStatuses,
  weekDateKeys,
  type CalendarDisplayStatus,
  type CalendarFilters,
  type CalendarViewMode,
} from "../features/calendar/calendar-view";
import "../calendar.css";
import { CustomerWorkflowJourney } from "../components/customer-workflow-journey";

type ScheduleDraft = {
  provider: SocialProvider;
  timezone: string;
  postsPerWeek: number;
  preferredSlots: PreferredSlot[];
  autoChoose: boolean;
  enabled: boolean;
};

type DayCell = { day: number; key: string; weekend: boolean; today: boolean } | null;

const WEEK_HEADERS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const FORMAT_OPTIONS = ["POST", "CAROUSEL", "STORY"] as const;

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

function todayKey(timezone: string) {
  return dateKeyFromInstant(new Date().toISOString(), timezone);
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function monthLabel(value: string) {
  const date = dateFromKey(value);
  const label = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function dayLabel(value: string) {
  return new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(dateFromKey(value));
}

function shortDayLabel(value: string) {
  return new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(dateFromKey(value));
}

function shiftMonthKey(value: string, delta: number) {
  const date = dateFromKey(value);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function buildMonthCells(focusDateKey: string, timezone: string): DayCell[] {
  const focus = dateFromKey(focusDateKey);
  const year = focus.getUTCFullYear();
  const month = focus.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const firstUtcDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const mondayOffset = (firstUtcDay + 6) % 7;
  const currentKey = todayKey(timezone);
  const cells: DayCell[] = Array.from({ length: mondayOffset }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, month, day));
    const mondayIndex = (date.getUTCDay() + 6) % 7;
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ day, key, weekend: mondayIndex >= 5, today: key === currentKey });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function timeLabel(value: string, timezone: string) {
  const parts = zonedDateParts(new Date(value), timezone);
  return `${parts.hour}:${parts.minute}`;
}

function statusLabel(status: CalendarDisplayStatus) {
  const labels: Record<CalendarDisplayStatus, string> = {
    DRAFT: "Bozza",
    REVIEW: "Revisione",
    APPROVED: "Approvato",
    SCHEDULED: "Programmato",
    PUBLISHING: "In pubblicazione",
    PUBLISHED: "Pubblicato",
    FAILED: "Fallito",
  };
  return labels[status];
}

function jobStatus(job: CalendarJobRow, timezone: string) {
  if (job.execution_mode === "DEMO_SIMULATION" && job.state === "PUBLISHED") return "Pubblicato in demo · nessun invio reale";
  if (job.execution_mode === "DEMO_SIMULATION" && job.state === "SCHEDULED") return "Programmato in demo · nessun invio reale";
  if (job.state === "PROCESSING") return "In pubblicazione";
  if (job.state === "PUBLISHED") return job.published_at ? `Pubblicato · ${timeLabel(job.published_at, timezone)}` : "Pubblicato";
  if (job.state === "BLOCKED_APPROVAL") return "Revisione richiesta";
  if (job.state === "FAILED" && job.outcome_unknown) return "Da verificare sul social";
  if (job.state === "FAILED") return "Pubblicazione fallita";
  if (job.next_attempt_at) return `Da riprovare · ${timeLabel(job.next_attempt_at, timezone)}`;
  return "Programmato";
}

export function CalendarPage() {
  const { profiles, selectedProfile, setSelectedProfileId } = useProfiles();
  const [state, setState] = useState<CalendarState>({ schedules: [], variants: [], jobs: [], contentTitles: {} });
  const [drafts, setDrafts] = useState<Record<SocialProvider, ScheduleDraft> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [variantId, setVariantId] = useState("");
  const [scheduleLocal, setScheduleLocal] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobTimes, setJobTimes] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<CalendarViewMode>("MONTH");
  const [focusDateKey, setFocusDateKey] = useState(() => todayKey("Europe/Rome"));
  const [filters, setFilters] = useState<CalendarFilters>({ provider: "ALL", format: "ALL", status: "ALL" });
  const draftsRef = useRef<Record<SocialProvider, ScheduleDraft> | null>(null);
  const scheduleTimersRef = useRef<Partial<Record<SocialProvider, ReturnType<typeof setTimeout>>>>({});

  const reload = useCallback(async () => {
    if (!selectedProfile) return;
    setLoading(true);
    setError(null);
    try {
      const next = await loadCalendarState(selectedProfile.id);
      const approved = next.variants.filter((variant) =>
        variant.eligible
        && variant.approval_status === "APPROVED"
        && variant.workflow_status === "APPROVED"
        && variant.qa_status === "PASS"
      );
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
    if (!selectedProfile) return;
    setFocusDateKey(todayKey(selectedProfile.timezone));
    setSelectedJobId(null);
    setFilters({ provider: "ALL", format: "ALL", status: "ALL" });
  }, [selectedProfile?.id, selectedProfile?.timezone]);

  const variantMap = useMemo(() => new Map(state.variants.map((variant) => [variant.id, variant])), [state.variants]);
  const approvedVariants = useMemo(() => state.variants.filter((variant) =>
    variant.eligible
    && variant.approval_status === "APPROVED"
    && variant.workflow_status === "APPROVED"
    && variant.qa_status === "PASS"
  ), [state.variants]);

  const filteredJobs = useMemo(
    () => state.jobs.filter((job) => jobMatchesFilters(job, variantMap.get(job.variant_id), filters)),
    [state.jobs, variantMap, filters],
  );
  const scheduledVariantIds = useMemo(() => new Set(state.jobs.map((job) => job.variant_id)), [state.jobs]);
  const unscheduledVariants = useMemo(
    () => state.variants.filter((variant) => !scheduledVariantIds.has(variant.id) && variantMatchesFilters(variant, filters)),
    [state.variants, scheduledVariantIds, filters],
  );

  const jobsByDate = useMemo(() => {
    if (!selectedProfile) return new Map<string, CalendarJobRow[]>();
    const map = new Map<string, CalendarJobRow[]>();
    for (const job of filteredJobs) {
      const key = dateKeyFromInstant(job.scheduled_at, selectedProfile.timezone);
      map.set(key, [...(map.get(key) ?? []), job]);
    }
    return map;
  }, [filteredJobs, selectedProfile]);

  const monthCells = useMemo(() => selectedProfile ? buildMonthCells(focusDateKey, selectedProfile.timezone) : [], [focusDateKey, selectedProfile]);
  const weekKeys = useMemo(() => weekDateKeys(focusDateKey), [focusDateKey]);
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
    const existing = scheduleTimersRef.current[provider];
    if (existing) clearTimeout(existing);
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
    patchDraft(provider, { preferredSlots: draft.preferredSlots.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot) });
  }

  function removeSlot(provider: SocialProvider, index: number) {
    const draft = drafts?.[provider];
    if (!draft) return;
    patchDraft(provider, { preferredSlots: draft.preferredSlots.filter((_, slotIndex) => slotIndex !== index) });
  }

  function navigate(delta: number) {
    if (viewMode === "MONTH") setFocusDateKey((current) => shiftMonthKey(current, delta));
    else setFocusDateKey((current) => shiftDateKey(current, delta * (viewMode === "WEEK" ? 7 : 1)));
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
      await rescheduleCalendarJob({ profileId: selectedProfile.id, jobId: job.id, scheduledAt: zonedLocalToIso(local, selectedProfile.timezone), expectedUpdatedAt: job.updated_at });
      setSelectedJobId(null);
      await reload();
    });
  }

  async function removeJob(job: CalendarJobRow) {
    if (!selectedProfile) return;
    await run(`remove-${job.id}`, async () => {
      await removeCalendarJob(selectedProfile.id, job.id, job.updated_at);
      setSelectedJobId(null);
      await reload();
    });
  }

  function renderJob(job: CalendarJobRow) {
    if (!selectedProfile) return null;
    const variant = variantMap.get(job.variant_id);
    const display = jobDisplayStatus(job);
    return <button
      type="button"
      className={`calendar-event provider-${job.provider.toLowerCase()} status-${display.toLowerCase()}`}
      key={job.id}
      onClick={() => setSelectedJobId(job.id)}
    >
      <span>{timeLabel(job.scheduled_at, selectedProfile.timezone)} · {providerLabel(job.provider)} · {variant?.format ?? "—"}</span>
      <strong>{variant ? variantTitle(variant, state) : "Contenuto"}</strong>
      <small>{statusLabel(display)}</small>
    </button>;
  }

  if (!selectedProfile) return null;
  if (loading || !drafts) return <div className="page-content"><p>Caricamento calendario…</p></div>;

  const viewTitle = viewMode === "MONTH"
    ? monthLabel(focusDateKey)
    : viewMode === "WEEK"
      ? `${shortDayLabel(weekKeys[0])} – ${shortDayLabel(weekKeys[6])}`
      : dayLabel(focusDateKey);

  return <div className="page-content calendar-page">
    <header className="page-header calendar-page-header">
      <div><p className="eyebrow">Calendario · {selectedProfile.name}</p><h1>Calendario contenuti</h1><p>Mese, settimana e giorno con stato reale di approvazione e pubblicazione nel fuso {selectedProfile.timezone}.</p></div>
    </header>
    <CustomerWorkflowJourney current="PLAN" />
    {error && <p className="form-error" role="alert">{error}</p>}

    <section className="panel calendar-controls">
      <div className="calendar-view-switch" aria-label="Vista calendario">
        {(["MONTH","WEEK","DAY"] as CalendarViewMode[]).map((mode) => <button type="button" key={mode} className={viewMode === mode ? "active" : ""} onClick={() => setViewMode(mode)}>{mode === "MONTH" ? "Mese" : mode === "WEEK" ? "Settimana" : "Giorno"}</button>)}
      </div>
      <div className="calendar-filter-grid">
        <label>Attività<select value={selectedProfile.id} onChange={(event) => setSelectedProfileId(event.target.value)}>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label>
        <label>Social<select value={filters.provider} onChange={(event) => setFilters((current) => ({ ...current, provider: event.target.value as CalendarFilters["provider"] }))}><option value="ALL">Tutti</option>{SOCIAL_PROVIDERS.map((provider) => <option value={provider.value} key={provider.value}>{provider.label}</option>)}</select></label>
        <label>Formato<select value={filters.format} onChange={(event) => setFilters((current) => ({ ...current, format: event.target.value }))}><option value="ALL">Tutti</option>{FORMAT_OPTIONS.map((format) => <option value={format} key={format}>{format}</option>)}</select></label>
        <label>Stato<select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as CalendarFilters["status"] }))}><option value="ALL">Tutti</option>{visibleStatuses().map((status) => <option value={status} key={status}>{statusLabel(status)}</option>)}</select></label>
      </div>
    </section>

    <section className="month-calendar panel">
      <header className="month-toolbar">
        <div className="month-navigation"><button type="button" className="calendar-icon-button" onClick={() => navigate(-1)} aria-label="Periodo precedente"><ChevronLeft size={18} /></button><h2>{viewTitle}</h2><button type="button" className="calendar-icon-button" onClick={() => navigate(1)} aria-label="Periodo successivo"><ChevronRight size={18} /></button></div>
        <button type="button" className="today-button" onClick={() => setFocusDateKey(todayKey(selectedProfile.timezone))}>Oggi</button>
      </header>

      {viewMode === "MONTH" && <div className="month-scroll"><div className="month-grid">
        {WEEK_HEADERS.map((label, index) => <div className={`weekday-header ${index >= 5 ? "weekend" : ""}`} key={label}>{label}</div>)}
        {monthCells.map((cell, index) => {
          if (!cell) return <div className="calendar-day outside" key={`blank-${index}`} />;
          const jobs = jobsByDate.get(cell.key) ?? [];
          return <div className={`calendar-day ${cell.weekend ? "weekend" : ""} ${cell.today ? "today" : ""}`} key={cell.key}>
            <div className="day-number-row"><button type="button" className="day-number-link" onClick={() => { setFocusDateKey(cell.key); setViewMode("DAY"); }}>{cell.day}</button>{cell.today && <small>Oggi</small>}</div>
            <div className="day-events">{jobs.map(renderJob)}</div>
          </div>;
        })}
      </div></div>}

      {viewMode === "WEEK" && <div className="calendar-week-scroll" tabIndex={0} aria-label="Calendario settimanale, scorri orizzontalmente"><div className="calendar-week-grid">
        {weekKeys.map((key, index) => <section className={`calendar-week-day ${index >= 5 ? "weekend" : ""}`} key={key}>
          <header><button type="button" onClick={() => { setFocusDateKey(key); setViewMode("DAY"); }}>{shortDayLabel(key)}</button></header>
          <div className="day-events">{(jobsByDate.get(key) ?? []).map(renderJob)}</div>
        </section>)}
      </div></div>}

      {viewMode === "DAY" && <div className="calendar-day-detail">
        <header><h3>{dayLabel(focusDateKey)}</h3><span>{selectedProfile.timezone}</span></header>
        <div className="calendar-day-timeline">{(jobsByDate.get(focusDateKey) ?? []).length ? (jobsByDate.get(focusDateKey) ?? []).map(renderJob) : <p>Nessun contenuto programmato con i filtri attuali.</p>}</div>
      </div>}
    </section>

    <section className="panel calendar-unscheduled">
      <header><div><p className="eyebrow">Workflow</p><h2>Contenuti non programmati</h2></div><span>{unscheduledVariants.length}</span></header>
      {unscheduledVariants.length === 0 ? <p>Nessun contenuto non programmato con i filtri attuali.</p> : <div className="unscheduled-list">{unscheduledVariants.slice(0, 30).map((variant) => {
        const display = variantDisplayStatus(variant);
        return <article key={variant.id}><div><strong>{variantTitle(variant, state)}</strong><small>{providerLabel(variant.provider)} · {variant.format} · QA {variant.qa_status}</small></div><span className={`calendar-state status-${display.toLowerCase()}`}>{statusLabel(display)}</span></article>;
      })}</div>}
    </section>

    {selectedJob && <section className="panel selected-calendar-item">
      <div><small>{providerLabel(selectedJob.provider)} · {jobStatus(selectedJob, selectedProfile.timezone)}</small><h2>{variantMap.get(selectedJob.variant_id) ? variantTitle(variantMap.get(selectedJob.variant_id)!, state) : "Contenuto programmato"}</h2><p>{selectedJob.state === "BLOCKED_APPROVAL" ? "Questo contenuto resta bloccato finché approvazione e QA non sono validi. Puoi comunque spostarlo a una nuova data futura." : selectedJob.state === "FAILED" ? (selectedJob.last_error || "Controlla il collegamento social prima di riprovare.") : selectedJob.state === "PROCESSING" ? "La pubblicazione è in corso." : selectedJob.state === "PUBLISHED" ? "La pubblicazione è stata completata." : "Puoi spostarlo o rimuoverlo dal calendario."}</p></div>
      <div className="selected-calendar-actions"><input type="datetime-local" value={jobTimes[selectedJob.id] ?? ""} disabled={selectedJob.state !== "SCHEDULED" && selectedJob.state !== "BLOCKED_APPROVAL"} onChange={(event) => setJobTimes((current) => ({ ...current, [selectedJob.id]: event.target.value }))} /><button type="button" className="secondary-button" disabled={!["SCHEDULED","BLOCKED_APPROVAL"].includes(selectedJob.state) || busy[`job-${selectedJob.id}`]} onClick={() => void reschedule(selectedJob)}>Sposta</button><button type="button" className="danger-outline-button" disabled={!["SCHEDULED","BLOCKED_APPROVAL"].includes(selectedJob.state) || busy[`remove-${selectedJob.id}`]} onClick={() => void removeJob(selectedJob)}><Trash2 size={15} /> Rimuovi</button><button type="button" className="calendar-icon-button" onClick={() => setSelectedJobId(null)} aria-label="Chiudi"><X size={17} /></button></div>
    </section>}

    <details className="panel calendar-settings">
      <summary>Frequenza automatica</summary>
      <p className="calendar-settings-intro">Imposta quante volte vuoi pubblicare per social. Le modifiche vengono memorizzate automaticamente.</p>
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
      <p>Usalo come eccezione al flusso automatico. Sono selezionabili solo versioni approvate che corrispondono al QA approvato.</p>
      {approvedVariants.length === 0 ? <div className="empty-calendar"><Clock3 size={19} /><div><strong>Nessun contenuto approvato disponibile</strong><p>Approva un contenuto dopo QA PASS per programmarlo.</p></div></div> : <div className="calendar-compose"><label>Contenuto<select value={variantId} onChange={(event) => setVariantId(event.target.value)}>{approvedVariants.map((variant) => <option value={variant.id} key={variant.id}>{providerLabel(variant.provider)} · {variant.format} · {variantTitle(variant, state)}</option>)}</select></label><label>Data e ora<input type="datetime-local" value={scheduleLocal} onChange={(event) => setScheduleLocal(event.target.value)} /></label><button className="secondary-button" type="button" disabled={!variantId || !scheduleLocal || busy["new-job"]} onClick={() => void scheduleVariant()}><CalendarClock size={16} /> Aggiungi</button></div>}
    </details>
  </div>;
}
