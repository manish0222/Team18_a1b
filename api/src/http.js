// Small HTTP helpers shared by all routes (no framework).

export class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

export async function readJson(req, limitBytes = 64 * 1024) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON.');
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

export function requireUuid(value, field) {
  if (!isUuid(value)) {
    throw new HttpError(400, 'INVALID_ID', `${field} must be a valid UUID.`, { field });
  }
  return value.toLowerCase();
}

export function optionalUuid(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return requireUuid(value, field);
}

export function parsePagination(query, { defaultSize = 25, maxSize = 100 } = {}) {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const pageSize = Math.min(maxSize, Math.max(1, Math.floor(Number(query.pageSize) || defaultSize)));
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

export function pageResult(items, total, { page, pageSize }) {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Parse an ISO date / datetime query param. Returns a Date or null. */
export function optionalDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new HttpError(400, 'INVALID_DATE', `${field} must be a date (YYYY-MM-DD).`, { field });
  }
  return d;
}

/** Plain YYYY-MM-DD validation (kept as text so no timezone shifting). */
export function optionalDay(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(value).getTime())) {
    throw new HttpError(400, 'INVALID_DATE', `${field} must be a date (YYYY-MM-DD).`, { field });
  }
  return value;
}

export function parseMoney(value, field) {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new HttpError(400, 'INVALID_AMOUNT', `${field} must be a number.`, { field });
  }
  // two decimals, like NUMERIC(10,2)
  return Math.round(n * 100) / 100;
}

export function parseNumberInRange(value, field, { min, max, fallback }) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, 'MISSING_PARAM', `${field} is required.`, { field });
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(400, 'INVALID_PARAM', `${field} must be between ${min} and ${max}.`, { field });
  }
  return n;
}

export function oneOf(value, allowed, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return allowed.includes(value) ? value : fallback;
}
