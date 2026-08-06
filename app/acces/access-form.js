"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowIcon } from "@/components/website/icons";
import { Lock, Loader2 } from "lucide-react";
import { unlockSite } from "@/actions/site-access";

export default function AccessForm() {
  const [showForm, setShowForm] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (loading) return;
    setLoading(true);
    setError("");

    const result = await unlockSite(password);

    if (result.success) {
      window.location.href = "/";
      return;
    }

    setError(result.message || "Une erreur est survenue. Veuillez réessayer.");
    setLoading(false);
  };

  return (
    <div className="mt-10">
      <AnimatePresence mode="wait" initial={false}>
        {!showForm ? (
          <motion.div
            key="cta"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="group relative inline-flex items-center gap-3 overflow-hidden rounded-full bg-gold px-10 py-4 text-[15px] font-semibold text-white shadow-lg shadow-gold/25 transition-all duration-300 hover:shadow-xl hover:shadow-gold/40"
            >
              {/* Shine sweep */}
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />

              <span className="relative">Accéder</span>
              <ArrowIcon className="relative h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </button>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-md"
          >
            <div className="relative overflow-hidden rounded-2xl border border-gold/25 bg-black/30 p-6 shadow-2xl shadow-black/40 backdrop-blur-md">
              {/* Top gold accent */}
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold to-transparent" />

              <div className="mb-5 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/15 text-gold">
                  <Lock className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">
                    Accès membre autorisé
                  </p>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                    Entrez le mot de passe
                  </p>
                </div>
              </div>

              <label
                htmlFor="access-password"
                className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-gold"
              >
                Mot de passe
              </label>

              <div className="relative">
                <input
                  id="access-password"
                  type="password"
                  name="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                  autoFocus
                  placeholder="••••••••"
                  disabled={loading}
                  autoComplete="current-password"
                  className="w-full rounded-full border border-white/15 bg-white/10 py-3.5 pl-11 pr-5 text-[15px] text-white placeholder-white/35 outline-none transition-all focus:border-gold focus:bg-white/15 focus:ring-2 focus:ring-gold/30 disabled:opacity-60"
                />
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
              </div>

              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 text-sm text-red-300"
                >
                  {error}
                </motion.p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="group relative mt-5 flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-gold px-8 py-3.5 text-[15px] font-semibold text-white transition-all duration-300 hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />

                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Vérification...
                  </>
                ) : (
                  <>
                    Entrer
                    <ArrowIcon className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="mt-4 text-xs text-white/45 transition-colors hover:text-white/80"
              >
                ← Retour
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
