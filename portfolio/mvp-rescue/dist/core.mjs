export const KEY = 'mvp-rescue-demo-v1';
export function validate(input) {
  const data = {company: String(input.company ?? '').trim(), email: String(input.email ?? '').trim(), details: String(input.details ?? '').trim()};
  if (!data.company || data.company.length > 120) throw Error('Company must contain 1–120 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.email.length > 254) throw Error('Enter a valid contact email, up to 254 characters.');
  if (!data.details || data.details.length > 2000) throw Error('Request must contain 1–2,000 characters.');
  return data;
}
export function read(storage) {
  const raw = storage.getItem(KEY);
  if (raw === null) return [];
  let state; try {state = JSON.parse(raw);} catch {throw Error('Stored demo data is unreadable. Export or reset it before proceeding.');}
  if (state?.version !== 1 || !Array.isArray(state.requests) || state.requests.length > 100) throw Error('Unsupported demo data. Reset only if you want to delete it.');
  const ids = new Set();
  for (const row of state.requests) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.created !== 'string' || !Number.isFinite(Date.parse(row.created))) throw Error('Invalid stored request. Reset only if you want to delete it.');
    validate(row); ids.add(row.id);
  }
  return state.requests;
}
export function save(storage, input, id, created = new Date().toISOString()) {
  const data = validate(input);
  if (typeof id !== 'string' || !id || !Number.isFinite(Date.parse(created))) throw Error('Invalid request identifier or date.');
  const rows = read(storage);
  if (rows.some(r => r.id === id)) return {rows, duplicate: true};
  if (rows.length >= 100) throw Error('Demo capacity reached: 100 requests. Export or reset before adding more.');
  const next = [...rows, {...data, id, created}];
  try {storage.setItem(KEY, JSON.stringify({version: 1, requests: next}));} catch {throw Error('Saving failed. Nothing was marked as saved. Check browser storage availability.');}
  return {rows: next, duplicate: false};
}
