"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import {
  Heart,
  MessageCircle,
  Send,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Film,
  Images,
  Volume2,
  VolumeX,
  Maximize,
  Play,
  Pause,
} from "lucide-react";

// Instagram brand icon (not in lucide-react v1)
function InstagramIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// DATA  —  replace this array with the Instagram Graph API later
// Each object maps 1-to-1 with the API response shape
// ─────────────────────────────────────────────────────────────
const POSTS = [
  {
    id: "1",
    media_type: "VIDEO",
    media_url: "/Images/reel.webp",   // swap for real .mp4 url
    thumbnail_url: "/Images/reel.webp",
    caption: "Balayage beige lumineux ✨\nUn blond sur-mesure pour sublimer chaque chevelure.",
    likes: 128,
    comments: 12,
    timestamp: "2024-07-01T10:00:00Z",
    permalink: "https://www.instagram.com/meribeauty.studio/",
  },
  {
    id: "2",
    media_type: "IMAGE",
    media_url: "/Images/post.webp",
    thumbnail_url: "/Images/post.webp",
    caption: "Notre salon vous accueille dans un cadre chaleureux ✨",
    likes: 245,
    comments: 18,
    timestamp: "2024-06-29T14:00:00Z",
    permalink: "https://www.instagram.com/meribeauty.studio/",
  },
  {
    id: "3",
    media_type: "IMAGE",
    media_url: "/Images/post.webp",
    thumbnail_url: "/Images/post.webp",
    caption: "Manucure gel bordeaux — douceur & élégance 💅",
    likes: 312,
    comments: 24,
    timestamp: "2024-06-27T09:30:00Z",
    permalink: "https://www.instagram.com/meribeauty.studio/",
  },
  {
    id: "4",
    media_type: "IMAGE",
    media_url: "/Images/post.webp",
    thumbnail_url: "/Images/post.webp",
    caption: "Espace bien-être — un lieu pensé pour vous 🌸",
    likes: 198,
    comments: 9,
    timestamp: "2024-06-25T11:00:00Z",
    permalink: "https://www.instagram.com/meribeauty.studio/",
  },
  {
    id: "5",
    media_type: "VIDEO",
    media_url: "/Images/reel.webp",
    thumbnail_url: "/Images/reel.webp",
    caption: "Transformation complète — avant / après 💫\n#balayage #hairgoals",
    likes: 534,
    comments: 41,
    timestamp: "2024-06-22T16:00:00Z",
    permalink: "https://www.instagram.com/meribeauty.studio/",
  },
  {
    id: "6",
    media_type: "IMAGE",
    media_url: "/Images/post.webp",
    thumbnail_url: "/Images/post.webp",
    caption: "Soin visage signature — peau lumineuse garantie 🤍",
    likes: 287,
    comments: 21,
    timestamp: "2024-06-20T13:00:00Z",
    permalink: "https://www.instagram.com/meribeauty.studio/",
  },
  {
    id: "7",
    media_type: "VIDEO",
    media_url: "/Images/reel.webp",
    thumbnail_url: "/Images/reel.webp",
    caption: "Coulisses d'une journée au salon ☀️ #bts #meribeauty",
    likes: 421,
    comments: 33,
    timestamp: "2024-06-18T10:00:00Z",
    permalink: "https://www.instagram.com/meribeauty.studio/",
  },
  {
    id: "8",
    media_type: "CAROUSEL_ALBUM",
    media_url: "/Images/post.webp",
    thumbnail_url: "/Images/post.webp",
    caption: "Nouvelle collection de soins capillaires premium 🖤",
    likes: 176,
    comments: 14,
    timestamp: "2024-06-15T09:00:00Z",
    permalink: "https://www.instagram.com/meribeauty.studio/",
  },
];

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(".0", "") + "K";
  return String(n);
}

function relativeDate(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Il y a 1 j";
  if (diff < 7) return `Il y a ${diff} j`;
  const weeks = Math.floor(diff / 7);
  if (weeks === 1) return "Il y a 1 sem";
  return `Il y a ${weeks} sem`;
}

function useInView(threshold = 0.1) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView];
}

// ─────────────────────────────────────────────────────────────
// INSTAGRAM VIEWER
// Black container — media always keeps its real aspect ratio
// ─────────────────────────────────────────────────────────────
function InstagramViewer({ post, t }) {
  const videoRef = useRef(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);       // 0–100
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const isVideo = post.media_type === "VIDEO";

  // Reset state when post changes
  useEffect(() => {
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);
    setPlaying(true);
    setMuted(true);
  }, [post.id]);

  // Sync video element to playing/muted state
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    playing ? v.play().catch(() => {}) : v.pause();
  }, [playing]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
  }, [muted]);

  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    setCurrentTime(Math.floor(v.currentTime));
    setDuration(Math.floor(v.duration));
    setProgress((v.currentTime / v.duration) * 100);
  }

  function onSeek(e) {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = pct * v.duration;
  }

  function fmt(s) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  return (
    <div className="relative w-full overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/60">
      {/* ── Media ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={post.id}
          initial={{ opacity: 0, scale: 1.03 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
          className="flex items-center justify-center bg-black"
          style={{ minHeight: "260px" }}
        >
          {isVideo ? (
            /* VIDEO — fills width, aspect ratio preserved via the video element itself */
            <video
              ref={videoRef}
              key={post.media_url}
              src={post.media_url}
              poster={post.thumbnail_url}
              autoPlay
              muted
              loop
              playsInline
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={onTimeUpdate}
              className="w-full object-contain"
              style={{ display: "block", maxHeight: "58vh" }}
            />
          ) : (
            /* IMAGE — object-contain so portrait/landscape/square all stay correct */
            <div className="relative w-full" style={{ aspectRatio: "4/5", maxHeight: "58vh" }}>
              <Image
                src={post.media_url}
                alt={post.caption}
                fill
                className="object-contain"
                sizes="(max-width: 768px) 100vw, 55vw"
                priority
              />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* ── Reel badge (top-left) ── */}
      {isVideo && (
        <div className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 backdrop-blur-md">
          <Film className="h-3.5 w-3.5 text-white/80" />
          <span className="text-[12px] font-semibold text-white/90">{t("instagramReel")}</span>
        </div>
      )}

      {/* ── Carousel badge (top-left) ── */}
      {post.media_type === "CAROUSEL_ALBUM" && (
        <div className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 backdrop-blur-md">
          <Images className="h-3.5 w-3.5 text-white/80" />
          <span className="text-[12px] font-semibold text-white/90">{t("instagramCarousel")}</span>
        </div>
      )}

      {/* ── Mute button (top-right, video only) ── */}
      {isVideo && (
        <button
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? t("instagramEnableSound") : t("instagramMuteSound")}
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white/80 backdrop-blur-md transition-all hover:bg-black/75 hover:text-white"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      )}

      {/* ── Video controls bar (bottom, video only) ── */}
      {isVideo && (
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-4 pt-10"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.80) 0%, transparent 100%)" }}>

          {/* Seekbar */}
          <div
            role="slider"
            aria-label="Progression"
            aria-valuenow={progress}
            tabIndex={0}
            onClick={onSeek}
            className="mb-2.5 h-[3px] w-full cursor-pointer rounded-full bg-white/25"
          >
            <div
              className="h-full rounded-full bg-[#C6A46A] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? "Pause" : "Lecture"}
              className="text-white/85 transition-colors hover:text-white"
            >
              {playing
                ? <Pause className="h-[18px] w-[18px]" />
                : <Play className="h-[18px] w-[18px]" />}
            </button>
            <span className="text-[11px] font-medium tabular-nums text-white/60">
              {fmt(currentTime)} / {fmt(duration || 15)}
            </span>
            <div className="ml-auto">
              <a
                href={post.permalink}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Plein écran"
                className="text-white/60 transition-colors hover:text-white"
              >
                <Maximize className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// INSTAGRAM DETAILS  —  right-hand panel
// ─────────────────────────────────────────────────────────────
function InstagramDetails({ post, profile, t }) {
  const [liked, setLiked] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Reset on post change
  useEffect(() => {
    setLiked(false);
    setExpanded(false);
  }, [post.id]);

  const lines = post.caption.split("\n");
  const firstLine = lines[0];
  const rest = lines.slice(1).join("\n");

  // Use live profile data when available, fall back to static values
  const displayName = profile?.name ?? "meribeauty.studio";
  const username = profile?.username ?? "meribeauty.studio";
  const avatarSrc = profile?.avatar ?? "/Images/post.webp";

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={post.id}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        className="flex h-full flex-col justify-center gap-4 px-2 py-3 lg:py-0"
      >
        {/* Avatar + username + date */}
        <div className="flex items-center gap-3">
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full ring-2 ring-[#C6A46A]/50">
            <Image
              src={avatarSrc}
              alt={username}
              fill
              className="object-cover"
            />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-white leading-tight">
              {displayName}
            </p>
            <p className="text-[12px] text-white/45 leading-tight mt-0.5">
              {relativeDate(post.timestamp)}
            </p>
          </div>
        </div>

        {/* Caption */}
        <div>
          <p className="text-[14.5px] leading-[1.75] text-white/80">
            {firstLine}
            {rest && (
              <>
                {expanded && (
                  <span className="block mt-1 text-white/60">{rest}</span>
                )}
              </>
            )}
          </p>
          {rest && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="mt-2 text-[13px] text-white/40 hover:text-white/70 transition-colors"
            >
              {t("reviewsMore")}
            </button>
          )}
        </div>

        {/* Like / Comment / Share */}
        <div className="flex items-center gap-5">
          <button
            onClick={() => setLiked((l) => !l)}
            className="flex items-center gap-2 group"
            aria-label={t("instagramLike")}
          >
            <Heart
              className={`h-5 w-5 transition-all duration-200 group-hover:scale-110
                ${liked ? "fill-red-500 text-red-500" : "text-white/70 group-hover:text-white"}`}
            />
            <span className="text-[13px] font-medium text-white/60 group-hover:text-white/90 transition-colors">
              {formatCount(post.likes + (liked ? 1 : 0))}
            </span>
          </button>

          <button className="flex items-center gap-2 group" aria-label={t("instagramComment")}>
            <MessageCircle className="h-5 w-5 text-white/70 transition-all group-hover:text-white group-hover:scale-110" />
            <span className="text-[13px] font-medium text-white/60 group-hover:text-white/90 transition-colors">
              {formatCount(post.comments)}
            </span>
          </button>

          <button className="flex items-center gap-2 group" aria-label={t("instagramShare")}>
            <Send className="h-5 w-5 text-white/70 transition-all group-hover:text-white group-hover:scale-110" />
          </button>
        </div>

        {/* View on Instagram CTA */}
        <a
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center justify-center gap-2.5 rounded-full border border-[#C6A46A]/50 px-6 py-3.5 text-[13.5px] font-semibold text-[#C6A46A] transition-all duration-300 hover:bg-[#C6A46A]/10 hover:border-[#C6A46A] hover:shadow-lg hover:shadow-[#C6A46A]/10 w-fit"
        >
          {t("instagramViewPost")}
          <ExternalLink className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
      </motion.div>
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────
// NAVIGATION  —  prev / next glass buttons
// ─────────────────────────────────────────────────────────────
function InstagramNavigation({ onPrev, onNext, canPrev, canNext }) {
  const btnBase =
    "flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white/70 backdrop-blur-md transition-all duration-200 disabled:pointer-events-none disabled:opacity-25 hover:bg-white/15 hover:text-white hover:scale-105 active:scale-95 shadow-lg shadow-black/30";

  return (
    <>
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.93 }}
        onClick={onPrev}
        disabled={!canPrev}
        aria-label="Post précédent"
        className={btnBase}
      >
        <ChevronLeft className="h-5 w-5" />
      </motion.button>

      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.93 }}
        onClick={onNext}
        disabled={!canNext}
        aria-label="Post suivant"
        className={btnBase}
      >
        <ChevronRight className="h-5 w-5" />
      </motion.button>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// THUMBNAIL LIST  —  horizontal scroll strip
// ─────────────────────────────────────────────────────────────
function InstagramThumbnailList({ posts, activeId, onSelect }) {
  const stripRef = useRef(null);
  const activeRef = useRef(null);

  // Scroll active thumbnail into view when it changes
  useEffect(() => {
    const el = activeRef.current;
    const strip = stripRef.current;
    if (!el || !strip) return;
    const left = el.offsetLeft - strip.offsetWidth / 2 + el.offsetWidth / 2;
    strip.scrollTo({ left, behavior: "smooth" });
  }, [activeId]);

  function scrollBy(dir) {
    stripRef.current?.scrollBy({ left: dir * 300, behavior: "smooth" });
  }

  return (
    <div className="relative w-full">
      {/* Left arrow */}
      <button
        onClick={() => scrollBy(-1)}
        aria-label="Défiler à gauche"
        className="absolute -left-4 top-1/2 z-10 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white/60 backdrop-blur-md transition-all hover:bg-white/15 hover:text-white hover:scale-105 shadow-md"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {/* Scrollable strip */}
      <div
        ref={stripRef}
        className="flex gap-3 overflow-x-auto px-6 pb-1"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {posts.map((post) => {
          const isActive = post.id === activeId;
          const isVideo = post.media_type === "VIDEO";
          const isCarousel = post.media_type === "CAROUSEL_ALBUM";

          return (
            <motion.button
              key={post.id}
              ref={isActive ? activeRef : null}
              onClick={() => onSelect(post)}
              whileHover={{ scale: 0.96 }}
              whileTap={{ scale: 0.93 }}
              aria-label={`Sélectionner le post ${post.id}`}
              aria-pressed={isActive}
              className={`group relative h-[84px] w-[84px] shrink-0 overflow-hidden rounded-xl transition-all duration-300
                ${isActive
                  ? "ring-2 ring-[#C6A46A] ring-offset-2 ring-offset-black shadow-lg shadow-[#C6A46A]/20"
                  : "ring-1 ring-white/10 hover:ring-white/25"}`}
            >
              <Image
                src={post.thumbnail_url || post.media_url}
                alt={`Thumbnail ${post.id}`}
                fill
                className={`object-cover transition-all duration-500
                  ${isActive ? "brightness-100" : "brightness-75 group-hover:brightness-90"}`}
                sizes="100px"
              />

              {/* Video badge */}
              {isVideo && (
                <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
                  <Film className="h-2.5 w-2.5 text-white/90" />
                </div>
              )}

              {/* Carousel badge */}
              {isCarousel && (
                <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
                  <Images className="h-2.5 w-2.5 text-white/90" />
                </div>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Right arrow */}
      <button
        onClick={() => scrollBy(1)}
        aria-label="Défiler à droite"
        className="absolute -right-4 top-1/2 z-10 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white/60 backdrop-blur-md transition-all hover:bg-white/15 hover:text-white hover:scale-105 shadow-md"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN EXPORT  —  InstagramLifestyle
// ─────────────────────────────────────────────────────────────
export default function InstagramLifestyle({ posts = POSTS, profile }) {
  const t = useTranslations("home");
  const [headerRef, headerInView] = useInView(0.15);
  const [contentRef, contentInView] = useInView(0.08);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = posts[selectedIndex];

  const goTo = useCallback(
    (idx) => setSelectedIndex(Math.max(0, Math.min(posts.length - 1, idx))),
    [posts.length]
  );
  const goPrev = useCallback(() => goTo(selectedIndex - 1), [selectedIndex, goTo]);
  const goNext = useCallback(() => goTo(selectedIndex + 1), [selectedIndex, goTo]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e) {
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext]);

  return (
    <section className="relative w-full overflow-hidden bg-primary ">
      {/* Radial ambient glow — very subtle */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(198,164,106,0.06) 0%, transparent 70%)," +
            "radial-gradient(ellipse 60% 40% at 80% 80%, rgba(198,164,106,0.04) 0%, transparent 60%)",
        }}
      />

      <div className="relative mx-auto max-w-[1200px] px-6 py-12 md:px-10 lg:px-12 lg:py-16">

        {/* ── SECTION HEADER ── */}
        <motion.div
          ref={headerRef}
          initial={{ opacity: 0, y: 24 }}
          animate={headerInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
          className="mb-8 text-center"
        >
          {/* Eyebrow */}
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#C6A46A]">
            Instagram
          </p>

          {/* Heading */}
          <h2 className="mb-3 font-display text-[2rem] font-bold leading-[1.08] tracking-tight text-white/90 sm:text-[2.4rem] lg:text-[2.8rem]">
            {t("instagramTitle")}
          </h2>

          {/* Description */}
          <p className="mx-auto max-w-[420px] text-[13.5px] leading-[1.7] text-white/55">
            {t("instagramBody")}
          </p>
        </motion.div>

        {/* ── MAIN CONTENT ── */}
        <motion.div
          ref={contentRef}
          initial={{ opacity: 0, y: 32 }}
          animate={contentInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1], delay: 0.1 }}
        >
          {/* Viewer row: [←] [viewer | details] [→] */}
          <div className="flex items-center gap-3 lg:gap-4 py-2 px-2">

            {/* ── Prev ── */}
            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.93 }}
              onClick={goPrev}
              disabled={selectedIndex === 0}
              aria-label={t("instagramPreviousPost")}
              className="shrink-0 flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white/70 backdrop-blur-md shadow-lg shadow-black/30 transition-all hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-25"
            >
              <ChevronLeft className="h-5 w-5" />
            </motion.button>

            {/* ── Viewer + Details ── */}
            <div className="flex flex-1 min-w-0 flex-col gap-6 lg:flex-row lg:items-stretch lg:gap-8">
              {/* Viewer — 58% */}
              <div className="w-full lg:w-[58%]">
                <InstagramViewer post={selected} t={t} />
              </div>

              {/* Details — 42% */}
              <div className="w-full lg:w-[42%] lg:flex lg:items-center">
                <div className="w-full rounded-2xl border border-white/8 bg-white/[0.04] px-5 py-5 backdrop-blur-sm lg:py-6">
                  <InstagramDetails post={selected} profile={profile} t={t} />
                </div>
              </div>
            </div>

            {/* ── Next ── */}
            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.93 }}
              onClick={goNext}
              disabled={selectedIndex === posts.length - 1}
              aria-label={t("instagramNextPost")}
              className="shrink-0 flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/8 text-white/70 backdrop-blur-md shadow-lg shadow-black/30 transition-all hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-25"
            >
              <ChevronRight className="h-5 w-5" />
            </motion.button>

          </div>

          {/* ── THUMBNAIL STRIP ── */}
          <div className="mt-5 px-4">
            <InstagramThumbnailList
              posts={posts}
              activeId={selected.id}
              onSelect={(p) => goTo(posts.findIndex((x) => x.id === p.id))}
            />
          </div>

          {/* ── Bottom CTA ── */}
          <div className="mt-7 flex justify-center">
            <a
              href="https://www.instagram.com/meribeauty.studio/"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-3 rounded-full border border-white/20 px-7 py-3 text-[13px] font-semibold text-white/80 transition-all duration-300 hover:border-[#C6A46A]/60 hover:text-[#C6A46A] hover:shadow-lg hover:shadow-[#C6A46A]/10"
            >
              {t("instagramViewMore")}
              <InstagramIcon className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
            </a>
          </div>
        </motion.div>

      </div>
    </section>
  );
}
