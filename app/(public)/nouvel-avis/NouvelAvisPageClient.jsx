"use client";

import { useState, useEffect } from "react";
import { getReviewTargetFromToken, submitReviewWithToken } from "@/actions/review/token-review-actions";

function StarRating({ rating, setRating, disabled }) {
  const [hover, setHover] = useState(0);

  return (
    <div style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={disabled}
          onClick={() => setRating(star)}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          style={{
            background: "none",
            border: "none",
            cursor: disabled ? "default" : "pointer",
            fontSize: "36px",
            color: star <= (hover || rating) ? "#f59e0b" : "#d1d5db",
            transition: "color 0.15s, transform 0.15s",
            transform: star <= (hover || rating) ? "scale(1.15)" : "scale(1)",
            padding: "2px",
          }}
          aria-label={`${star} étoile${star > 1 ? "s" : ""}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function formatDate(date) {
  if (!date) return "";
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

export function NouvelAvisPageClient({ token }) {
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState(null);
  const [error, setError] = useState(null);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (!token) {
      setError("Lien invalide. Aucun jeton de vérification trouvé.");
      setLoading(false);
      return;
    }

    getReviewTargetFromToken(token).then((result) => {
      if (result.success) {
        setTarget(result.data);
      } else if (result.alreadyReviewed) {
        setAlreadyReviewed(true);
      } else {
        setError(result.error || "Lien invalide ou expiré.");
      }
      setLoading(false);
    });
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (rating < 1) {
      setSubmitError("Veuillez sélectionner une note.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const result = await submitReviewWithToken({ token, rating, comment });
    if (result.success) {
      setSubmitted(true);
    } else {
      setSubmitError(result.error || "Une erreur est survenue.");
    }
    setSubmitting(false);
  }

  const containerStyle = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
    background: "linear-gradient(135deg, #f9f8f5 0%, #f0ede6 100%)",
  };

  const cardStyle = {
    background: "#ffffff",
    borderRadius: "16px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
    padding: "40px 32px",
    maxWidth: "520px",
    width: "100%",
    textAlign: "center",
  };

  const brandColor = "#C8A46A";
  const darkColor = "#2F3A2E";

  // Loading state
  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: "32px", marginBottom: "16px" }}>⏳</div>
          <p style={{ color: "#888", fontSize: "15px" }}>Chargement en cours…</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: "32px", marginBottom: "16px" }}>😕</div>
          <h2 style={{ color: darkColor, fontSize: "20px", margin: "0 0 12px" }}>Lien invalide</h2>
          <p style={{ color: "#666", fontSize: "14px", lineHeight: "1.6" }}>{error}</p>
          <a
            href="/"
            style={{
              display: "inline-block",
              marginTop: "20px",
              padding: "10px 24px",
              background: brandColor,
              color: "#fff",
              borderRadius: "24px",
              textDecoration: "none",
              fontWeight: "600",
              fontSize: "14px",
            }}
          >
            Retour à l&apos;accueil
          </a>
        </div>
      </div>
    );
  }

  // Already reviewed
  if (alreadyReviewed) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: "32px", marginBottom: "16px" }}>💛</div>
          <h2 style={{ color: darkColor, fontSize: "20px", margin: "0 0 12px" }}>Merci !</h2>
          <p style={{ color: "#666", fontSize: "14px", lineHeight: "1.6" }}>
            Vous avez déjà laissé un avis pour cette prestation. Nous vous remercions chaleureusement !
          </p>
          <a
            href="/"
            style={{
              display: "inline-block",
              marginTop: "20px",
              padding: "10px 24px",
              background: brandColor,
              color: "#fff",
              borderRadius: "24px",
              textDecoration: "none",
              fontWeight: "600",
              fontSize: "14px",
            }}
          >
            Retour à l&apos;accueil
          </a>
        </div>
      </div>
    );
  }

  // Submitted successfully
  if (submitted) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: "40px", marginBottom: "16px" }}>🎉</div>
          <h2 style={{ color: darkColor, fontSize: "22px", margin: "0 0 12px" }}>Merci beaucoup !</h2>
          <p style={{ color: "#555", fontSize: "15px", lineHeight: "1.6", marginBottom: "8px" }}>
            Votre avis a été enregistré avec succès.
          </p>
          <div style={{ margin: "16px 0", fontSize: "28px", color: "#f59e0b", letterSpacing: "4px" }}>
            {"★".repeat(rating)}{"☆".repeat(5 - rating)}
          </div>
          {comment && (
            <p style={{ color: "#888", fontSize: "13px", fontStyle: "italic", margin: "0 0 20px" }}>
              « {comment} »
            </p>
          )}
          <p style={{ color: "#666", fontSize: "14px", lineHeight: "1.6" }}>
            Votre retour est précieux et nous aide à nous améliorer chaque jour.
          </p>
          <a
            href="/"
            style={{
              display: "inline-block",
              marginTop: "24px",
              padding: "12px 28px",
              background: brandColor,
              color: "#fff",
              borderRadius: "24px",
              textDecoration: "none",
              fontWeight: "600",
              fontSize: "14px",
            }}
          >
            Découvrir Meri Beauty
          </a>
        </div>
      </div>
    );
  }

  // Review form
  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ fontSize: "32px", marginBottom: "8px" }}>✨</div>
        <h1 style={{ color: darkColor, fontSize: "22px", margin: "0 0 6px", fontWeight: "700" }}>
          Votre avis compte !
        </h1>
        <p style={{ color: "#888", fontSize: "13px", margin: "0 0 20px" }}>
          {target.serviceName}{target.staffName ? ` avec ${target.staffName}` : ""}
          {target.date ? ` · ${formatDate(target.date)}` : ""}
        </p>

        <form onSubmit={handleSubmit}>
          {/* Stars */}
          <div style={{ marginBottom: "24px" }}>
            <p style={{ color: "#555", fontSize: "14px", margin: "0 0 10px" }}>
              Comment évaluez-vous votre expérience ?
            </p>
            <StarRating rating={rating} setRating={setRating} disabled={submitting} />
            {rating > 0 && (
              <p style={{ color: brandColor, fontSize: "13px", margin: "8px 0 0", fontWeight: "600" }}>
                {["", "Décevant", "Moyen", "Bien", "Très bien", "Excellent"][rating]}
              </p>
            )}
          </div>

          {/* Comment */}
          <div style={{ marginBottom: "24px", textAlign: "left" }}>
            <label
              htmlFor="review-comment"
              style={{ display: "block", color: "#555", fontSize: "14px", marginBottom: "6px" }}
            >
              Un commentaire ? <span style={{ color: "#bbb" }}>(facultatif)</span>
            </label>
            <textarea
              id="review-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={submitting}
              maxLength={1000}
              rows={4}
              placeholder="Partagez votre retour…"
              style={{
                width: "100%",
                padding: "12px 14px",
                border: "1px solid #e0ddd8",
                borderRadius: "10px",
                fontSize: "14px",
                lineHeight: "1.5",
                resize: "vertical",
                fontFamily: "inherit",
                background: "#faf9f7",
                outline: "none",
                transition: "border-color 0.2s",
                boxSizing: "border-box",
              }}
              onFocus={(e) => (e.target.style.borderColor = brandColor)}
              onBlur={(e) => (e.target.style.borderColor = "#e0ddd8")}
            />
            <p style={{ color: "#ccc", fontSize: "11px", textAlign: "right", margin: "4px 0 0" }}>
              {comment.length}/1000
            </p>
          </div>

          {/* Error */}
          {submitError && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "8px",
                padding: "10px 14px",
                marginBottom: "16px",
                color: "#dc2626",
                fontSize: "13px",
              }}
            >
              {submitError}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || rating < 1}
            style={{
              width: "100%",
              padding: "14px 24px",
              background: rating < 1 ? "#d1d5db" : brandColor,
              color: "#fff",
              border: "none",
              borderRadius: "28px",
              fontSize: "16px",
              fontWeight: "700",
              cursor: rating < 1 || submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.7 : 1,
              transition: "background 0.2s, opacity 0.2s",
              boxShadow: rating >= 1 ? "0 4px 14px rgba(200,164,106,0.35)" : "none",
            }}
          >
            {submitting ? "Envoi en cours…" : "Envoyer mon avis"}
          </button>
        </form>

        <p style={{ color: "#bbb", fontSize: "11px", margin: "20px 0 0", lineHeight: "1.5" }}>
          En soumettant cet avis, vous acceptez qu&apos;il soit visible publiquement sur notre site.
        </p>
      </div>
    </div>
  );
}
