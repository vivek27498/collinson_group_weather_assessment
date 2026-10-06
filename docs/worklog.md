# Worklog

Unpolished notes on how the work is going, newest last. Cuts and the reasons for them go here too.

## 2026-10-06: planning
- Read the brief. It is deliberately loose, and it grades *how I worked* above the service itself. So decisions, assumptions and open questions get written down as I go.
- Chose a focused design over an exhaustive one: hexagonal-lite layers, pure Strategy scorers, normalised weather stored and scores computed at read time.
- Decisions so far (reasons are in docs/plan.md):
  - **MySQL + Prisma**: Sequelize rejected for weak TypeScript types; Drizzle for being less familiar to reviewers.
  - **Jest (ts-jest)**: chosen for team familiarity; CommonJS build avoids ESM friction.
  - **Zod**: types inferred from schemas, so no drift (Joi rejected for that reason).
  - **Apollo Server 4 + Express**.
  - **No multi-tenancy**: weather is not tenant data and the brief asks for focus. The README will say what real tenancy would add.
- Open-Meteo's free tier is non-commercial with a daily call limit, so load tests will run against a mock upstream and never the real API.
- Next: milestone 1 (scaffold) in docs/plan.md.

## Resuming on another machine
1. `git pull`
2. Start Claude Code in the repo and say: "Read docs/plan.md and docs/worklog.md, then continue from the next milestone."
3. Commit small and often; update this file at the end of each session.
