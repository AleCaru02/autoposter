import { useEffect, useMemo, useState } from "react";
import { Link2, Plus, Trash2 } from "lucide-react";
import type { Profile } from "../features/profiles/profile-context";
import {
  deletePersonalBrandSource,
  loadPersonalBrandSources,
  savePersonalBrandSource,
  type PersonalBrandSourceRow,
} from "../features/profiles/personal-brand-source-store";

export function PersonalBrandSourcesPanel(props: { personalBrandProfileId: string; profiles: Profile[] }) {
  const businesses = useMemo(
    () => props.profiles.filter((profile) => profile.profile_type === "BUSINESS" && profile.id !== props.personalBrandProfileId),
    [props.profiles, props.personalBrandProfileId],
  );
  const [rows, setRows] = useState<PersonalBrandSourceRow[]>([]);
  const [sourceProfileId, setSourceProfileId] = useState("");
  const [status, setStatus] = useState<"IDLE" | "LOADING" | "SAVING">("LOADING");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setStatus("LOADING");
    try {
      const next = await loadPersonalBrandSources(props.personalBrandProfileId);
      setRows(next);
      setError(null);
    } catch {
      setError("Impossibile caricare le attività collegate. Riprova.");
    } finally {
      setStatus("IDLE");
    }
  }

  useEffect(() => { void load(); }, [props.personalBrandProfileId]);

  const linkedIds = useMemo(() => new Set(rows.map((row) => row.source_profile_id)), [rows]);
  const available = businesses.filter((profile) => !linkedIds.has(profile.id));

  useEffect(() => {
    if (!sourceProfileId || !available.some((profile) => profile.id === sourceProfileId)) {
      setSourceProfileId(available[0]?.id ?? "");
    }
  }, [available.map((profile) => profile.id).join("|"), sourceProfileId]);

  async function connect() {
    if (!sourceProfileId || status === "SAVING") return;
    setStatus("SAVING");
    setError(null);
    try {
      await savePersonalBrandSource({
        personalBrandProfileId: props.personalBrandProfileId,
        sourceProfileId,
      });
      await load();
    } catch {
      setError("Collegamento non riuscito. Riprova.");
      setStatus("IDLE");
    }
  }

  async function remove(row: PersonalBrandSourceRow) {
    if (status === "SAVING") return;
    setStatus("SAVING");
    setError(null);
    try {
      await deletePersonalBrandSource(props.personalBrandProfileId, row.id);
      await load();
    } catch {
      setError("Non sono riuscito a rimuovere il collegamento.");
      setStatus("IDLE");
    }
  }

  return <section className="panel">
    <div className="panel-heading">
      <div>
        <h2>Dati da altre attività</h2>
        <p>Opzionale. Collega un’attività solo se vuoi che questo Personal Brand possa usare i suoi dati verificati nei contenuti.</p>
      </div>
      <Link2 size={20} />
    </div>

    <p className="section-hint">
      Non sostituisce le “Informazioni aggiuntive”: quelle descrivono la persona. Qui autorizzi soltanto l’uso di fatti provenienti da un’altra attività, per esempio Chogan.
    </p>

    {error && <p className="form-error" role="alert">{error}</p>}

    {rows.length > 0 && <div className="specific-goals-list">
      {rows.map((row) => {
        const source = businesses.find((profile) => profile.id === row.source_profile_id);
        const name = row.source_name || source?.name || "Attività";
        return <div className="specific-goal-row" key={row.id}>
          <div>
            <strong>{name}</strong>
            <small style={{ display: "block" }}>Può fornire dati verificati ai contenuti di questo Personal Brand.</small>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={`Scollega ${name}`}
            disabled={status === "SAVING"}
            onClick={() => void remove(row)}
          >
            <Trash2 size={15} />
          </button>
        </div>;
      })}
    </div>}

    {!businesses.length ? (
      <p className="section-hint">Non ci sono altre attività disponibili da collegare.</p>
    ) : available.length > 0 ? (
      <div className="form-actions">
        <label style={{ flex: 1, minWidth: 220 }}>
          <span>Attività da collegare</span>
          <select value={sourceProfileId} disabled={status === "SAVING"} onChange={(event) => setSourceProfileId(event.target.value)}>
            {available.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </label>
        <button className="primary-button" type="button" disabled={!sourceProfileId || status === "SAVING"} onClick={() => void connect()}>
          <Plus size={15} /> {status === "SAVING" ? "Collegamento…" : "Collega attività"}
        </button>
      </div>
    ) : (
      <p className="section-hint">Tutte le attività disponibili sono già collegate.</p>
    )}
  </section>;
}
