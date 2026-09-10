import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import { resendMonthlyInvoiceEmail } from "@/lib/staff-monthly-billing";

/**
 * POST /api/staff-invoices/:id/resend
 *
 * Manually resends the invoice email for a given StaffMonthlyInvoice id.
 * The :id here is the StaffMonthlyInvoice row id, not the Invoice id.
 *
 * Returns { success: boolean, error?: string }.
 *
 * Used by the admin invoice history page as a fallback for rows with status
 * EMAIL_FAILED — see StaffInvoicesClient.jsx's handleResend() for the
 * client-side call (which uses the server action instead of this route).
 * This REST endpoint is provided for external tooling / scripts.
 */
export async function POST(req, { params }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const result = await resendMonthlyInvoiceEmail(id);

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
