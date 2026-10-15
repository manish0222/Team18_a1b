// ============================================================================
// RideSync - Global Ride-Hailing Network
// 02_workflow3_geonear.js: Workflow 3 - Nearest Available Vehicle ($geoNear)
// ============================================================================

const dbName = 'ridesync_db';
// [A1B fix] was `const db = db.getSiblingDB(dbName);` - redeclaring the mongosh
// global `db` with const reads it before initialisation (ReferenceError).
db = db.getSiblingDB(dbName);

// Example coordinates for rider location (e.g. Hyderabad, India: Longitude, Latitude)
// NOTE: GeoJSON format strictly requires [longitude, latitude]
const riderLocation = {
    type: "Point",
    coordinates: [78.3820, 17.4435] 
};

const maxRadiusMeters = 5000; // 5 km search radius

print(`Executing $geoNear query within ${maxRadiusMeters / 1000}km radius...`);

const pipeline = [
    {
        $geoNear: {
            near: riderLocation,
            distanceField: "distance_meters",
            maxDistance: maxRadiusMeters,
            spherical: true,
            query: { is_available: true }
        }
    },
    {
        $sort: { distance_meters: 1 }
    },
    {
        $limit: 10
    },
    {
        $project: {
            _id: 0,
            ping_id: 1,
            vehicle_id: 1,
            distance_meters: { $round: ["$distance_meters", 2] },
            speed_kmh: 1,
            heading_degrees: 1,
            location: 1,
            created_at: 1
        }
    }
];

const results = db.TelemetryPings.aggregate(pipeline).toArray();
printjson(results);
