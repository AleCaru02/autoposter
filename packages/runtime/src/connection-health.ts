import type { ConnectionHealthStatus } from '@socialpilot/contracts';

export interface ConnectionHealthSignals {
  nowMs:number;
  connected:boolean;
  expiresAtMs?:number;
  degraded?:boolean;
  expired?:boolean;
  reauthRequired?:boolean;
  missingPermissions?:string[];
  rateLimited?:boolean;
  providerError?:boolean;
}

export interface ConnectionHealthSnapshot {
  status:ConnectionHealthStatus;
  recommendedAction:string|null;
}

export class ProviderConnectionHealthMachine {
  status(input:ConnectionHealthSignals):ConnectionHealthStatus{
    if(!input.connected)return'DISCONNECTED';
    if(input.reauthRequired)return'REAUTH_REQUIRED';
    if(input.expired||(input.expiresAtMs!==undefined&&input.expiresAtMs<=input.nowMs))return'EXPIRED';
    if(input.missingPermissions?.length)return'PERMISSION_MISSING';
    if(input.rateLimited)return'RATE_LIMITED';
    if(input.providerError)return'PROVIDER_ERROR';
    if(input.degraded)return'DEGRADED';
    if(input.expiresAtMs!==undefined&&input.expiresAtMs-input.nowMs<=7*24*60*60_000)return'EXPIRING';
    return'CONNECTED';
  }

  snapshot(input:ConnectionHealthSignals):ConnectionHealthSnapshot{
    const status=this.status(input);
    const recommendedAction:Record<ConnectionHealthStatus,string|null>={
      CONNECTED:null,
      DEGRADED:'Verifica il provider e riprova; la connessione è disponibile ma degradata.',
      EXPIRING:'Rinnova la connessione prima della scadenza.',
      EXPIRED:'Autorizzazione scaduta: avvia la riautorizzazione.',
      REAUTH_REQUIRED:'Ricollega il provider.',
      PERMISSION_MISSING:'Aggiorna le autorizzazioni richieste.',
      RATE_LIMITED:'Attendi il reset del limite provider e riprova.',
      PROVIDER_ERROR:'Riprova più tardi; il provider non è disponibile.',
      DISCONNECTED:'Collega il provider.',
    };
    return{status,recommendedAction:recommendedAction[status]};
  }
}
