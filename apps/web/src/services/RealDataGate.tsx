import type { PropsWithChildren } from 'react';
import { Link } from 'react-router';
import { useLocalE2E } from './local-e2e';

export function RealDataGate({children}:PropsWithChildren){
  const local=useLocalE2E();
  const explicitDemo=String(import.meta.env.VITE_APP_DATA_MODE??'REAL').toUpperCase()==='DEMO';
  if(explicitDemo||local.enabled)return <>{children}</>;
  return <main className="private-data-gate"><span className="eyebrow">REAL DATA MODE</span><h1>Backend non collegato</h1><p>Questa installazione non usa fixture in modo implicito. Collega il backend Supabase/API reale per visualizzare dati cliente.</p><div className="card-actions"><Link className="button" to="/onboarding">Apri onboarding</Link><Link className="button secondary" to="/">Torna al sito</Link></div><small>Provider: NON COLLEGATO · Analytics: NESSUN DATO REALE</small></main>;
}
