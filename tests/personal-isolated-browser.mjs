import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { webkit, devices } from "playwright";

// Called only with the disposable identity created by personal-isolated-api.mjs.
export async function verifyIsolatedBrowser({ app, cookies }) {
  const browser = await webkit.launch({ headless: true });
  let stage = "START";
  try {
    for (const mobile of [false, true]) {
      const { defaultBrowserType: _, ...iphone } = devices["iPhone 13"];
      const context = await browser.newContext(mobile ? iphone : { viewport: { width: 1440, height: 900 } });
      try {
        await context.addCookies([...cookies].map(([name, value]) => ({ name, value, url: app, secure: true, httpOnly: true, sameSite: "Lax" })));
        const page = await context.newPage();
        const requestFailures = [];
        page.on("response", (response) => {
          const url = new URL(response.url());
          if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/neondb/rest/v1/")) {
            if (response.status() >= 400 || (url.pathname.startsWith("/neondb/rest/v1/") && !url.hostname.startsWith("ep-damp-credit-"))) requestFailures.push({ path: url.pathname, status: response.status() });
          }
        });
        stage = "DASHBOARD";
        const initial = await page.goto(app + "/app/dashboard", { waitUntil: "domcontentloaded" });
        if (new URL(page.url()).origin !== app) throw new Error("QA_BROWSER_PROTECTION_REDIRECT");
        if (initial?.status() !== 200) throw new Error("QA_BROWSER_ENTRY_HTTP_" + initial?.status());
        try { await page.getByRole("heading", { name: "I tuoi social, sotto controllo.", exact: true }).waitFor({ timeout: 45000 }); }
        catch { console.log("QA_BROWSER_FINAL_PATH", new URL(page.url()).pathname); throw new Error("QA_BROWSER_DASHBOARD_FAILED"); }
        stage = "BRAND";
        await page.goto(app + "/app/brand", { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "Identità dell’attività", exact: true }).waitFor({ timeout: 30000 });
        const contextField = page.getByLabel("Dettagli aggiuntivi", { exact: true });
        const text = "Contesto tecnico salvato dal browser QA " + (mobile ? "mobile" : "desktop");
        await contextField.fill(text);
        stage = "SAVE";
        await contextField.blur();
        await page.locator(".autosave-mini strong").filter({ hasText: /^Salvato$/ }).waitFor({ timeout: 30000 });
        await page.reload({ waitUntil: "domcontentloaded" });
        stage = "RELOAD";
        await contextField.waitFor({ timeout: 30000 });
        await page.waitForFunction((expected) => document.querySelector(".brand-context-field textarea")?.value === expected, text);
        if (requestFailures.length) {
          console.log("QA_BROWSER_FAILED_REQUESTS", JSON.stringify(requestFailures));
          throw new Error("QA_BROWSER_API_REQUEST_FAILED");
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), "QA_BROWSER_HORIZONTAL_OVERFLOW");
        mkdirSync(new URL("../qa-artifacts/", import.meta.url), { recursive: true });
        await page.screenshot({ path: fileURLToPath(new URL("../qa-artifacts/isolated-brand-" + (mobile ? "mobile" : "desktop") + ".png", import.meta.url)), fullPage: true });
        console.log("ISOLATED_QA_BROWSER_BRAND_RELOAD = PASS", mobile ? "mobile-webkit" : "desktop-webkit");
      } catch (error) {
        const page = context.pages()[0];
        if (page && stage === "SAVE") {
          const labels = await page.locator(".autosave-mini strong").allTextContents().catch(() => []);
          console.log("QA_BROWSER_SAVE_STATE", JSON.stringify({ labels: labels.filter((label) => /^(Salvato|Salvataggio…|Da salvare|Errore di salvataggio)$/.test(label)), matchingElements: labels.length, formError: await page.locator(".form-error").count().catch(() => 0) }));
        }
        throw error;
      } finally { await context.close(); }
    }
  } catch (error) {
    throw new Error(/^QA_BROWSER_[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "QA_BROWSER_" + stage + "_FAILED");
  } finally { await browser.close(); }
}
