# Legacy Autopilot bootstrap

I profili creati prima del nuovo onboarding possono avere un sito salvato ma `onboarding_completed=false` e nessuna pagina analizzata.

La pagina Contenuti ora rileva automaticamente questo stato. Se esiste un sito:

1. avvia la scansione pagina per pagina;
2. esegue l'analisi brand;
3. lascia che l'endpoint di onboarding completi il profilo solo dopo il successo di entrambe le fasi;
4. ricarica il profilo;
5. avvia l'Autopilot.

Nessun pulsante `Analizza sito` è richiesto per la prima preparazione del profilo legacy. In caso di errore il profilo resta incompleto e l'Autopilot non inventa contesto.