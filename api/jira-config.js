export function GET() {
  const hasCredentials =
    Boolean(process.env.JIRA_BASE_URL) &&
    Boolean(process.env.JIRA_EMAIL) &&
    Boolean(process.env.JIRA_API_TOKEN);

  return new Response(JSON.stringify({ hasCredentials }), {
    headers: { "content-type": "application/json" },
  });
}
