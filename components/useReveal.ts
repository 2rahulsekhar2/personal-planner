import { useEffect, useRef } from "react";

// When `dep` changes, bring the element fully into view. Choosing an option often opens more fields under it,
// below the fold; without this they open unseen. Does nothing on first render, or when it is already in view.
// Give the element the class "reveal" so it stops clear of a sticky footer.
export function useReveal<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  const prev = useRef(dep);
  useEffect(() => {
    if (Object.is(prev.current, dep)) return;
    prev.current = dep;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
  }, [dep]);
  return ref;
}
