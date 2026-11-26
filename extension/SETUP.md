# Setup guide (maintainer, one time)

Fixed extension ID: `flibhennhggdklbefeaebdkmmpdboeeh`
It comes from the `key` field in `manifest.json`. The matching private key is `../extension-key.pem`:
keep it, back it up, and never share or commit it.

## 1. Create the OAuth client in Google Cloud
Use a personal Gmail account rather than a school account. Do not add a billing account: none is needed.

1. https://console.cloud.google.com → create a new project (e.g. "USTH TKB").
2. Enable the **Google Calendar API**: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com
3. **Google Auth Platform → Get started** (https://console.cloud.google.com/auth/overview):
   app name, support email, Audience **External**, contact email.
4. **Data Access → Add or remove scopes** (https://console.cloud.google.com/auth/scopes):
   add `https://www.googleapis.com/auth/calendar.app.created` (non-sensitive) and save.
5. **Audience** (https://console.cloud.google.com/auth/audience): click **Publish app**.
   Anyone can then sign in, with no user limit and no weekly re-login.
6. **Clients → Create client** (https://console.cloud.google.com/auth/clients):
   type **Chrome Extension**, Item ID `flibhennhggdklbefeaebdkmmpdboeeh`.
7. Put the Client ID into `oauth2.client_id` in `manifest.json`.

Google may delete an OAuth client that has not been used for 6 months. If that happens, repeat step 6 and update `manifest.json`.

## 2. Install for users
1. Copy the `extension` folder to a permanent location on their machine.
2. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the folder.
3. Check that the ID shown is `flibhennhggdklbefeaebdkmmpdboeeh`.
4. Open the extension → **Sign in with Google** → **Sign in to ERP**.

On first sign-in Google may show "Google hasn't verified this app". Click **Advanced → Go to (app name)**.

## 3. Updating
After changing the code, replace the files in the user's folder and click **Reload** on the extension
in `chrome://extensions` (or restart Chrome).
