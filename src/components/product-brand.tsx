import { Sparkles } from "lucide-react";

export function ProductBrand({ compact = false }: { compact?: boolean }) {
  return <div className={`product-brand ${compact ? "compact" : ""}`} aria-label="Post Automatici">
    <span className="product-brand-mark" aria-hidden="true"><Sparkles size={compact ? 16 : 19} strokeWidth={2.4} /></span>
    <span className="product-brand-copy"><strong>Post Automatici</strong>{!compact && <small>Il tuo social team AI</small>}</span>
  </div>;
}
