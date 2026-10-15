// ============================================================================
// RideSync - Global Ride-Hailing Network
// 01_collections_and_indexes.js: Collection Setup & Geospatial/TTL Indexing
// ============================================================================

// Connect to database
const dbName = 'ridesync_db';
// [A1B fix] was `const db = db.getSiblingDB(dbName);` - redeclaring the mongosh
// global `db` with const reads it before initialisation (ReferenceError).
db = db.getSiblingDB(dbName);

print(`Setting up collections and indexes for database: ${dbName}`);

// 1. VehicleMetadata Collection & Unique Index
db.createCollection("VehicleMetadata");
db.VehicleMetadata.createIndex({ "vehicle_id": 1 }, { unique: true, name: "idx_vehicle_id_unique" });
db.VehicleMetadata.createIndex({ "class": 1 }, { name: "idx_vehicle_class" });

// 2. TripReviews Collection & Indexes
db.createCollection("TripReviews");
db.TripReviews.createIndex({ "trip_id": 1 }, { unique: true, name: "idx_review_trip_unique" });
db.TripReviews.createIndex({ "vehicle_id": 1 }, { name: "idx_review_vehicle" });
db.TripReviews.createIndex({ "rating": 1 }, { name: "idx_review_rating" });
db.TripReviews.createIndex({ "feedback_tags": 1 }, { name: "idx_review_feedback_tags" });
db.TripReviews.createIndex({ "created_at": -1 }, { name: "idx_review_created_at" });

// 3. TelemetryPings Collection, 2dsphere Geospatial Index, and 2-Hour TTL Index
db.createCollection("TelemetryPings");

// 2dsphere index on GeoJSON Point location field
db.TelemetryPings.createIndex(
    { "location": "2dsphere" }, 
    { name: "idx_telemetry_2dsphere" }
);

// 2-Hour (7200 seconds) TTL index on created_at
db.TelemetryPings.createIndex(
    { "created_at": 1 }, 
    { expireAfterSeconds: 7200, name: "idx_telemetry_ttl_2hr" }
);

// Compound index for filtering available vehicles by time
db.TelemetryPings.createIndex(
    { "is_available": 1, "created_at": -1 }, 
    { name: "idx_telemetry_available_recent" }
);

print("Successfully initialized all collections and indexes.");
