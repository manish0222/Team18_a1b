// Shapes returned by the API (see docs/api_endpoints.md).

export type TripStatus = 'REQUESTED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';
export type VehicleClass = 'Standard' | 'Comfort' | 'XL' | 'Executive' | 'Black';

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface RiderSummary {
  id: string;
  name: string;
  email: string;
  wallet_balance: number;
  updated_at: string;
  has_active_trip: boolean;
}

export interface Trip {
  id: string;
  rider_id: string;
  rider_name: string;
  vehicle_id: string;
  license_plate: string;
  vehicle_class: VehicleClass;
  fare_amount: number;
  status: TripStatus;
  created_at: string;
  completed_at: string | null;
  allowed_transitions?: TripStatus[];
}

export interface RiderDetail {
  id: string;
  name: string;
  email: string;
  wallet_balance: number;
  created_at: string;
  updated_at: string;
  active_trip: Trip | null;
  stats: { total_trips: number; completed: number; cancelled: number; total_spent: number };
  recent_trips: Trip[];
}

export interface AuditEntry {
  id: string;
  logged_at: string;
  action_type: string;
  amount_changed: number;
  balance_before: number;
  balance_after: number;
  reference_trip_id: string | null;
  running_balance?: number;
  is_consistent?: boolean;
}

export interface AuditResponse extends Page<AuditEntry> {
  rider: { id: string; name: string; email: string; wallet_balance: number };
  summary: {
    total_in: number;
    total_out: number;
    opening_balance: number | null;
    closing_balance: number | null;
    all_consistent: boolean;
  };
  series: { logged_at: string; running_balance: number }[];
}

export interface VehicleSummary {
  id: string;
  license_plate: string;
  class: VehicleClass;
  is_active: boolean;
  created_at: string;
  lifetime_trip_count: number | null;
  total_earnings: number | null;
}

export interface VehicleMetadata {
  vehicle_id: string;
  license_plate: string;
  class: VehicleClass;
  inspection_records?: {
    inspection_id: string;
    date: string;
    passed: boolean;
    inspector: string;
    notes?: string;
  }[];
  features?: Record<string, boolean>;
  updated_at?: string;
  inspection_count?: number;
  [key: string]: unknown;
}

export interface VehicleDetail extends VehicleSummary {
  avg_fare_per_trip: number | null;
  last_trip_at: string | null;
  last_refreshed_at: string | null;
  recent_trips: Trip[];
  metadata: VehicleMetadata | null;
  reviews: { count: number; average_rating: number | null } | null;
  mongo_error: string | null;
}

export interface TripDetail extends Trip {
  audit_entries: AuditEntry[];
  review: Review | null;
  review_error: string | null;
}

export interface BookingResult {
  trip: Trip;
  balance_before: number;
  balance_after: number;
  audit_entries: AuditEntry[];
}

export interface StatusChangeResult {
  previous_status: TripStatus;
  trip: Trip;
  audit_entries: AuditEntry[];
  rider_balance: number;
}

export interface MvSummary {
  vehicles: number;
  active_vehicles: number;
  completed_trips: number;
  total_earnings: number;
  avg_fare: number;
  last_refreshed_at: string | null;
  live_completed_trips: number;
  trips_since_refresh: number;
  by_class: { class: VehicleClass; vehicles: number; completed_trips: number; total_earnings: number }[];
  top_vehicles: {
    vehicle_id: string;
    license_plate: string;
    class: VehicleClass;
    lifetime_trip_count: number;
    total_earnings: number;
    avg_fare_per_trip: number;
  }[];
  refresh_duration_ms?: number;
}

export interface RankingRow {
  trip_date: string;
  vehicle_id: string;
  license_plate: string;
  class: VehicleClass;
  daily_trips: number;
  daily_fare_revenue: number;
  seven_day_moving_avg_revenue: number;
  daily_performance_rank: number;
}

export interface MovingAverageResponse {
  vehicle: { id: string; license_plate: string; class: VehicleClass };
  points: { trip_date: string; daily_trips: number; daily_fare_revenue: number; seven_day_moving_avg_revenue: number }[];
}

export interface NearbyVehicle {
  vehicle_id: string;
  ping_id: string;
  distance_meters: number;
  location: { type: 'Point'; coordinates: [number, number] };
  speed_kmh: number;
  heading_degrees: number;
  created_at: string;
  pings_in_window: number;
  vehicle: { id: string; license_plate: string; class: VehicleClass; is_active: boolean } | null;
}

export interface NearbyResponse {
  origin: { lng: number; lat: number };
  radius_meters: number;
  window_minutes: number;
  generated_at: string;
  query_ms: number;
  results: NearbyVehicle[];
}

export interface Review {
  review_id: string;
  trip_id: string;
  rider_id: string;
  vehicle_id: string;
  rating: number;
  feedback_tags: string[];
  comment: string | null;
  created_at: string;
  vehicle?: { id: string; license_plate: string; class: VehicleClass } | null;
}

export interface ReviewAnalytics {
  rating_distribution: { stars: number; count: number }[];
  top_feedback_tags: { tag: string; tag_count: number }[];
  overall_summary: { total_reviews: number; average_rating: number | null; std_dev_rating: number | null };
  query_ms: number;
}

export interface Health {
  postgres: { ok: boolean; ms?: number; error?: string };
  mongodb: { ok: boolean; ms?: number; error?: string };
  simulator: { enabled?: boolean; running?: boolean; last_tick_at?: string | null; pings_inserted?: number; last_error?: string | null };
  time: string;
}
