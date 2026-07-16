import { NextResponse } from "next/server";

/**
 * Centralised HTTP response factory.
 * Every API route returns a consistent JSON envelope:
 *   { success, message, data?, errors? }
 */

export function ok(data, message = "Succès.", status = 200) {
  return NextResponse.json({ success: true, message, data }, { status });
}

export function created(data, message = "Ressource créée avec succès.") {
  return NextResponse.json({ success: true, message, data }, { status: 201 });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function badRequest(message = "Requête invalide.", errors = null) {
  return NextResponse.json(
    { success: false, message, ...(errors && { errors }) },
    { status: 400 }
  );
}

export function unauthorized(message = "Authentification requise.") {
  return NextResponse.json({ success: false, message }, { status: 401 });
}

export function forbidden(
  message = "Vous n'êtes pas autorisé à effectuer cette action."
) {
  return NextResponse.json({ success: false, message }, { status: 403 });
}

export function notFound(message = "Ressource introuvable.") {
  return NextResponse.json({ success: false, message }, { status: 404 });
}

export function conflict(message = "Conflit de données.") {
  return NextResponse.json({ success: false, message }, { status: 409 });
}

export function unprocessable(message, errors = null) {
  return NextResponse.json(
    { success: false, message, ...(errors && { errors }) },
    { status: 422 }
  );
}

export function serverError(
  message = "Une erreur inattendue s'est produite. Veuillez réessayer."
) {
  return NextResponse.json({ success: false, message }, { status: 500 });
}

/**
 * Maps a Prisma error code to an HTTP response.
 * Returns null if the code is not handled (caller should fall through to 500).
 */
export function prismaError(error) {
  if (error.code === "P2002") {
    const fields = error.meta?.target ?? [];
    const fieldMap = {
      email: "Cette adresse e-mail est déjà utilisée.",
      phone: "Ce numéro de téléphone est déjà utilisé.",
    };
    const known = fields.find((f) => fieldMap[f]);
    return conflict(
      known ? fieldMap[known] : "Un enregistrement avec ces données existe déjà."
    );
  }
  if (error.code === "P2025") {
    return notFound("L'enregistrement ciblé est introuvable.");
  }
  if (error.code === "P2003" || error.code === "P2014") {
    return conflict(
      "Impossible de modifier cette ressource : des enregistrements liés existent."
    );
  }
  return null;
}
