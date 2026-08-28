import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function vendorChunk(id: string) {
  if (!id.includes("node_modules")) return undefined;
  if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/react-router") || id.includes("/scheduler/")) return "react-vendor";
  if (id.includes("/@neondatabase/") || id.includes("/better-auth/") || id.includes("/@better-auth/") || id.includes("/better-call/")) return "neon-auth-vendor";
  if (id.includes("/lucide-react/")) return "icons-vendor";
  return "vendor";
}

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
});
