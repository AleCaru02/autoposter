export default {
  async fetch(_request, env) {
    return Response.json({ databaseUrlPresent: typeof env.DATABASE_URL === "string" && env.DATABASE_URL.length > 0 });
  },
};
