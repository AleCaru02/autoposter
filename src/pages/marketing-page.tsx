import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useProfiles, type Profile } from "../features/profiles/profile-context";
import { buildMarketingBrief, marketingChannels, marketingLabels, type MarketingChannel } from "../features/marketing/marketing-brief";
import "../marketing.css";
function Workspace({profile}: {profile: Profile}) {
  const [channel,setChannel] = useState<MarketingChannel>("META_ADS");
  const [objective,setObjective] = useState("");
  const [audience,setAudience] = useState("");
  const [offer,setOffer] = useState("");
  const [evidence,setEvidence] = useState("");
  const [budget,setBudget] = useState("");
  const [brief,setBrief] = useState("");
  const [status,setStatus] = useState("");
  function invalidate() { setBrief(""); setStatus(""); }
  function create() {
    setBrief(""); setStatus("");
    try { setBrief(buildMarketingBrief({channel,brand:profile.name,industry:profile.industry,website:profile.website_url,objective,audience,offer,evidence,budgetEur:budget})); }
    catch (e) { setStatus(e instanceof Error ? e.message : "Brief non disponibile."); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(brief); setStatus("Brief copiato."); }
    catch { setStatus("Seleziona e copia il testo manualmente."); }
  }
  return <section className="marketing-workspace">
    <header><p className="marketing-kicker">WORKSPACE MARKETING</p><h1>Strategia multicanale</h1><p>{profile.name} · Prepara brief di campagna senza pubblicare, inviare email o spendere denaro.</p></header>
    <p className="marketing-note">Prima versione: pianificazione manuale. Generazione AI e integrazioni esterne non ancora attive. I dati di questa sessione non vengono salvati.</p>
    <div className="marketing-channel" aria-label="Canale marketing">{marketingChannels.map(c=><button type="button" key={c} aria-pressed={channel===c} onClick={()=>{setChannel(c);invalidate();}}>{marketingLabels[c]}</button>)}</div>
    <form className="marketing-form" onSubmit={e=>{e.preventDefault();create();}}>
      <label>Obiettivo<input required maxLength={300} value={objective} onChange={e=>{setObjective(e.target.value);invalidate();}} placeholder="Es. richieste di preventivo"/></label>
      <label>Pubblico<input required maxLength={500} value={audience} onChange={e=>{setAudience(e.target.value);invalidate();}} placeholder="A chi si rivolge la campagna?"/></label>
      <label>Offerta e messaggio<textarea required maxLength={1000} value={offer} onChange={e=>{setOffer(e.target.value);invalidate();}} rows={3}/></label>
      <label>Prove e fonti (facoltative)<textarea maxLength={1600} value={evidence} onChange={e=>{setEvidence(e.target.value);invalidate();}} rows={3}/></label>
      {channel==="META_ADS"&&<label>Budget totale proposto (€)<input required inputMode="decimal" value={budget} onChange={e=>{setBudget(e.target.value);invalidate();}} placeholder="100"/></label>}
      <button type="submit" className="primary-button">Prepara brief</button>
    </form>
    {brief&&<section><h2>Brief pronto per la revisione</h2><textarea className="marketing-output" aria-label="Brief marketing" readOnly value={brief} rows={15}/><button type="button" className="primary-button" onClick={()=>void copy()}>Copia brief</button></section>}
    <p role="status" aria-live="polite">{status}</p>
    <p>Per i contenuti social usa il <NavLink to="/app/contenuti">piano editoriale AI esistente</NavLink>. I risultati reali sono nella sezione <NavLink to="/app/analytics">Analytics</NavLink>.</p>
  </section>;
}
export function MarketingPage() {
  const {selectedProfile}=useProfiles();
  return selectedProfile ? <Workspace key={selectedProfile.id} profile={selectedProfile}/> : <p>Seleziona un'attività.</p>;
}
