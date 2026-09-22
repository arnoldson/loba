#!/usr/bin/env node
// scripts/check-cron-jobs.mjs
//
// Alerting check for the pg_cron archive + hard-delete jobs (#31, follow-up
// to #13). Those jobs' failures only ever show up in cron.job_run_details —
// nothing was polling that table, so a failed or silently-stopped run went
// unnoticed.
//
// This queries cron.job_run_details for each known job and fails (non-zero
// exit) if a recent run errored, or if no run happened recently enough to
// match the job's own schedule (catches the job silently stopping, not just
// a run that fired and errored). It's run on a schedule by
// .github/workflows/cron-job-health.yml, which relies on GitHub's built-in
// "scheduled workflow failed" notification to do the actual alerting — zero
// extra config required. If ALERT_WEBHOOK_URL is also set, it additionally
// POSTs a summary there (Slack-compatible JSON body).
//
// Usage:
//   DATABASE_URL=... node scripts/check-cron-jobs.mjs

import pg from "pg"

const { Client } = pg

const JOBS = [
  // archive-expired-posts runs every 15 min; allow a couple of missed
  // cycles before treating it as stopped rather than just briefly delayed.
  { name: "archive-expired-posts", maxStalenessMinutes: 60 },
  // hard-delete-old-posts runs once daily at 3am UTC.
  { name: "hard-delete-old-posts", maxStalenessMinutes: 27 * 60 },
]

if (!process.env.DATABASE_URL) {
  console.error("[check-cron-jobs] DATABASE_URL environment variable is not set")
  process.exit(1)
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("supabase.com") ? { rejectUnauthorized: false } : false,
})

function log(msg) {
  console.log(`[check-cron-jobs] ${msg}`)
}

async function checkJob(job) {
  const problems = []

  const { rows: jobRows } = await client.query(
    `SELECT jobid, active FROM cron.job WHERE jobname = $1`,
    [job.name]
  )

  if (jobRows.length === 0) {
    problems.push(`"${job.name}" is not registered in cron.job at all (was it dropped or renamed?)`)
    return problems
  }

  const { jobid, active } = jobRows[0]
  if (!active) {
    problems.push(`"${job.name}" (jobid ${jobid}) exists but is marked inactive in cron.job`)
  }

  const { rows: runRows } = await client.query(
    `SELECT status, return_message, start_time
     FROM cron.job_run_details
     WHERE jobid = $1 AND start_time > now() - make_interval(mins => $2::int)
     ORDER BY start_time DESC`,
    [jobid, job.maxStalenessMinutes]
  )

  if (runRows.length === 0) {
    problems.push(
      `"${job.name}" (jobid ${jobid}) has no run recorded in the last ${job.maxStalenessMinutes} minutes — it may have stopped firing`
    )
    return problems
  }

  for (const run of runRows.filter((r) => r.status !== "succeeded")) {
    problems.push(
      `"${job.name}" run at ${run.start_time.toISOString()} reported status "${run.status}": ${
        run.return_message || "(no message)"
      }`
    )
  }

  return problems
}

async function alertWebhook(problems) {
  const url = process.env.ALERT_WEBHOOK_URL
  if (!url) return

  const text = `🚨 pg_cron job health check failed:\n${problems.map((p) => `• ${p}`).join("\n")}`

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      console.error(`[check-cron-jobs] webhook POST failed: ${res.status} ${res.statusText}`)
    }
  } catch (err) {
    console.error(`[check-cron-jobs] webhook POST errored: ${err.message}`)
  }
}

async function main() {
  await client.connect()

  const allProblems = []
  for (const job of JOBS) {
    const problems = await checkJob(job)
    if (problems.length === 0) {
      log(`✅ ${job.name} looks healthy`)
    } else {
      for (const p of problems) console.error(`❌ ${p}`)
      allProblems.push(...problems)
    }
  }

  await client.end()

  if (allProblems.length > 0) {
    await alertWebhook(allProblems)
    console.error(`\n${allProblems.length} problem(s) found with pg_cron jobs.`)
    process.exit(1)
  }

  log("All pg_cron jobs healthy.")
  process.exit(0)
}

main().catch(async (err) => {
  console.error(`[check-cron-jobs] check itself failed: ${err.message}`)
  await alertWebhook([`Health check script errored before completing: ${err.message}`]).catch(() => {})
  process.exit(1)
})
