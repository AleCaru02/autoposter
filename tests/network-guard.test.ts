import assert from "node:assert/strict";
import { guardedFetch, isPrivateAddress } from "../api/_lib/network-guard.js";
import { crawlWebsite } from "../api/_lib/crawler.js";

for (const address of [
  "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
  "198.18.0.1", "224.0.0.1", "255.255.255.255", "192.0.0.8",
  "::", "::1", "[::1]", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::127.0.0.1",
  "64:ff9b::a9fe:a9fe", "fc00::1", "fd12:3456::1", "fe80::1", "febf::1", "ff02::1", "2002:a9fe:a9fe::1",
  "fe80::1%eth0", "1:2:3", "zz::1",
]) assert.equal(isPrivateAddress(address), true, `${address} deve essere bloccato`);

for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "2a00:1450:4002::65", "edge.example-cdn.net"]) {
  assert.equal(isPrivateAddress(address), false, `${address} è pubblico`);
}

function validator(url: URL) {
  if (isPrivateAddress(url.hostname) || url.hostname === "metadata.internal") throw new Error("PRIVATE_TARGET");
}

// A public URL that redirects to cloud metadata must be blocked BEFORE the private hop is requested.
const requested: string[] = [];
const bouncing = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  requested.push(url);
  assert.equal(init?.redirect, "manual", "il fetch non deve mai seguire i redirect automaticamente");
  if (url === "https://public.test/") return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
  return new Response("SECRET", { status: 200 });
}) as typeof fetch;
await assert.rejects(guardedFetch(bouncing, new URL("https://public.test/"), {}, validator), /PRIVATE_TARGET/);
assert.deepEqual(requested, ["https://public.test/"], "l'hop privato non deve essere richiesto");

// Redirect chain across public hops is followed and returns the final URL.
const chain = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url === "https://a.test/") return new Response(null, { status: 301, headers: { location: "/b" } });
  if (url === "https://a.test/b") return new Response(null, { status: 308, headers: { location: "https://a.test/c" } });
  return new Response("ok", { status: 200 });
}) as typeof fetch;
const followed = await guardedFetch(chain, new URL("https://a.test/"), {}, validator);
assert.equal(followed.finalUrl.toString(), "https://a.test/c");
assert.equal(await followed.response.text(), "ok");

// Loops are bounded and non-http protocols rejected.
const loop = (async () => new Response(null, { status: 302, headers: { location: "https://loop.test/" } })) as typeof fetch;
await assert.rejects(guardedFetch(loop, new URL("https://loop.test/"), {}, validator), /TOO_MANY_REDIRECTS/);
const fileHop = (async () => new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } })) as typeof fetch;
await assert.rejects(guardedFetch(fileHop, new URL("https://x.test/"), {}, validator), /UNSAFE_REDIRECT_PROTOCOL/);

// End-to-end through the crawler: robots/sitemap/page fetches never reach the private hop.
const crawlRequests: string[] = [];
const crawlFetcher = (async (input: string | URL | Request) => {
  const url = String(input);
  crawlRequests.push(url);
  if (url === "https://site.test/robots.txt") return new Response(null, { status: 302, headers: { location: "http://metadata.internal/robots" } });
  if (url === "https://site.test/") return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8080/admin" } });
  return new Response("<html><body>never</body></html>", { status: 200, headers: { "content-type": "text/html" } });
}) as typeof fetch;
const crawled = await crawlWebsite("https://site.test/", { fetcher: crawlFetcher, validateTarget: validator, maxPages: 2, includeSitemap: false });
assert.ok(!crawlRequests.some((url) => url.includes("127.0.0.1") || url.includes("metadata.internal")), `richieste private: ${crawlRequests.join(", ")}`);
assert.ok(crawled.pages.every((page) => page.status !== "ANALYZED"), "nessuna pagina privata può risultare analizzata");

console.log("PASS network guard: IP privati IPv4/IPv6, redirect validati hop-by-hop, crawler senza fetch verso target privati.");
