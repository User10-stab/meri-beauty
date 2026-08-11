const email = process.argv[2]?.trim().toLowerCase();
const baseUrl = (process.env.MAILPIT_HTTP_URL || "http://127.0.0.1:8025").replace(/\/$/, "");

if (!email) throw new Error("Usage: node scripts/e2e/get-mailpit-verification-link.mjs <email>");
if (process.env.NODE_ENV === "production") throw new Error("This E2E helper is disabled in production.");

const listResponse = await fetch(`${baseUrl}/api/v1/messages?limit=100`);
if (!listResponse.ok) throw new Error(`Mailpit inbox unavailable (${listResponse.status}).`);
const list = await listResponse.json();
const messages = list.messages ?? list.Messages ?? [];
const message = messages.find((item) => JSON.stringify(item).toLowerCase().includes(email));
if (!message) throw new Error(`No Mailpit message found for ${email}.`);

const id = message.ID ?? message.id;
const detailResponse = await fetch(`${baseUrl}/api/v1/message/${id}`);
if (!detailResponse.ok) throw new Error(`Cannot read Mailpit message ${id}.`);
const detail = await detailResponse.json();
const body = [detail.Text, detail.HTML, detail.text, detail.html].filter(Boolean).join("\n");
const match = body.match(/https?:\/\/[^\s"'<]*\/verify-email\?token=[^\s"'<]+/);
if (!match) throw new Error("Verification link not found in the Mailpit message.");

console.log(match[0].replace(/&amp;/g, "&"));
