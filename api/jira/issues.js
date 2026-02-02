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

  const jql = searchParams.get("jql") || "";
  const fieldsStr = searchParams.get("fields") || "";
  const maxResults = Number(searchParams.get("maxResults") || "100");

  // Frontend uses nextPageToken OR startAt. We emulate nextPageToken using startAt offsets.
  const nextPageToken = searchParams.get("nextPageToken");
  const startAtParam = searchParams.get("startAt");

  const startAt = nextPageToken
    ? Number(nextPageToken)
    : Number(startAtParam || "0");

  const fields = fieldsStr
    ? fieldsStr.split(",").map(s => s.trim()).filter(Boolean)
    : undefined;

  const payload = {
    jql,
    startAt,
    maxResults,
    fields,
  };

  const r = await fetch(`${baseUrl}/rest/api/3/search`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { "content-type": r.headers.get("content-type") || "text/plain" },
    });
  }

  const data = await r.json();

  const issues = data.issues || [];
  const total = Number.isFinite(data.total) ? data.total : issues.length;

  const newStartAt = startAt + issues.length;
  const isLast = newStartAt >= total;

  // Emulate nextPageToken so your existing frontend pagination loop continues
  const responseBody = {
    ...data,
    issues,
    isLast,
    nextPageToken: isLast ? null : String(newStartAt),
  };

  return new Response(JSON.stringify(responseBody), {
    headers: { "content-type": "application/json" },
  });
}
