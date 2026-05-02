import { useEffect, useState } from 'react';

// Returns whether the given CSS media query currently matches. Subscribes to
// `change` so layout state stays in sync when the viewport resizes (drag the
// devtools width, rotate the device).
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const m = window.matchMedia(query);
    const onChange = () => setMatches(m.matches);
    m.addEventListener('change', onChange);
    setMatches(m.matches);
    return () => m.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// Tailwind breakpoints — use these so JS-level decisions stay aligned with
// `sm:` / `md:` / `xl:` Tailwind class breakpoints in the markup.
export const useIsMobile = () => useMediaQuery('(max-width: 639px)');   // < sm
export const useIsTablet = () => useMediaQuery('(max-width: 767px)');   // < md
