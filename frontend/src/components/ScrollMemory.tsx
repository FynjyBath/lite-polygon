import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Remembers the window scroll position per route across full page reloads.
 *
 * The browser's own scroll restoration fires before our async data has loaded
 * (so the page is too short to reach the old offset). We instead persist the
 * offset in sessionStorage keyed by path and, after a reload, keep trying to
 * restore it for a short window while the content grows to full height.
 */
export default function ScrollMemory() {
  const { pathname } = useLocation();
  const key = `scroll:${pathname}`;
  const restoringUntil = useRef(0);

  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

    // Save the current offset (throttled) as the user scrolls.
    let saveTimer: number | undefined;
    const onScroll = () => {
      if (Date.now() < restoringUntil.current) return; // don't save while restoring
      if (saveTimer) return;
      saveTimer = window.setTimeout(() => {
        saveTimer = undefined;
        sessionStorage.setItem(key, String(window.scrollY));
      }, 150);
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // Try to restore: content loads asynchronously, so retry on each frame
    // until we can reach the saved offset or ~2s elapses.
    const target = parseInt(sessionStorage.getItem(key) ?? '', 10);
    if (Number.isFinite(target) && target > 0) {
      restoringUntil.current = Date.now() + 2000;
      const tick = () => {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.min(target, Math.max(0, maxScroll)));
        if (Date.now() < restoringUntil.current && maxScroll < target) {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    }

    return () => {
      window.removeEventListener('scroll', onScroll);
      if (saveTimer) clearTimeout(saveTimer);
    };
  }, [key]);

  return null;
}
