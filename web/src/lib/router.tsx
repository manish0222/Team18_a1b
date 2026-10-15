// Hash router (#/path?query). No server config needed, deep links work from
// any static host, and the whole thing is ~50 lines.
import { useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

export interface Location {
  path: string;
  query: URLSearchParams;
}

function readLocation(): Location {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(qs) };
}

export function useLocation(): Location {
  const [loc, setLoc] = useState(readLocation);
  useEffect(() => {
    const onChange = () => setLoc(readLocation());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return loc;
}

export function href(path: string, query?: Record<string, string | number | undefined | null>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const qs = params.toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

export function navigate(path: string, query?: Record<string, string | number | undefined | null>) {
  window.location.hash = href(path, query).slice(1);
}

/** Replace only the query part of the current route (filters, pagination). */
export function setQuery(patch: Record<string, string | number | undefined | null>) {
  const { path, query } = readLocation();
  const next: Record<string, string> = Object.fromEntries(query.entries());
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === '') delete next[k];
    else next[k] = String(v);
  }
  const url = href(path, next);
  window.history.replaceState(null, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Match "/riders/:id" against a path. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  const m = re.exec(path);
  if (!m) return null;
  return Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
}

export function Link({ to, query, children, ...rest }: { to: string; query?: Record<string, string | number | undefined | null>; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href(to, query)} {...rest}>
      {children}
    </a>
  );
}
