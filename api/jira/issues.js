export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const baseUrl = process.env.JIRA_BASE_URL;
    const email = process.env.JIRA_EMAIL;
    const token = process.env.JIRA_API_TOKEN;

    if (!baseUrl || !email || !token) {
      return res.status(500).json({
        error: "Missing Jira environment variables",
        hasBaseUrl: Boolean(baseUrl),
        hasEmail: Boolean(email),
        hasToken: Boolean(token),
      });
    }

    // Read query params
    const {
      jql = "ORDER BY updated DESC",
      fields = "summary",
      maxResults = "50",
      startAt = "0",
      nextPageToken,
    } = req.query;

    const auth = Buffer.from(`${email}:${token}`).toString("base64");

    // NEW Jira endpoint (old search endpoint was removed)
    // Docs / migration message says to use /rest/api/3/search/jql
    const url = new URL(`${baseUrl}/rest/api/3/search/jql`);
    url.searchParams.set("jql", jql);
    url.searchParams.set("fields", fields);
    url.searchParams.set("maxResults", String(maxResults));

    // If nextPageToken exists, use it; otherwise use startAt for older-style pagination
    if (nextPageToken) url.searchParams.set("nextPageToken", nextPageToken);
    else url.searchParams.set("startAt", String(startAt));

    const jiraResp = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    const bodyText = await jiraResp.text();

    // Return Jira response verbatim so frontend can read fields like issues/isLast/nextPageToken
    res.status(jiraResp.status);
    res.setHeader("Content-Type", "application/json");
    return res.send(bodyText);
  } catch (err) {
    console.error("Jira issues function error:", err);
    return res.status(500).json({
      error: "Internal Server Error",
      message: err?.message || String(err),
    });
  }
}
