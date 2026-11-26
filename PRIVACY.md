# Privacy Policy - USTH TKB to Google Calendar

Last updated: 26 November 2026

This Chrome extension copies your own USTH ERP timetable and exam schedule into your own Google Calendar. It has no server: everything runs inside your Chrome browser.

## What data the extension uses
- **USTH ERP timetable**: read from https://erp.usth.edu.vn using the ERP session already signed in in your browser (course names, class codes, dates, times, rooms, lecturer names, notes). The extension never sees or stores your ERP password.
- **Google Calendar**: with your permission (scope `calendar.app.created`), the extension creates one calendar named "USTH TKB" and adds, updates or removes events in that calendar only. It cannot read or change any of your other calendars.
- **Your Google account email**: shown in the extension popup so you know which account is used.

## Where data goes
- Timetable data is sent only to the Google Calendar API (`googleapis.com`), into your own calendar.
- Settings (reminder time, last sync result, calendar ID) are stored locally in your browser (`chrome.storage.local`).
- No data is sent to the developer or any third party. There is no analytics, tracking or advertising.

## Removing your data
- Click **Sign out** in the extension to revoke Google access, or remove access at https://myaccount.google.com/permissions.
- Delete the "USTH TKB" calendar in Google Calendar to remove all synced events.
- Uninstalling the extension deletes its local settings.

## Contact
Open an issue at https://github.com/zudangbuon/Calendar-Claw-Extention/issues.
