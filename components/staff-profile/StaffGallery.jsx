"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ImageIcon } from "lucide-react";

function useInView(threshold = 0.15) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, inView];
}

export default function StaffGallery({ staffId, firstName }) {
  const [sectionRef, sectionInView] = useInView();
  const [gallery, setGallery] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Future: fetch staff gallery images from API
    // For now, hide this section if no images exist
    async function loadGallery() {
      try {
        // Placeholder for future implementation
        // const response = await fetch(`/api/staff/${staffId}/gallery`);
        // if (response.ok) {
        //   const data = await response.json();
        //   setGallery(data);
        // }
        setGallery([]);
      } catch (error) {
        console.error("Failed to load gallery:", error);
        setGallery([]);
      } finally {
        setIsLoading(false);
      }
    }
    loadGallery();
  }, [staffId]);

  // Don't render if no images
  if (isLoading || !gallery || gallery.length === 0) {
    return null;
  }

  return (
    <section className="relative w-full overflow-hidden bg-[#fdf8f0] py-16 sm:py-20 md:py-24">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 md:px-10 lg:px-14">
        <div
          ref={sectionRef}
          className={`transition-all duration-700 ease-out ${
            sectionInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          {/* Header */}
          <div className="mb-10 text-center sm:mb-12">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#b89664] text-white">
              <ImageIcon size={20} />
            </div>
            <h2 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-[#2F3A2E] sm:text-[2.5rem] md:text-[3rem]">
              Son travail
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-[#6f6a64] sm:text-base">
              Découvrez quelques réalisations de {firstName}
            </p>
          </div>

          {/* Masonry Grid */}
          <div className="columns-1 gap-5 space-y-5 sm:columns-2 lg:columns-3">
            {gallery.map((image, index) => (
              <div
                key={image.id || index}
                className="group relative overflow-hidden break-inside-avoid rounded-2xl border border-[#ede5d8] bg-white shadow-[0_2px_18px_rgba(47,58,46,0.06)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(47,58,46,0.12)]"
              >
                <div className="relative aspect-[4/5] w-full">
                  <Image
                    src={image.url}
                    alt={image.alt || `Travail de ${firstName}`}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                    unoptimized
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
