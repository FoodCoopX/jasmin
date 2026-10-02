import { useCallback, useSyncExternalStore } from 'react';

const matchesQuery = (query: string) =>
  typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

/**
 * Whether the viewport is at most ``breakpoint`` px wide. Read from
 * ``matchMedia`` during the first render, so a phone never paints the desktop
 * layout before switching.
 */
export const useIsMobile = (breakpoint = 768) => {
  const query = `(max-width: ${breakpoint}px)`;

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener('change', onChange);
      return () => mediaQuery.removeEventListener('change', onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => matchesQuery(query),
    () => false,
  );
};
