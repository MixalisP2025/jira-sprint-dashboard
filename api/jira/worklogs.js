// Fetch individual worklogs (author + started + duration) for a set of issue keys.
// Powers the Estimation Quality panel's worklog-level attribution & round-number bias.

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const baseUrl = process.env.JIRA_BASE_URL;
    const email = process.env.JIRA_EMAIL;
    const token = process.env.JIRA_API_TOKEN;
    if (!baseUrl || !email || !token) {
      return res.status(500).json({ error: "Missing Jira environment variables" });
    }

    const keysRaw = req.method === "POST" ? (req.body?.keys || "") : (req.query.keys || "");
    let keys = String(Array.isArray(keysRaw) ? keysRaw.join(",") : keysRaw)
      .split(",").map(k => k.trim()).filter(Boolean);
    if (!keys.length) {
      return res.status(400).json({ error: "keys param required (comma-separated issue keys)" });
    }
    const MAX_KEYS = 800;
    const truncatedKeyList = keys.length > MAX_KEYS;
    if (truncatedKeyList) keys = keys.slice(0, MAX_KEYS);

    const auth = Buffer.from(`${email}:${token}`).toString("base64");
    const authHeaders = { Authorization: `Basic ${auth}`, Accept: "application/json" };

    const worklogs = [];
    const errors = [];

    await mapLimit(keys, 6, async (key) => {
      try {
        let startAt = 0;
        const pageSize = 1000;
        let total = Infinity;
        while (startAt < total) {
          const url = new URL(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}/worklog`);
          url.searchParams.set("startAt", String(startAt));
          url.searchParams.set("maxResults", String(pageSize));
          const r = await fetch(url.toString(), { headers: authHeaders });
          if (!r.ok) { errors.push({ key, message: `HTTP ${r.status}` }); break; }
          const data = await r.json();
          const batch = data.worklogs || [];
          total = Number.isFinite(data.total) ? data.total : batch.length;
          for (const w of batch) {
            worklogs.push({
              issueKey: key,
              author: w.author?.displayName || w.author?.name || "Unknown",
              authorAccountId: w.author?.accountId || null,
              started: w.started || null,
              seconds: w.timeSpentSeconds || 0,
            });
          }
          startAt += pageSize;
          if (!batch.length) break;
        }
      } catch (e) {
        errors.push({ key, message: e?.message || String(e) });
      }
    });

    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({ worklogs, count: worklogs.length, keysRequested: keys.length, truncatedKeyList, errors });
  } catch (err) {
    return res.status(500).json({ error: "Internal Server Error", message: err?.message || String(err) });
  }
}
