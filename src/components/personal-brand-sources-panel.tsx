import { useEffect, useMemo, useState } from "react";
import { Link2, Plus, Save, Trash2 } from "lucide-react";
import type { Profile } from "../features/profiles/profile-context";
import {
  deletePersonalBrandSource,
  loadPersonalBrandSources,
  savePersonalBrandSource,
  type PersonalBrandSourceRow,
} from "../features/profiles/personal-brand-source-store";

function lines(value: string) {
  return [...new Set(value.split(/\n|,/).map((item) => item.trim()).filter(Boolean))];
}

type Draft = {
  id: string | null;
  sourceProfileId: string;
  pillar: string;
  enabled: boolean;
  allowedTopics: string;
  allowedClaims: string;
  allowedCtas: string;
  assetPolicy: PersonalBrandSourceRow["asset_policy"];
  weight: number;
  priority: number;
};

function blank(sourceProfileId = ""): Draft {
  return {
    id: null,
    sourceProfileId,
    pillar: "",
    enabled: true,
    allowedTopics: "",
    allowedClaims: "",
    allowedCtas: "",
    assetPolicy: "REFERENCE_ONLY",
    weight: 1,
    priority: 100,
  };
}

function fromRow(row: PersonalBrandSourceRow): Draft {
  return {
    id: row.id,
    sourceProfileId: row.source_profile_id,
    pillar: row.pillar,
    enabled: row.enabled,
    allowedTopics: row.allowed_topics.join("\n"),
    allowedClaims: row.allowed_claims.join("\n"),
    allowedCtas: row.allowed_ctas.join("\n"),
    assetPolicy: row.asset_policy,
    weight: row.weight,
    priority: row.priority,
  };
}

export function PersonalBrandSourcesPanel(props: { personalBrandProfileId: string; profiles: Profile[] }) {
  const businesses = useMemo(() => props.profiles.filter((profile) => profile.profile_type === "BUSINESS" && profile.id !== props.personalBrandProfileId), [props.profiles, props.personalBrandProfileId]);
  const [rows, setRows] = useState<PersonalBrandSourceRow[]>([]);
  const [draft, setDraft] = useState<Draft>(() => blank(businesses[0]?.id));
  const [status, setStatus] = useState<"IDLE" | "LOADING" | "SAVING">("LOADING");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setStatus("LOADING");
    try {
      const next = await loadPersonalBrandSources(props.personalBrandProfileId);
      setRows(next);
      setDraft((current) => current.id ? current : blank(current.sourceProfileId || businesses[0]?.id || ""));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossibile caricare le fonti.");
    } finally {
      setStatus("IDLE");
    }
  }

  useEffect(() => { void load(); }, [props.personalBrandProfileId]);

  async function save() {
    if (!draft.sourceProfileId || !draft.pillar.trim()) {
      setError("Scegli un’attività sorgente e indica il pillar.");
      return;
    }
    setStatus("SAVING");
    try {
      await savePersonalBrandSource({
        id: draft.id,
        personalBrandProfileId: props.personalBrandProfileId,
        sourceProfileId: draft.sourceProfileId,
        enabled: draft.enabled,
        pillar: draft.pillar,
        allowedTopics: lines(draft.allowedTopics),
        allowedClaims: lines(draft.allowedClaims),
        allowedCtas: lines(draft.allowedCtas),
        assetPolicy: draft.assetPolicy,
        weight: draft.weight,
        priority: draft.priority,
      });
      setDraft(blank(businesses[0]?.id || ""));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fonte non salvata.");
      setStatus("IDLE");
    }
  }

  async function remove(row: PersonalBrandSourceRow) {
    try {
      await deletePersonalBrandSource(props.personalBrandProfileId, row.id);
      if (draft.id === row.id) setDraft(blank(businesses[0]?.id || ""));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fonte non rimossa.");
    }
  }

  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  return <section className="panel">
    <div className="panel-heading"><div><h2>Fonti del Personal Brand</h2><p>Autorizza esplicitamente quali attività possono fornire fatti al Personal Brand. Ogni collegamento resta associato a un solo pillar.</p></div><Link2 size={20} /></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {rows.length > 0 && <div className="specific-goals-list">
      {rows.map((row) => {
        const source = businesses.find((profile) => profile.id === row.source_profile_id);
        return <div className="specific-goal-row" key={row.id}>
          <button type="button" onClick={() => setDraft(fromRow(row))}><span><strong>{source?.name ?? "Attività sorgente"}</strong> · {row.pillar}</span><strong>{row.enabled ? "Attiva" : "Disattivata"}</strong></button>
          <button className="icon-button" type="button" aria-label="Rimuovi fonte" onClick={() => void remove(row)}><Trash2 size={15} /></button>
        </div>;
      })}
    </div>}
    {!businesses.length ? <p className="section-hint">Prima crea almeno un profilo attività BUSINESS da usare come fonte.</p> : <div className="brand-edit-grid">
      <label>Attività sorgente<select value={draft.sourceProfileId} disabled={Boolean(draft.id)} onChange={(event) => patch("sourceProfileId", event.target.value)}>{businesses.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
      <label>Pillar<input value={draft.pillar} placeholder="Es. Property Management" onChange={(event) => patch("pillar", event.target.value)} /></label>
      <label>Priorità<input type="number" min={0} max={10000} value={draft.priority} onChange={(event) => patch("priority", Number(event.target.value))} /></label>
      <label>Peso<input type="number" min={0.001} max={100} step="0.1" value={draft.weight} onChange={(event) => patch("weight", Number(event.target.value))} /></label>
      <label>Asset<select value={draft.assetPolicy} onChange={(event) => patch("assetPolicy", event.target.value as Draft["assetPolicy"])}><option value="NO_ASSETS">Non usare asset</option><option value="REFERENCE_ONLY">Solo riferimento</option><option value="REUSE_APPROVED">Riuso autorizzato</option></select></label>
      <label><span>Fonte attiva</span><select value={draft.enabled ? "yes" : "no"} onChange={(event) => patch("enabled", event.target.value === "yes")}><option value="yes">Sì</option><option value="no">No</option></select></label>
      <label className="full">Temi consentiti <span className="field-help">Uno per riga; vuoto = nessun limite aggiuntivo</span><textarea rows={3} value={draft.allowedTopics} onChange={(event) => patch("allowedTopics", event.target.value)} /></label>
      <label className="full">Claim consentiti <span className="field-help">Uno per riga; vuoto = solo ciò che le fonti verificano</span><textarea rows={3} value={draft.allowedClaims} onChange={(event) => patch("allowedClaims", event.target.value)} /></label>
      <label className="full">CTA consentite <span className="field-help">Una per riga; vuoto = nessun limite aggiuntivo</span><textarea rows={3} value={draft.allowedCtas} onChange={(event) => patch("allowedCtas", event.target.value)} /></label>
      <div className="form-actions">
        {draft.id && <button className="secondary-button" type="button" onClick={() => setDraft(blank(businesses[0]?.id || ""))}><Plus size={15} /> Nuova fonte</button>}
        <button className="primary-button" type="button" disabled={status === "SAVING"} onClick={() => void save()}><Save size={15} /> {status === "SAVING" ? "Salvataggio…" : draft.id ? "Salva fonte" : "Aggiungi fonte"}</button>
      </div>
    </div>}
  </section>;
}
