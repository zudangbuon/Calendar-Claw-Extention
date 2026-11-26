# USTH TKB to Google Calendar

A Chrome extension that syncs your [USTH ERP](https://erp.usth.edu.vn/students/learn/timetable) timetable and exams to Google Calendar whenever Chrome starts (and every 6 hours while it is open).

- Reads the timetable using your existing ERP session in Chrome (ERP opens in a background tab for a few seconds, then closes).
- Writes to a separate **"USTH TKB"** calendar in your Google account. Sessions are added, updated or removed as ERP changes; other calendars are never touched.
- Exams are prefixed with `[EXAM]` and shown in red. Optional reminder before each session.

## Install
1. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `extension` folder.
2. Click the extension icon → **Sign in with Google**.
3. Click **Sign in to ERP** and sign in with your USTH account. The first sync runs automatically.

Maintainer setup (Google Cloud Client ID): see [extension/SETUP.md](extension/SETUP.md).
