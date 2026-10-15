// Small stroke icons (24px grid, 1.8 stroke) used in navigation. Decorative:
// every icon sits next to a text label, so they are aria-hidden.
import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const icons: Record<string, ReactNode> = {
  overview: <Svg><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /></Svg>,
  book: <Svg><path d="M5 17h14l-1.5-6.5a2 2 0 0 0-2-1.5h-7a2 2 0 0 0-2 1.5L5 17Z" /><circle cx="8" cy="17.5" r="1.5" /><circle cx="16" cy="17.5" r="1.5" /><path d="M9 6h6" /></Svg>,
  wallet: <Svg><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M16 14.5h2" /></Svg>,
  map: <Svg><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10Z" /><circle cx="12" cy="11" r="2.2" /></Svg>,
  analytics: <Svg><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M21 20H3" /></Svg>,
  reviews: <Svg><path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.3L12 16.3l-4.8 2.5.9-5.3-3.9-3.8 5.4-.8L12 4Z" /></Svg>,
  riders: <Svg><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 5.5a3 3 0 0 1 0 5.5" /><path d="M17.5 14.5A5 5 0 0 1 20.5 19" /></Svg>,
  vehicles: <Svg><rect x="3" y="7" width="18" height="10" rx="2" /><path d="M7 11h3" /><path d="M14 11h3" /></Svg>,
  trips: <Svg><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 6h6a3 3 0 0 1 0 6h-4a3 3 0 0 0 0 6h6" /></Svg>,
};
