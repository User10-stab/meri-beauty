/**
 * Next.js server-startup hook (stable since Next 15, runs once per process,
 * before any request is handled). Used here to start the in-process job
 * scheduler — see lib/background-jobs.js for what it runs and why.
 *
 * Guarded to the Node.js runtime only: this file is also invoked once for
 * the Edge runtime in some setups, and setInterval + Prisma have no business
 * running there.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundJobs } = await import("@/lib/background-jobs");
    startBackgroundJobs();
  }
}
