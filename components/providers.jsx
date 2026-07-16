"use client";

import { ThemeProvider } from "next-themes";
import { SessionProvider } from "next-auth/react";

export function Providers({ children }) {
  return (
    <SessionProvider>
      <ThemeProvider
        defaultTheme="light"
        attribute="class"
        enableSystem
      >
        {children}
      </ThemeProvider>
    </SessionProvider>
  );
}