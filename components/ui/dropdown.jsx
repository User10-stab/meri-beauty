"use client";

import { useClickOutside } from "@/hooks/use-click-outside";
import { cn } from "@/lib/utils";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
} from "react";

const DropdownContext = createContext(null);

function useDropdownContext() {
  const context = useContext(DropdownContext);
  if (!context) {
    throw new Error("useDropdownContext must be used within a Dropdown");
  }
  return context;
}

export function Dropdown({ children, isOpen, setIsOpen }) {
  const triggerRef = useRef(null);

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      handleClose();
    }
  };

  useEffect(() => {
    if (isOpen) {
      triggerRef.current = document.activeElement;

      document.body.style.pointerEvents = "none";
    } else {
      document.body.style.removeProperty("pointer-events");

      setTimeout(() => {
        triggerRef.current?.focus();
      }, 0);
    }
  }, [isOpen]);

  function handleClose() {
    setIsOpen(false);
  }

  function handleOpen() {
    setIsOpen(true);
  }

  return (
    <DropdownContext.Provider value={{ isOpen, handleOpen, handleClose }}>
      <div className="relative" onKeyDown={handleKeyDown}>
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

export function DropdownContent({
  children,
  align = "center",
  className,
}) {
  const { isOpen, handleClose } = useDropdownContext();

  const contentRef = useClickOutside(() => {
    if (isOpen) handleClose();
  });

  if (!isOpen) return null;

  return (
    <div
      ref={contentRef}
      role="menu"
      aria-orientation="vertical"
      className={cn(
        "fade-in-0 zoom-in-95 pointer-events-auto absolute z-40 mt-2 min-w-32 origin-top-right rounded-lg",
        {
          "animate-in right-0": align === "end",
          "left-0": align === "start",
          "left-1/2 -translate-x-1/2": align === "center",
        },
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DropdownTrigger({ children, className }) {
  const { handleOpen, isOpen } = useDropdownContext();

  return (
    <button
      className={className}
      onClick={handleOpen}
      aria-expanded={isOpen}
      aria-haspopup="menu"
      data-state={isOpen ? "open" : "closed"}
    >
      {children}
    </button>
  );
}

export function DropdownClose({ children }) {
  const { handleClose } = useDropdownContext();

  return <div onClick={handleClose}>{children}</div>;
}
