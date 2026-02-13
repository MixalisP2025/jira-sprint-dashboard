export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    // Skip authentication check for now - can be re-enabled later
    // const verified = await verifyClerkToken(req, res);
    // if (!verified) {
    //   return; // verifyClerkToken already sent 401 response
    // }

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
      maxResults = "100",
      startAt = "0",
      nextPageToken,
    } = req.query;

    const auth = Buffer.from(`${email}:${token}`).toString("base64");

    // Use new Jira search/jql API endpoint (GET with query params)
    const url = new URL(`${baseUrl}/rest/api/3/search/jql`);
    url.searchParams.set("jql", jql);
    url.searchParams.set("fields", fields);
    url.searchParams.set("maxResults", String(maxResults));
    
    // Use nextPageToken if provided, otherwise use startAt
    if (nextPageToken) {
      url.searchParams.set("nextPageToken", nextPageToken);
    } else {
      url.searchParams.set("startAt", String(startAt));
    }

    const jiraResp = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!jiraResp.ok) {
      const errorText = await jiraResp.text();
      console.error('Jira API error:', errorText);
      return res.status(jiraResp.status).send(errorText);
    }

    const data = await jiraResp.json();
    
    // The new API uses isLast and nextPageToken for pagination
    const issues = data.issues || [];
    const isLast = data.isLast === true;
    const nextToken = data.nextPageToken || null;
    
    const responseBody = {
      issues,
      total: issues.length, // New API doesn't provide total count
      startAt: parseInt(startAt),
      maxResults: parseInt(maxResults),
      isLast,
      nextPageToken: nextToken
    };

    res.status(200);
    res.setHeader("Content-Type", "application/json");
    return res.json(responseBody);
  } catch (err) {
    console.error("Jira issues function error:", err);
    return res.status(500).json({
      error: "Internal Server Error",
      message: err?.message || String(err),
    });
  }
}
