export default async function handler(req, res) {
  try {
    const baseUrl = process.env.CSR_JIRA_BASE_URL;
    const email   = process.env.CSR_JIRA_EMAIL;
    const token   = process.env.CSR_JIRA_API_TOKEN;

    if (!baseUrl || !email || !token) {
      return res.status(500).json({ error: 'Missing CSR Jira environment variables' });
    }

    const {
      jql        = 'ORDER BY created DESC',
      fields     = 'summary,status,assignee,reporter,created,updated,priority,issuetype,project,customfield_10010,resolutiondate,duedate,issuelinks',
      maxResults = '100',
      startAt    = '0',
      nextPageToken,
    } = req.query;

    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    const url  = new URL(`${baseUrl}/rest/api/3/search/jql`);
    url.searchParams.set('jql', jql);
    url.searchParams.set('fields', fields);
    url.searchParams.set('maxResults', String(maxResults));
    if (nextPageToken) url.searchParams.set('nextPageToken', nextPageToken);
    else url.searchParams.set('startAt', String(startAt));

    const jiraResp = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    });

    if (!jiraResp.ok) {
      const txt = await jiraResp.text();
      return res.status(jiraResp.status).send(txt);
    }

    const data = await jiraResp.json();
    return res.status(200).json({
      issues:        data.issues || [],
      isLast:        data.isLast === true,
      nextPageToken: data.nextPageToken || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
