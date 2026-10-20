# CivicNest Server

The Express API behind [CivicNest](https://github.com/argh-finds404/CivicNest-Client). Residents report street problems, follow each report as a ticket, join cleanups and look after the neighbourhood together.

* **Live app:** [https://civic-nest-client.vercel.app/](https://civic-nest-client.vercel.app/)
* **Client repository:** [argh-finds404/CivicNest-Client](https://github.com/argh-finds404/CivicNest-Client)

## Stack

* Node.js and Express 5
* MongoDB Atlas, through the native driver, Mongoose and Prisma 6
* Firebase Admin for sign-in tokens
* Socket.io for live updates
* Stripe and SSLCommerz for donations
* Gemini for the CivicBot assistant

## Getting started

```bash
npm install            # also runs `prisma generate`
cp .env.example .env   # fill in MongoDB, Firebase Admin and payment keys
npm run db:push        # create the Prisma indexes (tickets, counters, users)
npm run seed:reviewers # optional: create the reviewer demo accounts
npm start
```

Prisma reads `DATABASE_URL`, and falls back to `MONGODB_URI` (or `DB_USER`/`DB_PASS`) with the `communityDB` database. Prisma's MongoDB support needs a replica set. Atlas clusters already are one.

## Reviewer accounts

Three demo accounts, one per role. Sign in with them on the [live app](https://civic-nest-client.vercel.app/Login) (the **Reviewer demo** buttons fill them in for you).

An admin creates them from **Admin → Users → Set up reviewer logins** (`POST /admin/reviewer-accounts`), or with `npm run seed:reviewers`. Both create Firebase users with verified emails and matching profiles; running either again resets them to a clean state.

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin.reviewer@civicnest.app` | `CivicNest@2026` |
| Moderator | `moderator.reviewer@civicnest.app` | `CivicNest@2026` |
| Member | `member.reviewer@civicnest.app` | `CivicNest@2026` |

Set `REVIEWER_PASSWORD` to use a different password. The script needs the Firebase Admin credentials (`FIREBASE_SERVICE_ACCOUNT` or `FIREBASE_SERVICE_ACCOUNT_PATH`) and the database URL. Demo accounts are flagged `isDemo`: nobody can change their role, and they cannot change anyone's role either.

## Roles

Roles are ranked `guest < member < moderator < admin` (`utils/roles.js`).

| | Member | Moderator | Admin |
| --- | :---: | :---: | :---: |
| Report issues, follow own tickets, vote, post | ✓ | ✓ | ✓ |
| Issue queue: approve, reject, change status, assign | | ✓ | ✓ |
| Ticket desk: priority, assignee, notes | | ✓ | ✓ |
| Review cleanup events and animal rescues | | ✓ | ✓ |
| Moderate threads and polls | | ✓ | ✓ |
| Users, roles and membership requests | | | ✓ |
| NGOs, volunteers, donations, notices, gallery | | | ✓ |
| Reveal anonymous reporters | | | ✓ |

Route guards live in `middleware/`: `verifyToken`, `memberOnly`, `adminOrMod` (staff) and `adminOnly`. Staff actions are written to the audit log with the actor's role.

## Tickets

Every report gets a ticket as soon as it is filed. Tickets are stored with Prisma (`prisma/schema.prisma`):

* **Ticket**: a readable code (`CN-2026-000123`), the linked issue, status, priority, assignee, target date and a history of events.
* **Counter**: one atomic sequence, so codes never repeat, even when reports arrive at the same moment.
* **User**: the existing `users` collection, mapped for typed queries.

Status follows the issue:

| Issue status | Ticket status |
| --- | --- |
| `pending`, `open` | `OPEN` |
| `in_review` | `TRIAGED` |
| `action_taken`, `pending_verification` | `IN_PROGRESS` |
| `solved` | `RESOLVED` |
| `rejected` | `REJECTED` |

Priority comes from the report's urgency and sets the target date: urgent 24 hours, high 3 days, normal 7 days, low 14 days. Reports filed before tickets existed get one at startup.

| Endpoint | Who |
| --- | --- |
| `GET /tickets/mine` | Signed in |
| `GET /tickets/:code` | The reporter, the assignee or staff |
| `GET /tickets` | Staff. Filters: `status`, `priority`, `q`, `assignee=me`, `page`, `limit` |
| `PATCH /tickets/:code` | Staff. Body: `status`, `priority`, `assigneeEmail`, `note` |
