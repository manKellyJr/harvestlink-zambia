# Going live: staging on Vercel and the Africa's Talking sandbox

Every step that needs an account or a secret is done by the owner in a dashboard. Secrets are never pasted into chat, committed, or written to project files.

## 1. Vercel project + database (about 10 minutes)

1. In Vercel, **Add New → Project**, import `manKellyJr/harvestlink-zambia`. Framework: Next.js (detected). No build settings to change: `vercel-build` applies database migrations and then builds.
2. In the project, **Storage → Create → Neon (Postgres)**, connect it to the project for all environments. This sets `DATABASE_URL`. Turn on Neon branching for previews if offered, so preview deployments get their own database (staging) and never touch production data.
3. **Settings → Environment Variables**, add:

| Variable | Value |
| --- | --- |
| `SESSION_SECRET` | a long random string (e.g. output of `openssl rand -base64 48`) |
| `USSD_WEBHOOK_KEY` | another random string (letters and digits only) |
| `CRON_SECRET` | another random string |
| `BOOTSTRAP_ADMIN_PHONE` | your own mobile number |
| `SMS_PROVIDER` | `africastalking` |
| `AT_USERNAME` | `sandbox` (staging) or your live app username (production) |
| `AT_API_KEY` | from step 2 below |
| `PILOT_CROP` | `soybeans` (optional) |
| `PILOT_PROVINCE` | `Central` (optional) |

4. Redeploy. `https://<project>.vercel.app/api/health` should return `{"ok":true}`.

## 2. Africa's Talking sandbox (about 10 minutes)

1. Create a free account at africastalking.com and open the **Sandbox** app.
2. **Settings → API Key**: generate a key and paste it into `AT_API_KEY` in Vercel (step 1.3).
3. **USSD → Create channel**: pick a sandbox code (e.g. `*384*12345#`). Callback URL:
   `https://<project>.vercel.app/api/ussd?key=<USSD_WEBHOOK_KEY>`
4. Open the **simulator** (developers.africastalking.com/simulator), enter a phone number such as `+260971234567`, and dial the code. Sandbox SMS messages appear in the simulator's inbox.

## 3. First run

1. On the website, log in with the `BOOTSTRAP_ADMIN_PHONE` number. The login code arrives by SMS (in the sandbox: in the simulator inbox for that number). You land in the admin console as the first admin; the bootstrap does nothing once an admin exists.
2. **Collection points**: add the real pilot sites.
3. **Accounts**: create an agent for each collection point.
4. In the simulator, register as a farmer and list a lot; log in as the agent and check it in; register a buyer on the website and place an order; register a transporter in the simulator and accept the job. Confirm delivery, record a payment and confirm it from the farmer's simulated phone.

## 4. Before real farmers (production)

- Register HarvestLink with the Office of the Data Protection Commissioner and have the privacy notice (`/privacy`) reviewed.
- Apply for a live USSD code and a sender ID through Africa's Talking (takes several weeks with the operators).
- Use a separate Vercel environment and Neon branch for production, with `AT_USERNAME` set to the live app.
- On the Vercel Hobby plan, cron runs once a day (the SMS retry is scheduled for 06:00 UTC). USSD traffic also retries failed SMS in the background. On Pro, change `vercel.json` to every 15 minutes.
