function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function authHeader() {
  const email = must("JIRA_EMAIL");
  const token = must("JIRA_API_TOKEN");
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  return `Basic ${auth}`;
}

export async function GET() {
  const baseUrl = must("JIRA_BASE_URL");
  const r = await fetch(`${baseUrl}/rest/api/3/project/search`, {
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
    },
  });

  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { "content-type": r.headers.get("content-type") || "application/json" },
  });
}
