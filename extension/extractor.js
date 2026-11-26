/**
 * USTH TKB Extractor - runs in the context of the USTH ERP page.
 * Returns the normalized list of sessions (classes and exams) for the current semester.
 */
window.__extractUsthTkb = async function () {
  'use strict';

  var PERIOD_FROM = { 1: '07:30', 2: '08:25', 3: '09:25', 4: '10:25', 5: '11:20', 6: '13:00', 7: '13:55', 8: '14:55', 9: '15:55', 10: '16:50', 11: '17:45', 12: '18:45', 13: '19:45', 14: '20:45' };
  var PERIOD_TO = { 1: '08:20', 2: '09:15', 3: '10:15', 4: '11:15', 5: '12:10', 6: '13:50', 7: '14:45', 8: '15:45', 9: '16:45', 10: '17:40', 11: '18:35', 12: '19:35', 13: '20:35', 14: '21:35' };
  var VN_OFFSET = 7 * 3600 * 1000;
  var DAY = 86400000;
  var EXAM_EXTRA = 12 * 7 * DAY; // exams usually fall after the semester end date -> fetch 12 extra weeks

  function findStore() {
    var root = document.getElementById('__next');
    if (!root) return null;
    var key = Object.keys(root).find(function (k) { return k.indexOf('__reactContainer$') === 0; });
    if (!key) return null;
    var stack = [root[key]], seen = 0;
    while (stack.length && seen < 20000) {
      var f = stack.pop(); seen++;
      if (!f) continue;
      var p = f.memoizedProps;
      if (p && p.store && typeof p.store.getState === 'function') return p.store;
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    return null;
  }

  var store = findStore();
  if (!store) return { ok: false, error: 'NO_REACT_ROOT', message: 'The ERP page has not finished loading.' };

  var state = store.getState();
  if (state.authState && state.authState.isReady && !state.authState.isLoggedIn) {
    return { ok: false, error: 'NOT_LOGGED_IN', message: 'Not signed in to USTH ERP.' };
  }

  var data = { sessions: {}, classes: {} };
  var semesters = {};

  function isSession(o) {
    return o && typeof o === 'object' && !Array.isArray(o) &&
      typeof o.date === 'number' && o.date > 1e11 &&
      o.from != null && o.to != null && o.classId != null && 'day' in o;
  }

  function addSession(o) {
    var key = (o.id != null && o.id !== -1) ? 'id' + o.id : [o.classId, o.date, o.from, o.to].join('|');
    var isNew = !data.sessions[key];
    data.sessions[key] = {
      key: key, classId: o.classId, date: o.date, from: o.from, to: o.to,
      place: o.place || '', teacherNames: o.teacherNames || [], lessonType: o.lessonType || '',
      note: o.note || '', status: o.status, _class: o._class || null, expanded: !!o._expanded
    };
    return isNew;
  }

  function addClass(c) {
    if (c && c.id != null && (c.courseName || c.classId)) {
      data.classes[c.id] = { id: c.id, classId: c.classId, courseId: c.courseId, courseName: c.courseName, courseNameEn: c.courseNameEn, classType: c.classType, type: c.type, semester: c.semester };
    }
  }

  function scan(v, depth) {
    if (!v || typeof v !== 'object' || depth > 6) return 0;
    var added = 0;
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length && i < 5000; i++) added += scan(v[i], depth + 1);
      return added;
    }
    if (isSession(v)) added += addSession(v) ? 1 : 0;
    if (v.courseName && v.id != null && v.classId) addClass(v);
    for (var k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k) && v[k] && typeof v[k] === 'object') added += scan(v[k], depth + 1);
    }
    return added;
  }

  function mondayOf(ms) {
    var d = new Date(ms + VN_OFFSET);
    var dow = (d.getUTCDay() + 6) % 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * DAY - VN_OFFSET;
  }

  function expandCalendarInfo(c) {
    var sem = semesters[c.semester];
    if (!c.calendarInfo || !sem || !(sem.startDate > 0)) return 0;
    var base = mondayOf(sem.startDate), startWeek = Number(sem.startWeek) || 1, added = 0;
    c.calendarInfo.split(';').forEach(function (seg) {
      var p = seg.split(',');
      if (p.length < 4) return;
      var a = /^(\d)-\d(\d+)$/.exec(p[1].trim()), b = /^(\d)-\d(\d+)$/.exec(p[2].trim()), week = parseInt(p[3], 10);
      if (!a || !b || isNaN(week)) return;
      var date = base + (week - startWeek) * 7 * DAY + (Number(a[1]) - 2) * DAY;
      added += addSession({ classId: c.id, date: date, from: Number(a[2]), to: Number(b[2]), day: Number(a[1]), place: p.slice(4).join(',').trim(), _expanded: true }) ? 1 : 0;
    });
    return added;
  }

  function harvestClass(c) {
    addClass(c);
    var cals = (c._calendars && c._calendars.length ? c._calendars : c.calendars) || [];
    var parsed = cals.map(function (x) {
      if (typeof x !== 'string') return x;
      try { return JSON.parse(x); } catch (e) { return null; }
    }).filter(Boolean);
    parsed.forEach(function (x) { if (x.classId == null || x.classId === -1) x.classId = c.id; });
    var dated = parsed.filter(isSession);
    if (dated.length) return dated.reduce(function (n, x) { return n + (addSession(x) ? 1 : 0); }, 0);
    return expandCalendarInfo(c);
  }

  function harvestStore() {
    var s = store.getState().timetableState || {};
    var added = 0;
    [s.rangeItems, s.items].forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (c) { added += harvestClass(c); });
    });
    (s.classRollCalls || []).forEach(function (r) { if (r && r._calendarData) added += scan(r._calendarData, 0); });
    return added;
  }

  function getWebpackRequire() {
    var chunks = window.webpackChunk_N_E, req = null;
    if (!chunks || !chunks.push) return null;
    chunks.push([['usth-tkb-' + Date.now()], {}, function (r) { req = r; }]);
    return req;
  }

  function findRangeFetcher() {
    var req = getWebpackRequire();
    if (!req || !req.m) throw new Error('Cannot access the page code (webpack).');
    var marker = 'query-student-timetable-in-range';
    for (var id in req.m) {
      var src;
      try { src = Function.prototype.toString.call(req.m[id]); } catch (e) { continue; }
      if (src.indexOf(marker) < 0 || src.indexOf('endpoint:"') < 0) continue;
      var before = src.slice(0, src.indexOf(marker));
      var re = /(?:var |,)([\w$]+)=\([\w$]+=\(0,/g, m, local = null;
      while ((m = re.exec(before))) local = m[1];
      var mod = req(id), exportName = null;
      var ex = /([\w$]+):function\(\)\{return ([\w$]+)\}/g;
      while ((m = ex.exec(src))) { if (m[2] === local) { exportName = m[1]; break; } }
      var fn = exportName && mod[exportName];
      if (typeof fn === 'function') return fn;
    }
    throw new Error('Cannot find the page function query-student-timetable-in-range.');
  }

  async function loadSemesters() {
    var r = await fetch('/student-services/api/v1/semesters', { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('Failed to load the semester list (HTTP ' + r.status + ')');
    var list = await r.json();
    (list || []).forEach(function (s) { semesters[s.semester || s.id] = s; });
    return list;
  }

  function pickCurrentSemester(list) {
    var now = Date.now();
    return list.find(function (s) { return s.isCurrentForClass || s.currentForClass; }) ||
      list.find(function (s) { return s.startDate > 0 && s.startDate <= now && (s.endDate <= 0 || now <= s.endDate); }) || null;
  }

  async function fetchSemester(code) {
    var s = semesters[code];
    if (!s || !(s.startDate > 0)) throw new Error('Semester ' + code + ' has no start date.');
    var fn = findRangeFetcher();
    var from = s.startDate, to = (s.endDate > 0 ? s.endDate : s.startDate + 26 * 7 * DAY) + EXAM_EXTRA;
    var startWeek = Number(s.startWeek) || 0, lastWeek = startWeek + Math.floor((to - from) / (7 * DAY));
    var weeks = [];
    for (var w = startWeek; w <= lastWeek; w++) weeks.push(w);
    var res = await fn({ fromTime: from, toTime: to, semester: code, weeks: weeks });
    var list = Array.isArray(res) ? res : (res && (res.data || res.items)) || [];
    var added = 0;
    list.forEach(function (c) { if (c && typeof c === 'object') added += harvestClass(c); });
    return { classes: list.length, added: added };
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function hhmm(v, table) {
    if (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v)) return v;
    var n = Number(v);
    if (isNaN(n)) return null;
    if (n >= 1e11) { var d = new Date(n + VN_OFFSET); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
    if (n >= 100) { var str = String(n).padStart(4, '0'); return str.slice(0, 2) + ':' + str.slice(2); }
    return table[n] || null;
  }

  function toIsoUtc(dateMs, time) {
    var d = new Date(dateMs + VN_OFFSET);
    var hm = time.split(':');
    var utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +hm[0], +hm[1]) - VN_OFFSET;
    return new Date(utc).toISOString();
  }

  function buildEvent(s) {
    var c = s._class || data.classes[s.classId] || {};
    var start = hhmm(s.from, PERIOD_FROM), end = hhmm(s.to, PERIOD_TO);
    if (!start || !end) return null;
    var isExam = c.classType === 'EXAM' || /EXAM/i.test(c.classId || '');
    var name = c.courseName || c.courseId || ('Class ' + s.classId);
    var kind = s.lessonType || c.classType;
    var summary = (isExam ? '[EXAM] ' : '') + name + (kind && !isExam ? ' (' + kind + ')' : '');
    var desc = [];
    if (c.classId) desc.push('Class: ' + c.classId);
    if (c.courseId) desc.push('Course: ' + c.courseId);
    var from = Number(s.from), to = Number(s.to);
    if (from < 100 && to < 100) desc.push('Periods: ' + (from === to ? from : from + ' - ' + to));
    if (s.teacherNames && s.teacherNames.length) desc.push('Lecturer: ' + s.teacherNames.join(', '));
    if (s.note) desc.push('Note: ' + s.note);
    return {
      uid: s.key.replace(/[^\w.-]/g, '_') + '@usth-tkb',
      start: toIsoUtc(s.date, start),
      end: toIsoUtc(s.date, end),
      summary: summary,
      location: s.place || '',
      description: desc.join('\n')
    };
  }

  try {
    var semList = await loadSemesters();
    var currentSem = pickCurrentSemester(semList || []);
    if (!currentSem) throw new Error('Cannot determine the current semester.');

    await fetchSemester(String(currentSem.semester || currentSem.id));
    harvestStore();

    var hasRealSchedule = {};
    Object.keys(data.sessions).forEach(function (k) { var s = data.sessions[k]; if (!s.expanded) hasRealSchedule[s.classId] = true; });

    var semCode = String(currentSem.semester || currentSem.id);
    var endLimit = currentSem.endDate > 0 ? currentSem.endDate + EXAM_EXTRA : Infinity;
    var rawEvents = Object.keys(data.sessions).filter(function (k) {
      var s = data.sessions[k];
      var c = s._class || data.classes[s.classId];
      if (c && c.semester && String(c.semester) !== semCode) return false; // class from another semester
      var inSem = s.date >= currentSem.startDate - 7 * DAY && s.date <= endLimit;
      return inSem && !(s.expanded && hasRealSchedule[s.classId]);
    }).map(function (k) {
      try { return buildEvent(data.sessions[k]); } catch (e) { return null; }
    }).filter(Boolean).sort(function (a, b) { return a.start < b.start ? -1 : 1; });

    var from = currentSem.startDate - 7 * DAY;
    var to = currentSem.endDate > 0 ? endLimit + DAY : (rawEvents.length ? Date.parse(rawEvents[rawEvents.length - 1].end) + DAY : from + 180 * DAY);

    return {
      ok: true,
      semester: currentSem,
      semesterCode: currentSem.semester || currentSem.id,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      events: rawEvents
    };
  } catch (err) {
    return { ok: false, error: 'FETCH_ERROR', message: (err && err.message) || String(err) };
  }
};
