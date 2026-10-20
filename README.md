# CivicNest Server

The Express API behind [CivicNest](https://github.com/argh-finds404/CivicNest-Client), a neighbourhood civic platform. Residents report street problems, every report becomes a trackable ticket, neighbours claim and fix it, and the community verifies the fix. The API also runs cleanup drives, lost & found, animal rescue, polls, the forum, NGOs, donations and the Gemini-powered CivicBot.

* **Live app:** [https://civic-nest-client.vercel.app/](https://civic-nest-client.vercel.app/)
* **Client repository:** [argh-finds404/CivicNest-Client](https://github.com/argh-finds404/CivicNest-Client)

---

## Demo logins

| Role | Email | Password |
| --- | --- | --- |
| **Admin** | `admin.reviewer@civicnest.app` | `CivicNest@2026` |
| **Moderator** | `moderator.reviewer@civicnest.app` | `CivicNest@2026` |
| **Member** (general user) | `member.reviewer@civicnest.app` | `CivicNest@2026` |

Sign in on the [live app](https://civic-nest-client.vercel.app/Login); its **Reviewer demo** buttons fill the details in. Google sign-in also works and creates a regular account that starts as a guest.

**Creating the accounts:** an admin clicks **Admin → Users → Set up reviewer logins** (`POST /admin/reviewer-accounts`), or run `npm run seed:reviewers`. Both create Firebase users with verified emails plus matching MongoDB profiles, and running either again resets them. Set `REVIEWER_PASSWORD` for a different password.

Demo accounts are flagged `isDemo`: nobody can change their role, and they can't change anyone else's.

---

## Stack

* Node.js and **Express 5**
* **MongoDB Atlas** through the native driver and Mongoose, plus **Prisma 6** for tickets, counters and typed user queries
* **Firebase Admin** to verify sign-in tokens
* **Socket.io** for live updates (shares the HTTP server)
* **Stripe** (BDT) and **SSLCommerz** for donations and crowdfunding
* **Google Gemini** (`@google/generative-ai`) for the AI features
* `compression`, `express-rate-limit`, CORS allow-list

---

## How a request is handled

```
Client (axios + "Authorization: Bearer <Firebase ID token>")
   │
   ▼
cors (localhost, CLIENT_URL, *.vercel.app, *.netlify.app, *.web.app)
 → compression
 → POST /api/payment/stripe-webhook   (raw body, signature checked)
 → express.json
 → router  e.g. /issues, /admin, /tickets, /ai …
      → verifyToken     Firebase Admin verifies the token, then the user's role is read from MongoDB
      → role guard      memberOnly · adminOrMod · adminOnly · creditCheck(type)
      → handler         Mongoose / MongoDB / Prisma
           → audit log (staff actions), notifications, Socket.io emit
 → JSON 404 for unknown routes → central error handler (JSON)
```

`app.set("trust proxy", 1)` is on, so rate limits see the real client IP behind Render's proxy.

---

## Roles

Ranked `guest < member < moderator < admin` (`utils/roles.js`).

| | Member | Moderator | Admin |
| --- | :---: | :---: | :---: |
| Report issues, follow own tickets, claim, prove and verify fixes, vote, post | ✓ | ✓ | ✓ |
| Issue queue: approve, reject, assign | | ✓ | ✓ |
| Ticket desk: status, priority, assignee, notes | | ✓ | ✓ |
| Review cleanup events, animal rescues and lost & found | | ✓ | ✓ |
| Pin and lock threads, approve polls, remove reported posts | | ✓ | ✓ |
| Users, roles and membership requests | | | ✓ |
| NGOs, volunteers, donations, notices, gallery | | | ✓ |
| Reveal anonymous reporters | | | ✓ |

Guards live in `middleware/`: `verifyToken`, `memberOnly` (member or above, or an approved volunteer), `adminOrMod`, `adminOnly` and `creditCheck` (a rolling 72-hour posting allowance per role). Every staff action is written to the audit log with the actor and their role.

Approving a membership request promotes a guest to member. It never demotes a moderator or admin.

---

## Issue lifecycle

| Step | Endpoint | Issue status | Ticket |
| --- | --- | --- | --- |
| Report (photos are ImgBB links) | `POST /issues` | `pending_review` | `OPEN` (created) |
| Approve / reject | `PATCH /admin/issues/:id/approve` · `/reject` | `open` / `rejected` | `TRIAGED` / `REJECTED` |
| Claim (7-day deadline) | `POST /issues/:id/claim` | `action_taken` | `IN_PROGRESS` |
| Step down | `POST /issues/:id/unclaim` | `open` | `OPEN` |
| Upload proof (optional GPS check) | `POST /issues/:id/proofs` | `pending_verification` | `IN_PROGRESS` |
| Verify (3 members, not the reporter or resolver) | `POST /issues/:id/verify` | `solved` | `RESOLVED` |

Rules the API enforces:

* An item can only be reviewed once (`409` for a second approval).
* Only the assigned resolver or staff can add proof, and only while the fix is in progress, so proof can never reopen a solved issue.
* Claim points are paid once per person per issue.
* When an issue is solved the resolver gets +50, the reporter +25 and each verifier +5, and crowdfunding held in escrow is released.

---

## Tickets

Every report gets a ticket as soon as it is filed. Tickets are stored with Prisma (`prisma/schema.prisma`):

* **Ticket:** a readable code (`CN-2026-000123`), the linked issue, status, priority, assignee, target date and a history of events.
* **Counter:** one atomic sequence, so codes never repeat, even when reports arrive at the same moment.
* **User:** the existing `users` collection, mapped for typed queries.

Priority comes from the report's urgency and sets the target date:

| Urgency | Priority | Target |
| --- | --- | --- |
| emergency | URGENT | 24 hours |
| high | HIGH | 3 days |
| medium | NORMAL | 7 days |
| low | LOW | 14 days |

Changing a ticket's status on the desk updates the issue too:

* `IN_PROGRESS` needs an assignee.
* `TRIAGED` is refused while the report still awaits review.
* `OPEN` clears the assignee.
* `RESOLVED` solves the issue and notifies the reporter.
* `REJECTED` rejects it.

Reports filed before tickets existed get one at startup.

| Endpoint | Who |
| --- | --- |
| `GET /tickets/mine` | Signed in |
| `GET /tickets/:code` | The reporter, the assignee or staff |
| `GET /tickets` | Staff. Filters: `status`, `priority`, `q`, `assignee=me`, `page`, `limit` |
| `PATCH /tickets/:code` | Staff. Body: `status`, `priority`, `assigneeEmail`, `note` |

---

## AI (Gemini)

| Endpoint | Auth | What it does |
| --- | --- | --- |
| `POST /ai/chat` | Optional | CivicBot chat, sending the last 10 messages as context |
| `POST /ai/suggest-issue` | Signed in | Category (from the list the form sends), urgency, polished description, rough cost |
| `POST /ai/summarize` | Signed in | 3–4 sentence summary of an issue and its comments |
| `POST /ai/complaint-letter` | Signed in | Formal letter to the ward office, with the ticket code (alias `/ai/generate-letter`) |
| `POST /ai/animal-tip` | Public | First-aid tip for an animal (cached, 40 per IP per day) |
| `POST /ai/detect-spam` | Signed in | Spam check for posts |

* The key can be set as `GEMINI_API_KEY` (or `GOOGLE_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`).
* Tries `gemini-2.5-flash` first (`GEMINI_MODEL` overrides it), then other Flash models. A retired model is skipped from then on, and a model that is out of quota or overloaded is rested for 30 seconds. Each request tries at most three models, with a 20-second timeout.
* **Built-in fallback:** when Gemini can't answer (no key, rejected key, quota, outage) or a user passes their daily Gemini limit, every endpoint still returns a useful answer from `services/aiFallback.js`: a guide in the chat, a keyword-based category and urgency, a first-aid checklist, a letter template, an extractive summary and a simple spam check. Responses carry `source: "gemini"` or `source: "built-in"`.
* `GET /ai/status` shows whether a key is configured, which model is answering and the last Gemini error. It never shows the key.

---

## Other API areas

| Area | Base path |
| --- | --- |
| Public stats and feed | `/public` |
| Users, profiles, leaderboard | `/users`, `/leaderboard` |
| Issue comments | `/issues/:id/comments`, `/comments` |
| Cleanup drives (RSVP, check-in code, funding) | `/cleanup-events` |
| Lost & found | `/lost-found` |
| Animal rescue, feeding drives | `/animals`, `/feeding-drives` |
| Forum, polls, notices, gallery | `/forum`, `/polls`, `/announcements`, `/gallery` |
| NGOs, volunteers, membership | `/ngos`, `/volunteers`, `/membership` |
| Notifications, posting credits | `/notifications`, `/credits` |
| Payments (Stripe, SSLCommerz) | `/api/payment` |
| Admin console (stats, queue, users, posts, donations, reviewer setup) | `/admin` |

`GET /admin/stats` returns live counts, issues by status and category, and donations for the last 7 days.

`GET /public/map` returns everything with real coordinates for the community map: approved issues, upcoming cleanup drives and animals that still need help (cached for 60 seconds).

## Demo content

`services/demoContent.js` creates a lived-in neighbourhood around Dhaka so reviewers see a working app straight away:
* 10 community members
* 12 issues at every stage, with tickets, comments, votes, crowdfunding and proofs
* 5 cleanup drives, 5 animal rescues and 5 lost & found posts

Every record has a fixed id and `isDemo: true`.

* **On startup** the server adds whatever is missing, so reviewers' actions on demo items survive restarts. It also keeps demo dates current: upcoming drives stay in the future, deadlines don't lapse and listings don't expire. Set `DEMO_CONTENT=off` to skip this.
* **Reset:** `POST /admin/demo-content` (admin, also the **Reset demo content** button in Admin → Users) or `npm run seed:demo` removes the demo records and adds them fresh.
* Real users' content is never touched.
* Images are paths like `/demo/issue-pothole.svg`, served by the client from its bundled `public/demo/` folder.

---

## Getting started

```bash
npm install            # also runs `prisma generate`
cp .env.example .env   # fill in the values below
npm run db:push        # create the Prisma indexes (tickets, counters, users)
npm run seed:reviewers # optional: create the demo accounts
npm run seed:demo      # optional: reset the demo content (also added automatically on start)
npm start              # http://localhost:3000
```

| Variable | What it is |
| --- | --- |
| `MONGODB_URI` (or `DB_USER` / `DB_PASS`) | MongoDB connection. Prisma uses `DATABASE_URL` if set, otherwise this URI with the `communityDB` database. Prisma on MongoDB needs a replica set; Atlas clusters already are one. |
| `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`, or `FIREBASE_SERVICE_ACCOUNT` (JSON string), or `FIREBASE_SERVICE_ACCOUNT_PATH` | Firebase Admin credentials, any one of the three forms |
| `CLIENT_BASE_URL`, `CLIENT_URL` | Front-end URLs: CORS allow-list; `CLIENT_BASE_URL` is also where payments redirect back to |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini key (`GOOGLE_API_KEY` also works); the model is optional (default `gemini-2.5-flash`). Without a key the AI features use built-in answers. |
| `PAYMENT_GATEWAY_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe secret key and webhook secret |
| `SSL_STORE_ID`, `SSL_STORE_PASSWD`, `SSL_IS_LIVE` | SSLCommerz store |
| `REVIEWER_PASSWORD` | Optional demo-account password (default `CivicNest@2026`) |
| `DEMO_CONTENT` | Optional. `off` stops the server adding demo content on start |
| `PORT` | Defaults to 3000 |
