// Fetch status/assignee change history for a set of issue keys (compact).
// Powers exact assignee-at-completion, cycle time, reopen rate & blocked share.

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); }
  });
  await Promise.all(workers);
  return results;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    const baseUrl = process.env.JIRA_BASE_URL, email = process.env.JIRA_EMAIL, token = process.env.JIRA_API_TOKEN;
    if (!baseUrl || !email || !token) return res.status(500).json({ error: "Missing Jira environment variables" });

    const keysRaw = req.method === "POST" ? (req.body?.keys || "") : (req.query.keys || "");
    let keys = String(Array.isArray(keysRaw) ? keysRaw.join(",") : keysRaw).split(",").map(k => k.trim()).filter(Boolean);
    if (!keys.length) return res.status(400).json({ error: "keys param required (comma-separated issue keys)" });
    const MAX_KEYS = 800;
    const truncatedKeyList = keys.length > MAX_KEYS;
    if (truncatedKeyList) keys = keys.slice(0, MAX_KEYS);

    const auth = Buffer.from(`${email}:${token}`).toString("base64");
    const authHeaders = { Authorization: `Basic ${auth}`, Accept: "application/json" };
    const changelogs = [];
    const errors = [];

    await mapLimit(keys, 6, async (key) => {
      try {
        let startAt = 0; let total = Infinity; const status = []; const assignee = [];
        while (startAt < total) {
          const url = new URL(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}/changelog`);
          url.searchParams.set("startAt", String(startAt));
          url.searchParams.set("maxResults", "100");
          const r = await fetch(url.toString(), { headers: authHeaders });
          if (!r.ok) { errors.push({ key, message: `HTTP ${r.status}` }); break; }
          const data = await r.json();
          const vals = data.values || [];
          total = Number.isFinite(data.total) ? data.total : vals.length;
          for (const h of vals) {
            const t = h.created;
            for (const it of (h.items || [])) {
              if (it.field === "status" || it.fieldId === "status") status.push({ t, from: it.fromString, to: it.toString });
              else if (it.field === "assignee" || it.fieldId === "assignee") assignee.push({ t, from: it.fromString, to: it.toString });
            }
          }
          startAt += vals.length;
          if (!vals.length) break;
        }
        changelogs.push({ key, status, assignee });
      } catch (e) { errors.push({ key, message: e?.message || String(e) }); }
    });

    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({ changelogs, count: changelogs.length, keysRequested: keys.length, truncatedKeyList, errors });
  } catch (err) {
    return res.status(500).json({ error: "Internal Server Error", message: err?.message || String(err) });
  }
}
