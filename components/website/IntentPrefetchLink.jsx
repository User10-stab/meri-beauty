"use client";

import Link from "next/link";
import { useState } from "react";

// Lien de navigation qui ne précharge la page qu'au survol / au toucher, et
// non plus dès qu'il entre dans le viewport.
//
// Pourquoi (audit 2026-10 « chaque page du menu est préchargée deux fois ») :
// toutes les pages publiques sont dynamiques (auth() dans app/layout.js) et
// app/(public)/loading.js existe. Pour une telle route, Next 16 (sans PPR)
// envoie DEUX requêtes RSC par lien visible : l'arbre de route (`/_tree`,
// rendu jusqu'au loading.js) puis, le <head> n'y étant que partiel, une
// requête dynamique « Full » pour les métadonnées (pingRuntimeHead dans
// next/dist/client/components/segment-cache/scheduler.js) — deux rendus
// serveur par page du menu. Avec 7 liens de menu (+ la copie du menu mobile, + le
// pied de page) chaque visite déclenchait ~14 rendus serveur en arrière-plan.
//
// Modèle documenté dans node_modules/next/dist/docs/01-app/02-guides/
// prefetching.md (« Hover-triggered prefetch ») : `prefetch={null}` rétablit
// le préchargement par défaut dès que l'utilisateur montre une intention.
export default function IntentPrefetchLink({ onMouseEnter, onTouchStart, onFocus, ...props }) {
  const [active, setActive] = useState(false);

  return (
    <Link
      {...props}
      prefetch={active ? null : false}
      onMouseEnter={(e) => {
        setActive(true);
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        setActive(true);
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        setActive(true);
        onFocus?.(e);
      }}
    />
  );
}
