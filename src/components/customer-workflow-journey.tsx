import { CalendarDays, CheckCircle2, FileText } from "lucide-react";
import { NavLink } from "react-router-dom";

const steps = [
  { id: "CREATE", label: "Crea", detail: "Contenuti", to: "/app/contenuti", Icon: FileText },
  { id: "REVIEW", label: "Controlla", detail: "Revisioni", to: "/app/approvazioni", Icon: CheckCircle2 },
  { id: "PLAN", label: "Programma", detail: "Calendario", to: "/app/calendario", Icon: CalendarDays },
] as const;

export function CustomerWorkflowJourney({ current }: { current: "CREATE" | "REVIEW" | "PLAN" }) {
  return <nav className="workflow-journey" aria-label="Percorso di pubblicazione">{steps.map((step, index) => {
    const active = step.id === current;
    const Icon = step.Icon;
    return <NavLink key={step.id} to={step.to} className={active ? "active" : ""} aria-current={active ? "step" : undefined}><span className="workflow-step-number">{index + 1}</span><Icon size={17} /><span><strong>{step.label}</strong><small>{step.detail}</small></span></NavLink>;
  })}</nav>;
}
