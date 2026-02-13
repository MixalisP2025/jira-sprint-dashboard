export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
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

    // Use standard Jira search API endpoint
    const url = new URL(`${baseUrl}/rest/api/3/search`);
    
    // Build request body for POST
    const requestBody = {
      jql: jql,
      fields: fields.split(','),
      maxResults: parseInt(maxResults),
      startAt: nextPageToken ? parseInt(nextPageToken) : parseInt(startAt)
    };

    const jiraResp = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody)
    });

    if (!jiraResp.ok) {
      const errorText = await jiraResp.text();
      console.error('Jira API error:', errorText);
      return res.status(jiraResp.status).send(errorText);
    }

    const data = await jiraResp.json();
    
    // Transform response to include pagination info
    const issues = data.issues || [];
    const total = data.total || 0;
    const currentStartAt = data.startAt || 0;
    const newStartAt = currentStartAt + issues.length;
    const isLast = newStartAt >= total;
    
    const responseBody = {
      ...data,
      issues,
      total,
      startAt: currentStartAt,
      isLast,
      nextPageToken: isLast ? null : String(newStartAt)
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
