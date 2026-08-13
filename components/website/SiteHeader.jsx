"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { UserIcon, BagIcon, MenuIcon, CloseIcon } from "./icons";
import { useSession, signOut } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import { getCart } from "@/actions/boutique/cart";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import { useTranslations } from "next-intl";

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("/");
  const [cartItemCount, setCartItemCount] = useState(0);
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const isAuthed = status === "authenticated";
  const hasDashboardRole = isAuthed && session?.user?.role && ["OWNER", "STAFF", "ADMIN"].includes(session.user.role);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const result = await getCart();
      if (!cancelled) setCartItemCount(result.data?.itemCount ?? 0);
    }
    refresh();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setActive(pathname || "/");
  }, [pathname]);

  const links = [
    { label: tCommon("home"), href: "/" },
    { label: tNav("concept"), href: "/#concept" },
    { label: tNav("booking"), href: "/reservation" },
    { label: tNav("shop"), href: "/boutique" },
    { label: tNav("events"), href: "/evenements" },
    { label: tNav("courses"), href: "/formations" },
    { label: tNav("contact"), href: "/contact" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full bg-primary">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-4 md:px-10 lg:px-14">
        <Link href="/" aria-label={tCommon("home")} className="shrink-0">
          <Image src="/Images/Logo.webp" alt="Meri Beauty" width={150} height={60} className="h-[48px] w-auto" />
        </Link>
        <nav className="hidden items-center gap-6 lg:flex" aria-label={tNav("mainNavigation")}>
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={`text-sm font-medium transition-colors ${active === link.href ? "text-gold" : "text-white/75 hover:text-white"}`}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          <Link href="/boutique/cart" className="relative text-white/80 hover:text-white" aria-label={tNav("cart")}>
            <BagIcon />
            {cartItemCount > 0 ? <span className="absolute -right-2 -top-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-white">{cartItemCount}</span> : null}
          </Link>
          {isAuthed ? (
            <button type="button" onClick={() => signOut({ callbackUrl: "/" })} className="hidden rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white/80 hover:border-white/30 hover:text-white lg:inline-flex">
              {tNav("logout")}
            </button>
          ) : (
            <Link href="/login" className="hidden rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white/80 hover:border-white/30 hover:text-white lg:inline-flex">
              {tNav("login")}
            </Link>
          )}
          {hasDashboardRole && (
            <Link href="/dashboard" className="hidden rounded-full bg-gold px-4 py-2 text-sm font-medium text-white lg:inline-flex">
              {tNav("dashboard")}
            </Link>
          )}
          <button type="button" className="inline-flex items-center justify-center rounded-full border border-white/15 p-2 text-white lg:hidden" onClick={() => setOpen((v) => !v)} aria-label={open ? tNav("closeMenu") : tNav("openMenu")}>
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open ? (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="border-t border-white/10 bg-primary lg:hidden">
            <div ref={menuRef} className="mx-auto flex max-w-[1400px] flex-col gap-3 px-6 py-5 md:px-10">
              {links.map((link) => (
                <Link key={link.href} href={link.href} className="text-white/80">
                  {link.label}
                </Link>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
