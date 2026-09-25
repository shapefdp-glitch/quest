# QuestPrint — Pilot: Privacy, Classes & Enrollment

This version extends the PostgreSQL + authentication pilot with two school-pilot capabilities:

1. **Privacy and consent controls** — required Terms/Privacy consent, optional AI personalization, optional de-identified research opt-in, consent history, privacy preferences, and account/data deletion.
2. **Classes and enrollment** — teachers create classes and share join codes; students join classes; teachers see rosters and assign their curriculum objectives to specific classes. Students only receive published objectives assigned through an active class membership.

## Stack
- Node.js + Express
- PostgreSQL
- `pg` + `connect-pg-simple`
- bcrypt password hashing
- Server-side sessions
- OpenAI Responses API for curriculum-grounded quest generation

## Run

### 1. Start PostgreSQL

With Docker:

```bash
docker compose up -d
```

Or point `DATABASE_URL` at an existing PostgreSQL database.

### 2. Configure environment

Copy `.env.example` to `.env` and set:

- `DATABASE_URL`
- `SESSION_SECRET` — long random production secret
- `TEACHER_INVITE_CODE` — administrator-controlled code for teacher self-registration
- `OPENAI_API_KEY` — optional until AI quest generation is enabled
- `OPENAI_MODEL` — defaults to `gpt-5.6-luna` in this prototype

### 3. Install and run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Demo accounts

Teacher:
- `teacher@questprint.local`
- `Teacher123!`

Student:
- `student@questprint.local`
- `Student123!`

The demo student is enrolled in **Demo Grade 4 Science** and the seeded science objective is assigned to that class.

## Privacy model

Required:
- Terms consent
- Privacy Notice consent

Optional:
- AI personalization
- De-identified research/benchmark data

The application records consent version and timestamps. Turning off AI personalization prevents the AI quest endpoint from using the learner's personalized evidence. Account deletion cascades through the learner, event, class-membership and related records in PostgreSQL.

**Pilot note:** the in-app consent flow is an implementation control, not legal/IRB approval. For minors, deploy the institution's approved parental/guardian consent process before collecting real learner data.

## Class model

Teacher → Class → Student membership → Assigned curriculum objectives → Learning events.

Students do not see every published objective in the database. They see only published objectives assigned to classes in which they are active members.

## Production hardening before real school deployment

- HTTPS and secure production cookies
- managed secrets
- CSRF protection / origin validation
- rate limiting and login throttling
- verified teacher/institution onboarding rather than shared invite codes
- institution-approved privacy/guardian consent workflow for minors
- backups and database retention policy
- audit logging
- de-identification pipeline for research exports
- class-level authorization tests
- managed PostgreSQL
