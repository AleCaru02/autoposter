import { Component, type ReactNode } from "react";
import { recoverMissingChunk } from "../lib/chunk-recovery";

export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    try {
      recoverMissingChunk(error, { storage: window.sessionStorage, reload: () => window.location.reload() });
    } catch {
      // If browser storage is unavailable, keep the recovery action visible.
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="center-state"><section role="alert">
      <h1>Non riesco ad aprire questa pagina</h1>
      <p>La pagina potrebbe essere stata aggiornata. Riprova a caricarla.</p>
      <button className="primary-button" type="button" onClick={() => window.location.reload()}>Ricarica pagina</button>
    </section></main>;
  }
}
