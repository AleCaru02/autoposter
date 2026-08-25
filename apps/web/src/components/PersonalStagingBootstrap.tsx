import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useLocalE2E } from '../services/local-e2e';

const stagingMode=import.meta.env.VITE_PERSONAL_STAGING_MODE==='true';
const EMAIL_KEY='post-automatici.staging.email';
const PASSWORD_KEY='post-automatici.staging.password';

function credentialsFromFragment(){
  if(typeof window==='undefined')return null;
  const raw=window.location.hash.replace(/^#/,'');
  if(!raw)return null;
  const params=new URLSearchParams(raw);
  const email=params.get('staging_email')?.trim()??'';
  const password=params.get('staging_password')??'';
  if(!email||!password)return null;
  localStorage.setItem(EMAIL_KEY,email);
  localStorage.setItem(PASSWORD_KEY,password);
  window.history.replaceState(null,'',`${window.location.pathname}${window.location.search}`);
  return{email,password};
}
function storedCredentials(){
  const fragment=credentialsFromFragment();
  if(fragment)return fragment;
  if(typeof localStorage==='undefined')return null;
  const email=localStorage.getItem(EMAIL_KEY)?.trim()??'';
  const password=localStorage.getItem(PASSWORD_KEY)??'';
  return email&&password?{email,password}:null;
}

export function PersonalStagingBootstrap({children}:PropsWithChildren){
  const local=useLocalE2E();
  const authStarted=useRef(false);
  const tenantStarted=useRef(false);
  const[bootstrapError,setBootstrapError]=useState<string|null>(null);

  useEffect(()=>{
    if(!stagingMode||!local.enabled||local.token||authStarted.current)return;
    const credentials=storedCredentials();
    if(!credentials){setBootstrapError('Link di accesso staging non valido.');return;}
    authStarted.current=true;
    void(async()=>{
      try{
        try{await local.login(credentials);}
        catch{await local.register({name:'Alessandro',...credentials});}
        await local.refreshTenants();
        setBootstrapError(null);
      }catch(error){
        setBootstrapError(error instanceof Error?error.message:String(error));
        authStarted.current=false;
      }
    })();
  },[local]);

  useEffect(()=>{
    if(!stagingMode||!local.enabled||!local.token||local.loading||local.tenants.length>0||tenantStarted.current)return;
    tenantStarted.current=true;
    void local.createTenant({name:'Post Automatici Test',slug:`post-automatici-test-${Date.now().toString(36)}`})
      .then(()=>local.refreshTenants())
      .catch((error)=>{setBootstrapError(error instanceof Error?error.message:String(error));tenantStarted.current=false;});
  },[local]);

  if(!stagingMode)return children;
  if(bootstrapError)return <main className="private-data-gate"><span className="eyebrow">STAGING PERSONALE</span><h1>Accesso staging non disponibile</h1><p>{bootstrapError}</p><small>Nessun dato di produzione è stato modificato.</small></main>;
  if(!local.token||local.loading||local.tenants.length===0)return <main className="private-data-gate"><span className="eyebrow">POST AUTOMATICI</span><h1>Preparo il tuo ambiente test</h1><p>Sessione, attività e dati di staging vengono inizializzati in modo automatico.</p><small>Ambiente separato dalla produzione.</small></main>;
  return children;
}
