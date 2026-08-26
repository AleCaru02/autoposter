import { Wrench } from "lucide-react";
import { useProfiles } from "../features/profiles/profile-context";

export function PlaceholderPage({ title, description, dependency }: { title: string; description: string; dependency?: string }) {
  const { selectedProfile } = useProfiles();
  return <div className="page-content"><header className="page-header"><div><p className="eyebrow">{selectedProfile?.name ?? "Post Automatici"}</p><h1>{title}</h1><p>{description}</p></div></header><section className="unavailable-panel"><Wrench size={24} /><div><h2>Funzione non ancora disponibile</h2><p>{dependency ? `Dipendenza: ${dependency}. ` : ""}Non viene mostrato alcun dato simulato finché il collegamento reale non è verificato.</p></div></section></div>;
}
