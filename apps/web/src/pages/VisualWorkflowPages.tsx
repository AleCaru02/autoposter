import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui';
import { useLocalE2E } from '../services/local-e2e';
import { BrandPage } from './BrandCalendarPages';
import './visual-workflow.css';

type Asset={id:string;asset_type:string;original_filename:string;mime_type:string|null;description:string|null;alt_text:string|null;tags:string[];suitable_topics?:string[];quality_score:number|null;is_preferred:boolean;is_brand_locked:boolean;status:'ACTIVE'|'ARCHIVED'|'BLOCKED';usage_count:number;last_used_at:string|null;preview_url:string|null;thumbnail_small_url?:string|null;thumbnail_medium_url?:string|null;original_url?:string|null;thumbnail_status?:string};
const assetTypes=['logo','logo_alt','product','service','property','food','team','person','interior','exterior','testimonial','screenshot','document','brochure','background','generic_photo','generated_visual'];

export function VisualAssetsPage(){
  const local=useLocalE2E();
  const [assets,setAssets]=useState<Asset[]>([]);
  const [search,setSearch]=useState('');
  const [type,setType]=useState('');
  const [view,setView]=useState<'grid'|'list'>('grid');
  const [selected,setSelected]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const load=async()=>{if(!local.tenantId)return;const params=new URLSearchParams();if(search)params.set('search',search);if(type)params.set('type',type);setAssets(await local.api<Asset[]>(`/tenants/${local.tenantId}/assets?${params}`))};
  useEffect(()=>{if(local.enabled&&local.tenantId)void load()},[local.enabled,local.tenantId]);
  if(!local.enabled||!local.tenantId)return <><PageHeader eyebrow="Media" title="Asset Library" description="Gli asset richiedono un’attività autenticata e il backend collegato."/><Card><EmptyState title="Asset Library non disponibile" body="Collega il backend e seleziona un’attività prima di gestire file e visuali."/></Card></>;
  const upload=async(file:File)=>{try{const base64=await fileToBase64(file);const result=await local.api<any>(`/tenants/${local.tenantId}/assets`,{method:'POST',body:JSON.stringify({filename:file.name,mimeType:file.type,dataBase64:base64})});await load();setMessage(result.deduplicated?'File identico già presente: viene riutilizzato l’asset esistente.':'Asset caricato, salvato e preparato per l’uso.')}catch(e){setMessage(e instanceof Error?e.message:String(e))}};
  const patch=async(id:string,body:Record<string,unknown>)=>{try{await local.api(`/tenants/${local.tenantId}/assets/${id}`,{method:'PATCH',body:JSON.stringify(body)});await load();setMessage('Metadata asset salvati.')}catch(e){setMessage(e instanceof Error?e.message:String(e))}};
  const remove=async(id:string)=>{try{await local.api(`/tenants/${local.tenantId}/assets/${id}`,{method:'DELETE'});await load();setMessage('Asset eliminato dal database e dallo storage.')}catch(e){setMessage(e instanceof Error?e.message:String(e))}};
  return <>
    <PageHeader eyebrow="Media · attività attiva" title="Asset Library" description="Upload, thumbnail, metadata, ricerca, filtri, preferiti, lock, blocco, archivio e delete sono persistenti e separati per attività." action={<label className="button file-button">Carica asset<input data-testid="asset-upload" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf" onChange={(e)=>{const f=e.target.files?.[0];if(f)void upload(f);e.currentTarget.value=''}}/></label>}/>
    {message&&<Card><p role="status">{message}</p></Card>}
    <Card><div className="visual-toolbar"><input data-testid="asset-search" aria-label="Cerca asset" placeholder="Cerca asset" value={search} onChange={(e)=>setSearch(e.target.value)}/><select data-testid="asset-type-filter" aria-label="Filtra tipo asset" value={type} onChange={(e)=>setType(e.target.value)}><option value="">Tutti i tipi</option>{assetTypes.map((item)=><option key={item}>{item}</option>)}</select><button className="button secondary" onClick={()=>void load()}>Filtra</button><button className="ghost-button" onClick={()=>setView(view==='grid'?'list':'grid')}>{view==='grid'?'Lista':'Griglia'}</button><Badge>{assets.length} asset</Badge></div></Card>
    {assets.length===0?<Card><EmptyState title="Nessun asset" body="Carica logo, fotografie o documenti dell’attività. I file resteranno disponibili soltanto nel profilo selezionato."/></Card>:<div className={view==='grid'?'visual-assets-grid':'visual-assets-list'}>{assets.map((asset)=><AssetCard key={asset.id} asset={asset} selected={selected===asset.id} onSelect={()=>setSelected(asset.id)} onPatch={(body)=>void patch(asset.id,body)} onDelete={()=>void remove(asset.id)}/>)}</div>}
  </>;
}

function AssetCard({asset,selected,onSelect,onPatch,onDelete}:{asset:Asset;selected:boolean;onSelect:()=>void;onPatch:(body:Record<string,unknown>)=>void;onDelete:()=>void}){
  const [description,setDescription]=useState(asset.description??'');
  const [altText,setAltText]=useState(asset.alt_text??'');
  const [tags,setTags]=useState((asset.tags??[]).join(', '));
  const [assetType,setAssetType]=useState(asset.asset_type);
  useEffect(()=>{setDescription(asset.description??'');setAltText(asset.alt_text??'');setTags((asset.tags??[]).join(', '));setAssetType(asset.asset_type)},[asset.id,asset.description,asset.alt_text,asset.asset_type,asset.tags]);
  const preview=asset.thumbnail_small_url??asset.preview_url;
  return <Card className={`visual-asset-card ${selected?'selected':''}`}>
    {preview?<img loading="lazy" src={preview} alt={asset.alt_text??asset.original_filename}/>:<div className="document-preview">{asset.asset_type.toUpperCase()}</div>}
    <div className="row-between"><strong>{asset.original_filename}</strong><Badge tone={asset.status==='ACTIVE'?'good':asset.status==='BLOCKED'?'warn':'neutral'}>{asset.status}</Badge></div>
    <small>{asset.asset_type} · qualità {Math.round(Number(asset.quality_score??0)*100)}% · {asset.usage_count} utilizzi{asset.is_brand_locked?' · BRAND LOCK':''}{asset.is_preferred?' · PREFERITO':''}{asset.thumbnail_status?` · thumb ${asset.thumbnail_status}`:''}</small>
    <div className="tag-row">{(asset.tags??[]).slice(0,5).map((tag)=><Badge key={tag}>{tag}</Badge>)}</div>
    <div className="asset-metadata-grid"><label>Tipo<select value={assetType} onChange={(e)=>setAssetType(e.target.value)}>{assetTypes.map((item)=><option key={item}>{item}</option>)}</select></label><label>Descrizione<input value={description} onChange={(e)=>setDescription(e.target.value)}/></label><label>Alt text<input value={altText} onChange={(e)=>setAltText(e.target.value)}/></label><label>Tag<input value={tags} onChange={(e)=>setTags(e.target.value)} placeholder="prodotto, servizio, team"/></label></div>
    <div className="asset-actions"><button onClick={onSelect}>{selected?'Selezionato':'Seleziona'}</button><button onClick={()=>onPatch({description,altText,tags:tags.split(',').map((item)=>item.trim()).filter(Boolean),assetType})}>Salva metadata</button><button onClick={()=>onPatch({isPreferred:!asset.is_preferred})}>{asset.is_preferred?'Rimuovi preferito':'Preferito'}</button><button onClick={()=>onPatch({isBrandLocked:!asset.is_brand_locked})}>{asset.is_brand_locked?'Rimuovi brand lock':'Brand lock'}</button><button onClick={()=>onPatch({status:asset.status==='BLOCKED'?'ACTIVE':'BLOCKED'})}>{asset.status==='BLOCKED'?'Sblocca':'Blocca'}</button><button onClick={()=>onPatch({status:asset.status==='ARCHIVED'?'ACTIVE':'ARCHIVED'})}>{asset.status==='ARCHIVED'?'Riattiva':'Archivia'}</button><button className="danger-text" onClick={onDelete}>Elimina</button></div>
    {asset.last_used_at&&<small>Ultimo utilizzo: {new Date(asset.last_used_at).toLocaleString('it-IT')}</small>}
  </Card>;
}

export function BrandVisualPage(){return <><BrandPage/><BrandVisualSettings/></>}

function BrandVisualSettings(){
  const local=useLocalE2E();
  const [assets,setAssets]=useState<Asset[]>([]);
  const [primary,setPrimary]=useState('');
  const [alternate,setAlternate]=useState('');
  const [style,setStyle]=useState('editorial pulito, fotografia naturale, testo essenziale');
  const [message,setMessage]=useState<string|null>(null);
  useEffect(()=>{if(local.enabled&&local.tenantId)void local.api<Asset[]>(`/tenants/${local.tenantId}/assets?status=ACTIVE`).then(setAssets)},[local.enabled,local.tenantId]);
  if(!local.enabled||!local.tenantId)return null;
  const logos=assets.filter((asset)=>['logo','logo_alt'].includes(asset.asset_type));
  const save=async()=>{await local.api(`/tenants/${local.tenantId}/brand/visual-settings`,{method:'PATCH',body:JSON.stringify({primaryLogoAssetId:primary||null,alternateLogoAssetId:alternate||null,preferredVisualStyle:{description:style}})});await local.refresh();setMessage('Impostazioni visuali del brand salvate.');};
  return <Card><h2>Impostazioni visuali del brand</h2><div className="visual-settings-grid"><label>Logo principale<select data-testid="primary-logo" value={primary} onChange={(e)=>setPrimary(e.target.value)}><option value="">Nessuno</option>{logos.map((asset)=><option key={asset.id} value={asset.id}>{asset.original_filename}</option>)}</select></label><label>Logo alternativo<select value={alternate} onChange={(e)=>setAlternate(e.target.value)}><option value="">Nessuno</option>{logos.map((asset)=><option key={asset.id} value={asset.id}>{asset.original_filename}</option>)}</select></label><label className="grow">Stile visuale preferito<input value={style} onChange={(e)=>setStyle(e.target.value)}/></label></div><button className="button" onClick={()=>void save()}>Salva impostazioni visuali</button>{message&&<p role="status">{message}</p>}<p className="muted">Palette, font, logo e stile vengono conservati nel Brand Profile dell’attività e usati come contesto visuale.</p></Card>;
}

const fileToBase64=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.readAsDataURL(file)});
