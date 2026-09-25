# QuestPrint — Railway Deployment

This package runs as one Railway project with a Node.js/Express QuestPrint service and a Railway-managed PostgreSQL service.

## 1. Push to GitHub
Create a private repository and upload this folder. Do not commit `.env` or real secrets.

## 2. Create Railway project
1. Create a new Railway project.
2. Choose **Deploy from GitHub repo**.
3. Select the QuestPrint repository.

## 3. Add PostgreSQL
In the same project: **+ New → Database → PostgreSQL**.

## 4. Connect the database
Open the QuestPrint service → **Variables** and add:

`DATABASE_URL=${{Postgres.DATABASE_URL}}`

If your database service has another name, use that service name instead of `Postgres`.

## 5. Add production variables
Set:

- `NODE_ENV=production`
- `SESSION_SECRET=<long random secret>`
- `OPENAI_API_KEY=<your OpenAI API key>`
- `OPENAI_MODEL=gpt-5.6-luna`

Optional:

- `TEACHER_INVITE_CODE=<private teacher invite code>`

Never expose the OpenAI key or database URL in frontend code.

## 6. Initialize PostgreSQL
After the first deployment, run:

`npm run db:init`

Or with Railway CLI:

`railway run npm run db:init`

The script applies `schema.sql` using `DATABASE_URL`.

## 7. Generate the public URL
Go to **QuestPrint service → Settings → Networking → Generate Domain**.

## 8. Verify
Open `/api/health`, then test teacher login, consent, class creation, objective creation/publication, student login/consent, class joining, objective visibility, quest generation, and persistence after refresh.

## 9. Before real learners
Use approved institutional/guardian consent procedures for minors, define retention/deletion rules, replace demo credentials, use a strong session secret, keep PostgreSQL private, and establish backups/monitoring.

## Railway CLI alternative
`railway login`

`railway init`

`railway add --database postgres`

`railway up`

Then set `DATABASE_URL=${{Postgres.DATABASE_URL}}` and generate a domain.

## Notes
The app listens on Railway's `PORT`. `railway.json` configures `/api/health` as the deployment health check. The database initialization script is for initial setup; use versioned migrations for frequent production schema changes.
