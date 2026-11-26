// USTH TKB -> Google Calendar: background worker. Syncs when Chrome starts and periodically.
// Each user signs in with their own Google account; the "USTH TKB" calendar is created in that account.

const ERP_URL = 'https://erp.usth.edu.vn/students/learn/timetable';
const API = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_NAME = 'USTH TKB';
const TAG = 'usthUid';
const EXAM_COLOR = '11';            // red for exams
const PERIOD_MIN = 6 * 60;          // re-sync every 6 hours while Chrome is open
const RETRY_MIN = 30;               // transient errors (network...) -> retry after 30 minutes
const MIN_GAP_MS = 60 * 60 * 1000;  // auto sync: skip if the last sync was < 1 hour ago
const DEFAULTS = { auto: true, remind: 15, erpSignedIn: null, calendarId: '', lastCount: 0, lastSync: 0, lastResult: null };

let running = null;

const getCfg = () => chrome.storage.local.get(DEFAULTS);
const setCfg = (patch) => chrome.storage.local.set(patch);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Errors the user must fix (sign-in...) -> show a notification. Others only show a red badge and retry.
class UserError extends Error {
  constructor(message, action) { super(message); this.action = action; }
}

function schedule() {
  chrome.alarms.create('periodic', { periodInMinutes: PERIOD_MIN });
  chrome.alarms.create('startup', { delayInMinutes: 1 }); // give the network time to come up after Chrome starts
}

chrome.runtime.onInstalled.addListener((d) => {
  schedule();
  if (d.reason === 'install') chrome.tabs.create({ url: 'popup.html' }); // open the setup page on first install
});
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener(() => { syncNow({ auto: true }).catch(() => {}); });

chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
  if (id === 'erp') openErpForLogin();
  else chrome.tabs.create({ url: 'popup.html' });
});

// Open ERP for the user to sign in; sync as soon as the page reports a signed-in user.
let erpWatch = null;
async function openErpForLogin() {
  const tab = await chrome.tabs.create({ url: ERP_URL, active: true });
  watchErpTab(tab.id);
}

function watchErpTab(tabId) {
  const tab = { id: tabId };
  if (erpWatch) clearInterval(erpWatch);
  const startedAt = Date.now();
  erpWatch = setInterval(async () => {
    const stop = () => { clearInterval(erpWatch); erpWatch = null; };
    if (Date.now() - startedAt > 10 * 60 * 1000) return stop();   // give up after 10 minutes
    let loggedIn = false;
    try {
      const t = await chrome.tabs.get(tab.id);
      if (!t.url || !t.url.startsWith('https://erp.usth.edu.vn/')) return;
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN', func: erpLoginState,
      });
      loggedIn = result === true;
    } catch (e) {
      if (/No tab/i.test(e.message)) return stop();               // the user closed the tab
      return;
    }
    if (loggedIn) {
      await setCfg({ erpSignedIn: true });
      stop();
      syncNow({ auto: false }).catch(() => {});
    }
  }, 3000);
}

// Runs in the ERP page: true if signed in, false if not, null if unknown yet.
function erpLoginState() {
  const root = document.getElementById('__next');
  const key = root && Object.keys(root).find((k) => k.indexOf('__reactContainer$') === 0);
  if (!key) return null;
  const stack = [root[key]];
  let seen = 0;
  while (stack.length && seen++ < 20000) {
    const f = stack.pop();
    if (!f) continue;
    const p = f.memoizedProps;
    if (p && p.store && typeof p.store.getState === 'function') {
      const a = p.store.getState().authState;
      return a && a.isReady ? !!a.isLoggedIn : null;
    }
    if (f.sibling) stack.push(f.sibling);
    if (f.child) stack.push(f.child);
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handlers = {
    sync: () => syncNow({ auto: false }),
    // The popup may close when the Google sign-in window opens, so start the sync here.
    login: () => getToken(true).then(() => { syncNow({ auto: false }).catch(() => {}); return true; }),
    logout: logout,
    status: status,
    watchErp: () => { watchErpTab(msg.tabId); return Promise.resolve(true); },
    erpLogout: erpLogout,
  };
  const h = msg && handlers[msg.type];
  if (!h) return;
  h().then((r) => reply({ ok: true, result: r }), (e) => reply({ ok: false, error: e.message }));
  return true;
});

// ---------- Google sign-in ----------

function friendlyAuthError(e) {
  const m = (e && e.message) || String(e);
  if (/bad client id|invalid_client|OAuth2 not granted|client_id/i.test(m)) {
    return new UserError('The extension has no valid Client ID in manifest.json (see SETUP.md).', 'popup');
  }
  if (/did not approve|canceled|cancelled|user denied/i.test(m)) return new UserError('Google sign-in was cancelled.', 'popup');
  return new UserError('Not signed in to Google. Open the extension and click "Sign in with Google".', 'popup');
}

async function getToken(interactive) {
  let r;
  try { r = await chrome.identity.getAuthToken({ interactive }); } catch (e) { throw friendlyAuthError(e); }
  const token = typeof r === 'string' ? r : r && r.token;
  if (!token) throw friendlyAuthError(null);
  return token;
}

async function status() {
  const signedIn = !!(await getToken(false).catch(() => null));
  const info = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }).catch(() => ({}));
  const { calendarId, erpSignedIn, lastResult } = await getCfg();
  // Older installs have no stored ERP state yet: a successful last sync means ERP was signed in.
  const erp = erpSignedIn !== null ? erpSignedIn : !!(lastResult && lastResult.ok);
  return { signedIn, email: (info && info.email) || '', calendarId, erpSignedIn: erp };
}

// Sign out of ERP by clearing its cookies and site storage in this Chrome profile.
async function erpLogout() {
  await chrome.browsingData.remove(
    { origins: ['https://erp.usth.edu.vn'] },
    { cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true },
  );
  await setCfg({ erpSignedIn: false });
  return true;
}

async function logout() {
  const token = await getToken(false).catch(() => null);
  if (token) fetch('https://oauth2.googleapis.com/revoke?token=' + token, { method: 'POST' }).catch(() => {});
  await chrome.identity.clearAllCachedAuthTokens();
  await setCfg({ calendarId: '', lastCount: 0, lastSync: 0, lastResult: null });
  await setBadge('', null);
  return true;
}

let token = null;
async function api(method, path, body, retry = 0) {
  if (!token) token = await getToken(false);
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && retry < 1) {            // token expired -> get a new one
    await chrome.identity.removeCachedAuthToken({ token });
    token = null;
    return api(method, path, body, retry + 1);
  }
  if ((r.status === 403 || r.status === 429 || r.status >= 500) && retry < 5) {
    const text = await r.clone().text();
    if (r.status !== 403 || /rateLimit|quota/i.test(text)) {   // rate limited -> back off and retry
      await sleep(1000 * 2 ** retry + Math.random() * 500);
      return api(method, path, body, retry + 1);
    }
  }
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error('Google Calendar: ' + ((data.error && data.error.message) || 'HTTP ' + r.status));
    err.status = r.status;
    throw err;
  }
  return data;
}

// ---------- Sync ----------

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  if (color) await chrome.action.setBadgeBackgroundColor({ color });
}

function notify(id, title, message) {
  chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/128.png', title, message });
}

function syncNow(opts) {
  if (!running) running = doSync(opts).finally(() => { running = null; token = null; });
  return running;
}

async function doSync({ auto }) {
  const cfg = await getCfg();
  if (auto && !cfg.auto) return { skipped: 'auto-off' };
  if (auto && Date.now() - cfg.lastSync < MIN_GAP_MS) return { skipped: 'recent' };
  if (auto && !navigator.onLine) {
    chrome.alarms.create('retry', { delayInMinutes: RETRY_MIN / 6 });
    return { skipped: 'offline' };
  }

  await setBadge('...', '#57606a');
  try {
    token = await getToken(!auto);
    const data = await extractFromErp();
    if (!data.events.length) throw new UserError('ERP returned no sessions.', 'erp');
    if (auto && cfg.lastCount && data.events.length < cfg.lastCount * 0.6) {
      throw new UserError(`Only ${data.events.length} sessions found this time (last time: ${cfg.lastCount}), so auto sync was skipped to avoid deleting events by mistake. If this is correct, open the extension and click "Sync now".`, 'popup');
    }
    const res = await pushToCalendar(cfg, data);
    const result = { ok: true, at: Date.now(), semester: data.semesterCode, ...res };
    await setCfg({ lastCount: data.events.length, lastSync: Date.now(), lastResult: result });
    await setBadge('', null);
    chrome.alarms.clear('retry');
    return result;
  } catch (e) {
    const result = { ok: false, at: Date.now(), error: e.message, action: e.action || '' };
    await setCfg({ lastResult: result });
    await setBadge('!', '#cf222e');
    if (auto) {
      if (e instanceof UserError) notify(e.action, 'USTH TKB: action needed', e.message);
      else chrome.alarms.create('retry', { delayInMinutes: RETRY_MIN });
    }
    throw e;
  }
}

async function extractFromErp() {
  const tab = await chrome.tabs.create({ url: ERP_URL, active: false });
  try {
    await waitForLoad(tab.id, 30000);
    const t = await chrome.tabs.get(tab.id);
    const notLoggedIn = new UserError('Not signed in to USTH ERP (or the session expired). Click "Sign in to ERP"; it will sync automatically afterwards.', 'erp');
    if (!t.url || !t.url.startsWith(ERP_URL)) { await setCfg({ erpSignedIn: false }); throw notLoggedIn; }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files: ['extractor.js'] });

    let last = null;
    for (let i = 0; i < 15; i++) {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => window.__extractUsthTkb(),
      });
      last = result;
      if (result && result.ok) { await setCfg({ erpSignedIn: true }); return result; }
      if (result && result.error === 'NOT_LOGGED_IN') { await setCfg({ erpSignedIn: false }); throw notLoggedIn; }
      await sleep(2000); // page not ready yet, try again
    }
    throw new Error((last && last.message) || 'Could not read the timetable from ERP.');
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitForLoad(tabId, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('ERP took too long to load.')); }, timeout);
    const onUpd = (id, info) => { if (id === tabId && info.status === 'complete') { cleanup(); resolve(); } };
    const cleanup = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpd); };
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId).then((t) => { if (t.status === 'complete') { cleanup(); resolve(); } }, () => {});
  });
}

async function getCalendarId(cfg) {
  if (cfg.calendarId) {
    try {
      await api('GET', '/calendars/' + encodeURIComponent(cfg.calendarId));
      return cfg.calendarId;
    } catch (e) {
      if (e.status !== 404 && e.status !== 403) throw e; // calendar was deleted -> create it again
    }
  }
  const cal = await api('POST', '/calendars', { summary: CALENDAR_NAME, timeZone: 'Asia/Ho_Chi_Minh' });
  await setCfg({ calendarId: cal.id });
  return cal.id;
}

async function listTaggedEvents(calId, from, to) {
  const out = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: 'true', maxResults: '2500' });
    if (pageToken) q.set('pageToken', pageToken);
    const r = await api('GET', `/calendars/${encodeURIComponent(calId)}/events?` + q);
    (r.items || []).forEach((ev) => out.push(ev));
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  return out.filter((ev) => ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private[TAG]);
}

async function pool(tasks, n) {
  let i = 0;
  const worker = async () => { while (i < tasks.length) await tasks[i++](); };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
}

function remindersFor(minutes) {
  return { useDefault: false, overrides: minutes > 0 ? [{ method: 'popup', minutes }] : [] };
}

function sameReminders(a, b) {
  const key = (r) => JSON.stringify(((r && r.overrides) || []).map((o) => o.method + o.minutes).sort());
  return !!(a && !a.useDefault) && key(a) === key(b);
}

async function pushToCalendar(cfg, data) {
  const calId = await getCalendarId(cfg);
  const base = `/calendars/${encodeURIComponent(calId)}/events`;
  const reminders = remindersFor(Number(cfg.remind) || 0);

  const existing = {}, dupes = [];
  (await listTaggedEvents(calId, data.from, data.to)).forEach((ev) => {
    const uid = ev.extendedProperties.private[TAG];
    if (existing[uid]) dupes.push(ev); else existing[uid] = ev;
  });

  const tasks = [];
  let created = 0, updated = 0, deleted = 0;
  const seen = {};

  data.events.forEach((x) => {
    seen[x.uid] = true;
    const body = {
      summary: x.summary,
      location: x.location || '',
      description: x.description || '',
      start: { dateTime: x.start },
      end: { dateTime: x.end },
      colorId: x.summary.startsWith('[EXAM]') ? EXAM_COLOR : null,
      reminders,
    };
    const ev = existing[x.uid];
    if (!ev) {
      body.extendedProperties = { private: { [TAG]: x.uid } };
      tasks.push(() => api('POST', base, body).then(() => created++));
      return;
    }
    const same =
      Date.parse(ev.start.dateTime) === Date.parse(x.start) &&
      Date.parse(ev.end.dateTime) === Date.parse(x.end) &&
      (ev.summary || '') === body.summary &&
      (ev.location || '') === body.location &&
      (ev.description || '') === body.description &&
      (ev.colorId || null) === body.colorId &&
      sameReminders(ev.reminders, reminders);
    if (!same) tasks.push(() => api('PATCH', `${base}/${ev.id}`, body).then(() => updated++));
  });

  // Delete sessions no longer on ERP (cancelled/moved) and duplicates
  Object.keys(existing).forEach((uid) => {
    if (!seen[uid]) tasks.push(() => api('DELETE', `${base}/${existing[uid].id}`).then(() => deleted++));
  });
  dupes.forEach((ev) => tasks.push(() => api('DELETE', `${base}/${ev.id}`)));

  await pool(tasks, 4);
  return { total: data.events.length, created, updated, deleted };
}
