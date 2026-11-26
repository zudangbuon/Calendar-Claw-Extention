const $ = (id) => document.getElementById(id);
const send = (type) => chrome.runtime.sendMessage({ type });
let signedIn = false;

function show(r) {
  const el = $('status');
  if (!r) { el.className = ''; el.textContent = 'Not synced yet.'; $('erp').className = ''; return; }
  const when = new Date(r.at).toLocaleString('en-GB');
  if (r.ok) {
    el.className = 'ok';
    el.textContent = `Synced ${when}\nSemester ${r.semester}: ${r.total} sessions - ${r.created} added, ${r.updated} updated, ${r.deleted} removed.`;
  } else {
    el.className = 'err';
    el.textContent = `Failed ${when}\n${r.error}`;
  }
  // Not signed in to ERP -> highlight the "Sign in to ERP" button
  $('erp').className = !r.ok && r.action === 'erp' ? 'primary' : '';
}

function setSignedIn(st) {
  signedIn = !!(st && st.signedIn);
  $('login').hidden = signedIn;
  $('sync').hidden = !signedIn;
  $('logout').hidden = !signedIn;
  $('steps').hidden = signedIn;
  const acc = $('account');
  acc.hidden = !signedIn;
  if (signedIn) {
    acc.textContent = (st.email ? `Account: ${st.email} | ` : '');
    if (st.calendarId) {
      const a = document.createElement('a');
      a.href = 'https://calendar.google.com/calendar/r';
      a.target = '_blank';
      a.textContent = 'Open Google Calendar';
      acc.appendChild(a);
    }
  }
}

async function refresh() {
  const cfg = await chrome.storage.local.get({ auto: true, remind: 15, lastResult: null });
  $('auto').checked = cfg.auto;
  $('remind').value = String(cfg.remind);
  show(cfg.lastResult);
  const st = await send('status');
  setSignedIn(st.ok ? st.result : null);
}

async function runSync() {
  const btn = $('sync');
  btn.disabled = true; btn.textContent = 'Syncing...';
  $('status').className = ''; $('status').textContent = 'Reading ERP and updating Google Calendar...';
  const res = await send('sync');
  btn.disabled = false; btn.textContent = 'Sync now';
  if (!res.ok) show({ ok: false, at: Date.now(), error: res.error });
  else refresh();
}

$('auto').onchange = () => chrome.storage.local.set({ auto: $('auto').checked });
$('remind').onchange = async () => {
  await chrome.storage.local.set({ remind: Number($('remind').value) });
  if (signedIn) runSync(); // apply the new reminder to existing events
};

$('login').onclick = async () => {
  const res = await send('login');
  if (!res.ok) return show({ ok: false, at: Date.now(), error: res.error });
  await refresh();
  runSync(); // the background already started a sync; this waits on the same run to show the result
};

$('logout').onclick = async () => { await send('logout'); setSignedIn(null); show(null); };
$('sync').onclick = runSync;
// Open ERP in a new tab; the background watches it and syncs once you are signed in.
// Create the tab in the background first, tell the worker, then switch to it (the popup closes then).
$('erp').onclick = async () => {
  const tab = await chrome.tabs.create({ url: 'https://erp.usth.edu.vn/students/learn/timetable', active: false });
  await chrome.runtime.sendMessage({ type: 'watchErp', tabId: tab.id }).catch(() => {});
  chrome.tabs.update(tab.id, { active: true });
};

refresh();
