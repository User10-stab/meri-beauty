"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { UserIcon, BagIcon, MenuIcon, CloseIcon } from "./icons";
import { useSession, signOut } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { getCart } from "@/actions/boutique/cart";
import LocaleSwitcher from "@/components/LocaleSwitcher";

const NAV_LINKS = [
  { label: "Accueil", href: "/" },
  { label: "Concept", href: "/#concept" },
  { label: "Réservation", href: "/reservation" },
  { label: "Boutique", href: "/boutique" },
  { label: "Évènements & Ateliers", href: "/evenements" },
  { label: "Formations", href: "/formations" },
  { label: "Contact", href: "/contact" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("Accueil");
  const [cartItemCount, setCartItemCount] = useState(0);
  const { data: session, status } = useSession();
  // See Footer.jsx for why this is gated on mount rather than fetching the
  // session server-side (avoids a hydration mismatch without forcing every
  // public route to render dynamically).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isAuthed = mounted && status === "authenticated";

  // Fetched client-side (not passed from the layout) so the shared public
  // layout never touches cookies() — see app/(public)/layout.js. Re-fetches
  // whenever a cart mutation fires the "boutique:cart-updated" event, since
  // this component doesn't unmount on client-side navigation.
  //
  // The cart page already knows its new item count the instant it applies
  // an optimistic update (before the server confirms), so it passes that
  // count along on the event — reading it here skips a second round trip
  // and updates the badge in the same tick as the on-page quantity. Callers
  // that don't have that number handy (add-to-cart, product scan) just
  // dispatch without a detail and fall back to a fresh fetch.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const result = await getCart();
      if (!cancelled) setCartItemCount(result.data?.itemCount ?? 0);
    }
    function onCartUpdated(e) {
      if (typeof e.detail?.itemCount === "number") {
        setCartItemCount(e.detail.itemCount);
      } else {
        refresh();
      }
    }
    refresh();
    window.addEventListener("boutique:cart-updated", onCartUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("boutique:cart-updated", onCartUpdated);
    };
  }, []);
  
  // Check if user has one of the specified roles
  const hasDashboardRole = isAuthed && session?.user?.role && 
    ["OWNER", "STAFF", "ADMIN"].includes(session.user.role);

  // Dropdown state
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const firstMenuItemRef = useRef(null);

  // Close menu on outside click or Escape; focus first item when opened
  useEffect(() => {
    function handleClickOutside(e) {
      if (!menuOpen) return;
      if (menuRef.current && !menuRef.current.contains(e.target) && !e.target.closest('[aria-haspopup="menu"]')) {
        setMenuOpen(false);
      }
    }

    function handleKey(e) {
      if (e.key === "Escape") {
        setMenuOpen(false);
      }
    }
    

    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKey);
      // move focus to first item for accessibility
      setTimeout(() => {
        try { firstMenuItemRef.current?.focus(); } catch (err) {}
      }, 0);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-50 bg-primary">
      <nav className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3 md:px-10 lg:grid lg:grid-cols-[auto_1fr_auto] lg:gap-6 lg:px-14">

        {/* ── Logo (left) ── */}
        <Link href="#accueil" className="shrink-0" aria-label="Maison Adar — Accueil">
          <Image
            src="/Images/image.webp"
            alt="Maison Adar"
            width={156}
            height={110}
            priority
            className="h-[52px] w-auto object-contain"
          />
        </Link>

        {/* ── Desktop nav links (center) ── */}
        <ul className="hidden items-center justify-center gap-7 lg:flex xl:gap-9">
          {NAV_LINKS.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                onClick={() => setActive(link.label)}
                className={`font-display relative whitespace-nowrap text-[15px] font-medium tracking-wide transition-colors duration-200
                  ${
                    active === link.label
                      ? "text-gold"
                      : "text-cream/70 hover:text-cream/95"
                  }`}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* ── Right actions ── */}
        <div className="relative flex items-center justify-self-end gap-2 md:gap-3">
          <LocaleSwitcher className="text-cream/70" />

          {/* Dashboard button for users with specific roles */}
          {hasDashboardRole && (
            <Link
              href="/dashboard"
              className="ml-2 hidden rounded-full border border-gold px-5 py-2 text-[13px] font-medium text-gold transition-all duration-200 hover:bg-gold hover:text-white sm:inline-flex"
            >
              Tableau de bord
            </Link>
          )}

          {/* User icon (only when authenticated and NOT a dashboard role user) */}
          {isAuthed && !hasDashboardRole && (
            <>
              <button
                aria-label="Mon profil"
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded-full p-2 text-cream/70 transition-colors duration-200 hover:text-cream"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                {session?.user?.image ? (
                  <Image
                    src={session.user.image}
                    alt={session.user.name || "Avatar"}
                    width={20}
                    height={20}
                    unoptimized
                    className="h-5 w-5 rounded-full object-cover"
                  />
                ) : (
                  <UserIcon className="h-[18px] w-[18px]" />
                )}
              </button>

              {/* Dropdown menu */}
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.15 }}
                    ref={menuRef}
                    className="absolute right-0 top-full z-50 mt-3 w-60 rounded-2xl bg-white shadow-md ring-1 ring-black/5"
                    role="menu"
                    aria-label="User menu"
                  >
                    <div className="p-4">
                      <div className="flex items-center gap-3">
                        {session?.user?.image ? (
                          <Image
                            src={session.user.image}
                            alt={session.user.name || "Avatar"}
                            width={48}
                            height={48}
                            unoptimized
                            className="h-12 w-12 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cream/10">
                            <UserIcon className="h-6 w-6 text-cream" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-primary">
                            {session?.user?.name || "Utilisateur"}
                          </div>
                          <div className="truncate text-xs text-gray-500">
                            {session?.user?.email}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="-my-1 h-px bg-cream/10" />

                    <div className="py-2">
                      <a
                        href="/mon-compte"
                        ref={firstMenuItemRef}
                        onClick={() => setMenuOpen(false)}
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        role="menuitem"
                      >
                        Mes commandes
                      </a>
                      <a
                        href="/appointments"
                        onClick={() => setMenuOpen(false)}
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        role="menuitem"
                      >
                        Mes rendez-vous
                      </a>
                      <a
                        href="/profile"
                        onClick={() => setMenuOpen(false)}
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        role="menuitem"
                      >
                        Mon profil
                      </a>
                    </div>

                    <div className="-my-1 h-px bg-cream/10" />

                    <div className="py-2">
                      <button
                        onClick={async () => {
                          setMenuOpen(false);
                          await signOut({ callbackUrl: "/" });
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                        role="menuitem"
                      >
                        Déconnexion
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          {/* Bag icon — visible to everyone, guests included, since checkout supports guest orders */}
          <Link
            href="/boutique/cart"
            aria-label={`Mon panier${cartItemCount > 0 ? ` (${cartItemCount} article${cartItemCount > 1 ? "s" : ""})` : ""}`}
            className="relative rounded-full p-2 text-cream/70 transition-colors duration-200 hover:text-cream"
          >
            <BagIcon className="h-[18px] w-[18px]" />
            {cartItemCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-semibold leading-none text-primary">
                {cartItemCount > 9 ? "9+" : cartItemCount}
              </span>
            )}
          </Link>

          {/* Login button (only when NOT authenticated) */}
          {!isAuthed && (
            <Link
              href="/login"
              className="ml-2 hidden rounded-full border border-gold px-5 py-2 text-[13px] font-medium text-gold bg-white/5 transition-all duration-200 hover:bg-gold hover:text-primary sm:inline-flex"
            >
              Se connecter
            </Link>
          )}

          {/* Mobile hamburger */}
          <button
            aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
            onClick={() => setOpen((v) => !v)}
            className="ml-1 rounded-full p-2 text-cream/80 lg:hidden"
          >
            {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {/* ── Mobile menu panel ── */}
      <div
        className={`overflow-hidden bg-primary transition-[max-height] duration-300 ease-in-out lg:hidden ${
          open ? "max-h-[30rem]" : "max-h-0"
        }`}
      >
        <ul className="flex flex-col px-6 pb-6 pt-1">
          {NAV_LINKS.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                onClick={() => { setActive(link.label); setOpen(false); }}
                className={`font-display block border-b border-cream/10 py-3.5 text-[15px] font-medium tracking-wide transition-colors
                  ${active === link.label ? "text-gold" : "text-cream/70 hover:text-cream"}`}
              >
                {link.label}
              </Link>
            </li>
          ))}
          {/* CTA inside mobile menu too — nothing shown here for an
              authenticated customer, matching the desktop header: their
              account access is the profile icon/dropdown, not a CTA pill. */}
          {(hasDashboardRole || !isAuthed) && (
            <li className="pt-4">
              {hasDashboardRole ? (
                <Link
                  href="/dashboard"
                  onClick={() => setOpen(false)}
                  className="inline-flex w-full justify-center rounded-full border border-gold px-6 py-2.5 text-[13px] font-medium text-gold transition-all hover:bg-gold hover:text-primary"
                >
                  Tableau de bord
                </Link>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setOpen(false)}
                  className="inline-flex w-full justify-center rounded-full border border-gold px-6 py-2.5 text-[13px] font-medium text-gold transition-all hover:bg-gold hover:text-primary"
                >
                  Se connecter
                </Link>
              )}
            </li>
          )}
        </ul>
      </div>
    </header>
  );
}
