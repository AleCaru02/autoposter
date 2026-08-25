import type { ComponentPropsWithoutRef, PropsWithChildren, ReactNode } from 'react';

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{description}</p></div>{action && <div>{action}</div>}</header>;
}

type CardProps = PropsWithChildren<ComponentPropsWithoutRef<'section'>>;

export function Card({ children, className = '', ...props }: CardProps) {
  return <section {...props} className={`card ${className}`}>{children}</section>;
}

export function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <Card><div className="metric-label">{label}</div><strong className="metric-value">{value}</strong><div className="metric-hint">{hint}</div></Card>;
}

export function Badge({ children, tone = 'neutral' }: PropsWithChildren<{ tone?: 'neutral' | 'good' | 'warn' | 'info' }>) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const percentage = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  return <div className="progress-wrap"><div className="row-between"><span>{label}</span><strong>{value}/{max}</strong></div><div className="progress-track"><div className="progress-fill" style={{ width: `${percentage}%` }} /></div></div>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong><span>{body}</span>{action && <div>{action}</div>}</div>;
}
