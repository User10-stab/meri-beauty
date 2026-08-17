import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

const WAITING_LISTS = [
  ["actions/workshops/waiting-list.js", "joinWaitingList"],
  ["actions/formations/waiting-list.js", "joinFormationWaitingList"],
];

describe("joining a waiting list is guarded and recorded like every other entry point", () => {
  test.each(WAITING_LISTS)("%s enforces consent server-side", (file) => {
    const content = source(file);
    expect(content).toContain("termsAccepted !== true");
    expect(content).toContain("buildTermsAcceptanceUpdate()");
    expect(content).toContain("recordTermsAcceptance(prisma, user.id)");
  });

  // The existence check and the position calculation are read-then-write. A
  // double-click previously produced two rows for one customer, and two people
  // told they were "position #3". There is no unique constraint to lean on.
  test.each(WAITING_LISTS)("%s serialises joins per session", (file) => {
    const content = source(file);
    expect(content).toContain("pg_advisory_xact_lock");
    expect(content).toContain("prisma.$transaction(async (tx) =>");
    // The whole read-then-write pair must be inside the transaction.
    const txStart = content.indexOf("prisma.$transaction(async (tx) =>");
    const create = content.indexOf("tx.waitingListEntry.create");
    const lookup = content.indexOf("tx.waitingListEntry.findFirst");
    expect(lookup).toBeGreaterThan(txStart);
    expect(create).toBeGreaterThan(lookup);
  });

  test.each(WAITING_LISTS)("%s reports an existing entry instead of silently re-confirming", (file) => {
    const content = source(file);
    expect(content).toContain("alreadyOnList: true");
    expect(content).toContain("alreadyOnList: false");
    // The early return must come before the confirmation email, so nobody is
    // emailed twice for a place they already hold.
    const earlyReturn = content.indexOf("if (alreadyOnList)");
    const email = content.indexOf("sendEmail({\n      to: email,\n      ...");
    expect(earlyReturn).toBeGreaterThan(-1);
    if (email > -1) expect(email).toBeGreaterThan(earlyReturn);
  });

  test("the email-probing status endpoints are gone", () => {
    // Unused "use server" exports that answered "is this address on the
    // waiting list for this session?" for any email a caller supplied.
    for (const [file] of WAITING_LISTS) {
      expect(source(file)).not.toContain("export async function checkWaitingListStatus");
      expect(source(file)).not.toContain("export async function checkFormationWaitingListStatus");
    }
  });
});

describe("the waiting-list screens explain what joining actually does", () => {
  const PAGES = [
    "app/(public)/reservation-atelier/page.js",
    "app/(public)/reservation-formation/page.js",
  ];

  test.each(PAGES)("%s sends the consent flag", (page) => {
    expect(source(page)).toContain("termsAccepted: acceptedTerms");
  });

  test.each(PAGES)("%s warns before submitting, not only after", (page) => {
    const content = source(page);
    expect(content).toContain("Cette session est complète — vous rejoignez la liste d&apos;attente");
    expect(content).toContain("Vous ne payez rien maintenant");
  });

  test.each(PAGES)("%s states that a position is not a guaranteed priority", (page) => {
    expect(source(page)).toContain("votre position n&apos;est pas une priorité garantie");
  });

  test.each(PAGES)("%s distinguishes a repeat submission", (page) => {
    const content = source(page);
    expect(content).toContain("wlSuccess.alreadyOnList");
    expect(content).toContain("Vous étiez déjà sur la liste d'attente");
  });
});

// The jobs run in-process on an interval started from instrumentation.js.
// PM2 keeps the process alive, but nothing previously reported whether the
// scheduler inside it was still ticking.
describe("the in-process scheduler is observable", () => {
  const jobs = source("lib/background-jobs.js");
  const health = source("app/api/health/route.js");

  test("a heartbeat is recorded on every tick, including failing ones", () => {
    expect(jobs).toContain("export function getJobsHeartbeat");
    expect(jobs).toContain("beat.lastRunAt = Date.now()");
    // Written after allSettled — a thrown job is still a live tick.
    expect(jobs.indexOf("const settled = await Promise.allSettled")).toBeLessThan(
      jobs.indexOf("beat.lastRunAt = Date.now()")
    );
    expect(jobs).toContain("beat.lastFailedJobs = failedJobs");
  });

  test("the heartbeat survives hot reload re-importing the module", () => {
    expect(jobs).toContain("globalThis.__meriJobsHeartbeat");
  });

  test("the interval never holds the process open across a restart", () => {
    expect(jobs).toContain("setInterval(runJobs, INTERVAL_MS).unref()");
  });

  test("liveness is a real HTTP status, not just a body an uptime check ignores", () => {
    expect(health).toContain("const healthy = databaseUp && heartbeat.running");
    expect(health).toContain("const status = healthy ? 200 : 503");
  });

  test("detail is behind the cron secret; the public shape leaks nothing", () => {
    expect(health).toContain("isValidCronSecret");
    const publicBranch = health.slice(health.indexOf("if (!detailed)"), health.indexOf("return NextResponse.json(\n    {\n      status: healthy"));
    expect(publicBranch).not.toContain("lastFailedJobs");
    expect(publicBranch).not.toContain("timezone");
  });
});
