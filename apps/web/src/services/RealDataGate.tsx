import type { PropsWithChildren } from 'react';
import { Link, Navigate } from 'react-router';
import { useLocalE2E } from './local-e2e';

export function RealDataGate({children}:PropsWithChildren){
  const local=useLocalE2E();
  if(local.enabled&&!local.token)return <Navigate to="/login" replace/>;
  if(local.enabled)return <>{children}</>;
  return <main className="private-data-gate"><span className="eyebrow">POST AUTOMATICI</span><h1>Backend non collegato</h1><p>Il prodotto usa solo dati persistenti e integrazioni realmente configurate. Collega il backend per usare l’area privata.</p><div className="card-actions"><Link className="button" to="/onboarding">Apri onboarding</Link><Link className="button secondary" to="/">Torna al sito</Link></div><small>OpenAI: DA CONFIGURARE · Social: DA CONFIGURARE · Analytics: NESSUN DATO</small></main>;
}
