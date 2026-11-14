import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { neonDataApiUrl } from "./api/_lib/neon-endpoints";

function vendorChunk(id: string) {
  if (!id.includes("node_modules")) return undefined;
  const normalized = id.replace(/\\/g, "/");
  const marker = "/node_modules/";
  const index = normalized.lastIndexOf(marker);
  if (index === -1) return undefined;
  const packagePath = normalized.slice(index + marker.length);
  const parts = packagePath.split("/");
  const packageName = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1] ?? "unknown"}` : parts[0] ?? "vendor";

  if (packageName === "react" || packageName === "react-dom" || packageName === "react-router" || packageName === "react-router-dom" || packageName === "scheduler") return "react-vendor";
  if (packageName.startsWith("@neondatabase/") || packageName === "better-auth" || packageName === "better-call" || packageName.startsWith("@better-auth/")) return "neon-auth-vendor";
  if (packageName === "lucide-react") return "icons-vendor";
  return undefined;
}

export default defineConfig({
  plugins: [react()],
  // Same rule as the server: only a Vercel preview with a valid QA-branch URL overrides production.
  define: { __NEON_DATA_API_URL__: JSON.stringify(neonDataApiUrl(process.env)) },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
});
