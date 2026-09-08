/**
 * Mailpit, the dev inbox.
 *
 * `EMAIL_PROVIDER=mailpit` is one of the four rails this suite refuses to run
 * without (env-guard.mjs), and the reason is that these flows really do send:
 * the dev database holds real customer addresses, and a sent e-mail is the
 * only thing here that cannot be undone. Everything therefore lands in a
 * local SMTP sink instead, and this reads it back.
 *
 * Worth knowing before relying on an assertion here: **the application
 * swallows send failures.** `sendEmail` resolves `{ success: false }` rather
 * than throwing, and most callers only log it. So if the Mailpit *process* is
 * not running, nothing breaks visibly — the send simply fails into the dev
 * server log (E2 in E2E_FINDINGS.md) and any "the customer was told"
 * assertion becomes quietly meaningless. `requireMailpit` exists so that
 * shows up as a clear failure rather than a confusing one.
 */

const MAILPIT_API = process.env.MAILPIT_API_URL || "http://localhost:8025";

async function api(path) {
  const response = await fetch(`${MAILPIT_API}${path}`);
  if (!response.ok) {
    throw new Error(`Mailpit ${path} answered ${response.status}. Is it running on ${MAILPIT_API}?`);
  }
  return response.json();
}

/**
 * Fails loudly if the inbox is unreachable, rather than letting every
 * e-mail assertion below silently pass on an empty result.
 */
export async function requireMailpit() {
  try {
    await api("/api/v1/messages?limit=1");
  } catch (error) {
    throw new Error(
      `Mailpit is not reachable at ${MAILPIT_API}. EMAIL_PROVIDER=mailpit satisfies the env guard, but the ` +
        "process itself has to be running or every send fails with ECONNREFUSED into the dev server log " +
        "and no assertion about e-mail means anything.\n\n" +
        "  mailpit --smtp 0.0.0.0:1025 --listen 0.0.0.0:8025\n\n" +
        `Underlying error: ${error.message}`,
    );
  }
}

/**
 * Polls for one message to `recipient` whose subject matches, and returns it
 * with its attachment list resolved.
 *
 * Scoped to a recipient rather than "the newest message": this inbox is
 * shared with every other scenario in the run — 159 messages after an
 * afternoon of them — so taking the latest would routinely pick up somebody
 * else's and assert against the wrong document.
 *
 * @param {{ to: string, subject?: RegExp, timeout?: number }} input
 */
export async function waitForEmail({ to, subject = null, timeout = 30_000 }) {
  const deadline = Date.now() + timeout;
  let seen = [];

  while (Date.now() < deadline) {
    // Mailpit's search syntax; the quotes matter for an address.
    const results = await api(`/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=25`);
    seen = results.messages ?? [];
    const match = subject ? seen.find((message) => subject.test(message.Subject ?? "")) : seen[0];
    if (match) {
      // The summary omits attachments; only the full message carries them.
      return api(`/api/v1/message/${match.ID}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `No e-mail to ${to}${subject ? ` with a subject matching ${subject}` : ""} arrived within ` +
      `${Math.round(timeout / 1000)}s. ${seen.length} message(s) to that address were seen: ` +
      `${seen.map((message) => message.Subject).join(" | ") || "none"}`,
  );
}

/**
 * The other direction of waitForEmail: proving a message never arrives.
 *
 * There is no way to poll for an absence the way waitForEmail polls for a
 * presence — a short window merely proves "not yet". What makes that
 * tolerable here is that `sendEmail` is either called synchronously in the
 * same request that already completed (nothing pending to race), or not
 * called at all; there is no async dispatch this could catch mid-flight. The
 * wait is still real time, not a formality: Resend/Mailpit round-trips other
 * scenarios in this suite in well under a second, so several seconds of
 * silence on a matching subject is meaningful, not merely "checked too soon".
 *
 * @param {{ to: string, subject?: RegExp, timeout?: number }} input
 */
export async function assertNoEmail({ to, subject = null, timeout = 8_000 }) {
  const deadline = Date.now() + timeout;
  let match = null;

  while (Date.now() < deadline && !match) {
    const results = await api(`/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=25`);
    const seen = results.messages ?? [];
    match = subject ? seen.find((message) => subject.test(message.Subject ?? "")) : seen[0];
    if (!match) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  if (match) {
    throw new Error(
      `Expected no e-mail to ${to}${subject ? ` matching ${subject}` : ""}, but "${match.Subject}" arrived.`,
    );
  }
}
