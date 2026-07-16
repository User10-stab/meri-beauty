import { useEffect, useRef } from "react";

export function useClickOutside(callback) {
  const ref = useRef(null);

  useEffect(() => {
    function handleEvent(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        callback();
      }
    }

    document.addEventListener("mousedown", handleEvent);

    return () => {
      document.removeEventListener("mousedown", handleEvent);
    };
  }, [callback, ref]);

  return ref;
}
