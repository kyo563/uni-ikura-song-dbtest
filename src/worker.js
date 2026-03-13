export default {
  async fetch() {
    return new Response(
      JSON.stringify({
        ok: true,
        message:
          "This Worker is a CI placeholder for Cloudflare Workers Builds. App data is served from R2 via index.html.",
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      }
    );
  },
};
