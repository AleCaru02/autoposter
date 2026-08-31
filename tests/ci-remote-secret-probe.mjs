function sameSecret(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const provided = request.headers.get("x-audit-smoke-token") || "";
    if (!sameSecret(provided, env.AUDIT_SMOKE_TOKEN || "")) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
    return Response.json({ databaseUrlPresent: typeof env.DATABASE_URL === "string" && env.DATABASE_URL.length > 0 });
  },
};
