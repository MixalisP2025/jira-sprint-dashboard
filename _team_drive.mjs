import fs from 'node:fs';
const CDP = 'http://localhost:9224', APP = 'http://localhost:4001', OUT = process.cwd();
async function connect() {
  let t; try { t = await (await fetch(`${CDP}/json/new?${encodeURIComponent(APP)}`, { method: 'PUT' })).json(); }
  catch { t = await (await fetch(`${CDP}/json/new?${encodeURIComponent(APP)}`)).json(); }
  const ws = new WebSocket(t.webSocketDebuggerUrl); const pending = new Map(); let id = 0;
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  return (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = await connect();
await send('Page.enable'); await send('Runtime.enable'); await send('Page.navigate', { url: APP });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval'); return r.result.value; };
async function waitFor(x, ms = 60000, label = '') { const s = Date.now(); while (Date.now() - s < ms) { try { if (await ev(`(function(){try{return !!(${x})}catch(e){return false}})()`)) return; } catch {} await sleep(600); } throw new Error('timeout ' + label); }

await waitFor(`[...document.querySelectorAll('button,div,label')].some(e=>/Team|Upload Jira Data/.test(e.textContent))`, 60000, 'shell');
if (!await ev(`[...document.querySelectorAll('button')].some(b=>/Time Tracking/.test(b.textContent))`)) {
  console.log('refreshing from Jira…');
  await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>/Refresh from Jira/i.test(x.textContent));b&&b.click()})()`);
  await waitFor(`[...document.querySelectorAll('button')].some(b=>/Time Tracking/.test(b.textContent))`, 560000, 'data');
  await sleep(1500);
}
// click the Team tab
await ev(`(function(){const b=[...document.querySelectorAll('button')].find(x=>/^\\s*Team\\s*$/.test(x.textContent)||/Team$/.test(x.textContent.trim()));if(b){b.click();return true}const b2=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Team');b2&&b2.click();return !!b2})()`);
await sleep(1000);
const proj = await ev(`(function(){const ps=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>/All Projects/.test(o.textContent)));if(!ps)return null;const opts=[...ps.options].map(o=>o.value).filter(v=>v&&v!=='all');const pick=opts.find(v=>/Web Transformation/i.test(v))||opts[0];Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set.call(ps,pick);ps.dispatchEvent(new Event('change',{bubbles:true}));return pick})()`);
console.log('project:', proj);
// wait for worklogs to load (banner disappears) then settle
await sleep(3000);
await waitFor(`!/Loading worklogs/.test(document.body.innerText)`, 120000, 'worklogs').catch(()=>console.log('worklog wait timed out'));
await sleep(2000);
const info = await ev(`(function(){const t=document.body.innerText;const g=re=>{const m=t.match(re);return m?m[0]:null};return {contributors:g(/Contributors[\\s\\S]{0,30}?\\d+/),team:g(/SP delivered[\\s\\S]{0,30}/),onTeamTab:/SP per available day|Team Contribution|Contributors/.test(t)}})()`);
console.log('info:', JSON.stringify(info));
const h = Math.min(await ev('document.querySelector(".tt-print-root")?.scrollHeight || document.body.scrollHeight') || 3000, 14000);
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: h, deviceScaleFactor: 1, mobile: false });
await sleep(500);
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1500, height: h, scale: 1 } });
fs.writeFileSync(`${OUT}/team.png`, Buffer.from(shot.data, 'base64'));
console.log('saved team.png height', h);
process.exit(0);
