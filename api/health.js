export function GET() {
  return new Response(
    JSON.stringify({ ok: true, service: "jira-sprint-dashboard-api", ts: Date.now() }),
    { headers: { "content-type": "application/json" } }
  );
}
