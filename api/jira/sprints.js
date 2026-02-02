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

export async function GET(request) {
  const baseUrl = must("JIRA_BASE_URL");
  const { searchParams } = new URL(request.url);

  const boardId = searchParams.get("boardId");
  if (!boardId) {
    return new Response("Missing boardId", { status: 400 });
  }

  const state = searchParams.get("state") || "active,future";

  const url = `${baseUrl}/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint?state=${encodeURIComponent(state)}`;

  const r = await fetch(url, {
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
