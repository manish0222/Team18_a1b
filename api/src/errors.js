// Translate database errors into friendly API errors.
//
// The stored procedures raise distinct SQLSTATEs (see sql/04 and sql/07), and
// the "second active trip" case surfaces as 23505 on idx_active_rider_trip.
// The original database message is always passed through in
// details.dbMessage so the UI can show *what the database actually said*.
import { HttpError } from './http.js';

const PG_CODES = {
  RS001: [409, 'INSUFFICIENT_BALANCE', 'Not enough money in the wallet for this trip.'],
  RS002: [409, 'VEHICLE_UNAVAILABLE', 'That vehicle is inactive or no longer exists. Pick another vehicle.'],
  RS003: [404, 'RIDER_NOT_FOUND', 'That rider does not exist.'],
  RS004: [400, 'INVALID_FARE', 'The fare must be greater than zero.'],
  RS005: [409, 'INVALID_STATUS_TRANSITION', 'That status change is not allowed for this trip.'],
  RS006: [400, 'INVALID_TOPUP_AMOUNT', 'Top-up amount must be between 0.01 and 5,000.'],
  RS007: [404, 'TRIP_NOT_FOUND', 'That trip does not exist.'],
  '22P02': [400, 'INVALID_INPUT', 'One of the values sent has the wrong format.'],
  '23514': [400, 'CONSTRAINT_VIOLATION', 'The database rejected a value that breaks a CHECK constraint.'],
};

export function mapPgError(err) {
  if (!err || typeof err !== 'object') return null;
  const dbMessage = err.message;

  if (err.code === '23505' && err.constraint === 'idx_active_rider_trip') {
    return new HttpError(
      409,
      'ACTIVE_TRIP_EXISTS',
      'This rider already has an active trip (REQUESTED or IN_TRANSIT). Finish or cancel it before booking another.',
      { dbMessage, sqlState: err.code, constraint: err.constraint },
    );
  }
  if (err.code === '23505') {
    return new HttpError(409, 'DUPLICATE', 'A record with the same unique value already exists.', {
      dbMessage, sqlState: err.code, constraint: err.constraint,
    });
  }
  const known = PG_CODES[err.code];
  if (known) {
    const [status, code, message] = known;
    return new HttpError(status, code, message, { dbMessage, sqlState: err.code, constraint: err.constraint });
  }
  if (['ECONNREFUSED', 'ENOTFOUND', '57P03', '3D000', '28P01'].includes(err.code)) {
    return new HttpError(503, 'POSTGRES_UNAVAILABLE', 'PostgreSQL is not reachable. Is the database running?', {
      dbMessage, sqlState: err.code,
    });
  }
  if (typeof err.name === 'string' && /^Mongo(ServerSelection|Network|NotConnected|Topology)/.test(err.name)) {
    return new HttpError(503, 'MONGO_UNAVAILABLE', 'MongoDB is not reachable. Is mongod running?', {
      dbMessage,
    });
  }
  return null;
}

/** Final fallback used by the app's error handler. */
export function toHttpError(err) {
  if (err instanceof HttpError) return err;
  const mapped = mapPgError(err);
  if (mapped) return mapped;
  return new HttpError(500, 'INTERNAL', 'Something went wrong on the server.', {
    dbMessage: err?.message,
  });
}
