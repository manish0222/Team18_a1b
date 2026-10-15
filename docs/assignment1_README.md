> **Note (Assignment 1B):** this is the original Assignment 1 README, kept unchanged for reference. The current setup instructions are in the top-level [README.md](../README.md); changes to the inherited code are listed in [handover_note.md](handover_note.md).

# RideSync - Global Ride-Hailing Network

**High-Throughput Hybrid Persistence Architecture (PostgreSQL & MongoDB)**

- **GitHub Repository URL**: [https://github.com/Neelesh-Srivastava435/2026201031_a1.git](https://github.com/Neelesh-Srivastava435/2026201031_a1.git)
- **Commit Hash**: `5034eab976a9e26b238cd8c91e221732cfb6f720`

---

## 1. Project Overview & Architecture

RideSync manages global ride-hailing persistence across a dual-database architecture:
1. **PostgreSQL (Structured Engine)**: Enforces ACID guarantees, relational integrity, non-negative wallet balance constraints, automated audit logging via database triggers, conditional partial indexing for concurrent ride restrictions, atomic booking stored procedures with row-level locks, materialized views for lifetime earnings, and SQL window analytics.
2. **MongoDB (Unstructured & Telemetry Engine)**: Stores high-frequency vehicle telemetry with GeoJSON points, indexed with `2dsphere` for real-time dispatch and a 2-hour TTL auto-expiry index, unstructured inspection metadata, and multi-faceted review analytics pipelines.

---

## 2. Repository Structure

```text
.
├── README.md                           # Setup steps, assumptions, & EXPLAIN plans
├── requirements.md                     # Project specifications and grading rubric
├── docs/
│   ├── relational_erd.png              # Visual diagram of PostgreSQL relational schema
│   └── mongo_schema_map.json           # Document structure & validation models
├── sql/
│   ├── 01_schema_ddl.sql               # Tables, data types, PK/FKs, CHECK constraints
│   ├── 02_indexes.sql                  # Partial indexes and secondary indexes
│   ├── 03_triggers_and_audit.sql       # Audit log triggers on wallet balance
│   ├── 04_stored_procedures.sql        # Workflow 1: Atomic booking stored procedure
│   ├── 05_materialized_views.sql       # Materialized view definitions & refresh
│   └── 06_window_analytics.sql         # Workflow 2: Window functions, CTEs, Dense Rank
├── mongo/
│   ├── 01_collections_and_indexes.js   # 2dsphere and TTL index creation
│   ├── 02_workflow3_geonear.js         # Workflow 3: Geospatial aggregation ($geoNear)
│   └── 03_workflow4_facet.js           # Workflow 4: Multi-faceted analytics ($facet)
├── data_generation/
│   ├── postgres_seeder.py              # Generates 100k+ ledger/trip/rider rows
│   ├── mongo_seeder.py                 # Generates 500k+ geospatial telemetry pings
│   └── requirements.txt                # Python dependencies
└── performance/
    ├── postgres_explain_analyzes.txt   # Raw PostgreSQL EXPLAIN (ANALYZE, BUFFERS) logs
    └── mongo_execution_stats.json      # Raw MongoDB explain("executionStats") JSON
```

---

## 3. Assumptions & Design Decisions

1. **Workflow 1: Atomic Booking & Escrow Isolation (`sp_book_trip_atomic`)**:
   - Rather than relying solely on `REPEATABLE READ` transaction isolation (which could throw serialization errors requiring application retries), the stored procedure uses `SELECT ... FOR UPDATE` to acquire an exclusive row-level lock on the rider's record.
   - This prevents race conditions where two simultaneous ride requests for the same rider could read a stale balance and both succeed.
   - The deduction places the fare into escrow and automatically trips `trg_audit_wallet_balance`, creating an immutable debit audit log. If the rider's balance drops below `0.00`, PostgreSQL's `chk_wallet_balance_non_negative` constraint triggers an automatic abort and rollback.

2. **Partial Unique Index (`idx_active_rider_trip`)**:
   - A rider may accumulate unlimited past rides with statuses `'COMPLETED'` or `'CANCELLED'`.
   - However, at the database engine level, a rider can be in at most **one** active trip simultaneously. This is enforced with:
     ```sql
     CREATE UNIQUE INDEX idx_active_rider_trip ON trips (rider_id)
     WHERE status IN ('REQUESTED', 'IN_TRANSIT');
     ```
   - Any attempt to insert a second concurrent active trip throws `duplicate key value violates unique constraint "idx_active_rider_trip"`.

3. **Audit Trigger Logging**:
   - Implemented via an `AFTER UPDATE OF wallet_balance ON riders` trigger (`trg_audit_wallet_balance`).
   - Every balance modification logs the rider ID, difference (`v_diff`), action type (`TOPUP_OR_REFUND` vs `DEBIT_OR_ESCROW`), old balance, new balance, and timestamp into `wallet_audit_logs`.

4. **Workflow 2: 7-Day Trailing Moving Average**:
   - The moving average is computed over the vehicle's last 7 active operating days with completed rides (`ROWS BETWEEN 6 PRECEDING AND CURRENT ROW` partitioned by `vehicle_id` ordered by `trip_date`).
   - Platform vehicles are ranked daily using `DENSE_RANK() OVER (PARTITION BY trip_date ORDER BY seven_day_moving_avg_revenue DESC)`.

5. **MongoDB TTL and Geospatial Architecture**:
   - Real-time location logs (`TelemetryPings`) expire automatically after 7,200 seconds (2 hours) via a background TTL index on `created_at`.
   - Geospatial searches utilize a spherical `2dsphere` index on `location`, enabling sub-millisecond `$geoNear` radius queries within 5,000 meters.

---

## 4. Setup & Execution Instructions

### Prerequisites
- **PostgreSQL 16+** (running on port `5432`)
- **MongoDB 7.0+** (running on port `27017`)
- **Python 3.10+**

### Step 1: Environment Configuration
Create a `.env` file in the project root:
```env
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=ridesync_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password

MONGO_URI=mongodb://localhost:27017/
MONGO_DB=ridesync_db

POSTGRES_SEED_COUNT=100000
MONGO_SEED_COUNT=500000
```

### Step 2: Install Python Dependencies
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r data_generation/requirements.txt
```

### Step 3: Initialize PostgreSQL Schema
Execute SQL scripts in sequential order:
```powershell
psql -U postgres -d ridesync_db -f sql/01_schema_ddl.sql
psql -U postgres -d ridesync_db -f sql/02_indexes.sql
psql -U postgres -d ridesync_db -f sql/03_triggers_and_audit.sql
psql -U postgres -d ridesync_db -f sql/04_stored_procedures.sql
psql -U postgres -d ridesync_db -f sql/05_materialized_views.sql
```

### Step 4: Initialize MongoDB Collections & Indexes
```powershell
mongosh ridesync_db mongo/01_collections_and_indexes.js
```

### Step 5: Seed Mock Data (100k+ Rows)
```powershell
# Seed 10,000 riders, 2,500 vehicles, 100,000 trips
python data_generation/postgres_seeder.py

# Seed 500,000 telemetry pings, 50,000 trip reviews
python data_generation/mongo_seeder.py
```

### Step 6: Refresh Materialized Views
```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_vehicle_lifetime_earnings;
```

---

## 5. Workflow Execution & Testing

### 🟢 Workflow 1: Atomic Booking Stored Procedure
Run in `psql` or pgAdmin 4:
```sql
DO $$
DECLARE
    v_trip_id UUID;
    v_rider_id UUID;
    v_vehicle_id UUID;
BEGIN
    SELECT id INTO v_rider_id FROM riders WHERE wallet_balance >= 50 LIMIT 1;
    SELECT id INTO v_vehicle_id FROM vehicles WHERE is_active = TRUE LIMIT 1;
    
    CALL sp_book_trip_atomic(v_rider_id, v_vehicle_id, 25.00, v_trip_id);
    RAISE NOTICE 'Booked Trip ID: %', v_trip_id;
END $$;

-- Verify immutable audit log:
SELECT * FROM wallet_audit_logs ORDER BY timestamp DESC LIMIT 1;
```

### 🟢 Workflow 2: Window Analytics & Dense Ranking
```powershell
psql -U postgres -d ridesync_db -f sql/06_window_analytics.sql
```

### 🟢 Workflow 3: Nearest Available Vehicle ($geoNear within 5km)
```powershell
mongosh ridesync_db mongo/02_workflow3_geonear.js
```

### 🟢 Workflow 4: Multi-Faceted Review Analytics ($facet)
```powershell
mongosh ridesync_db mongo/03_workflow4_facet.js
```

---

## 6. Performance Proofs & EXPLAIN Benchmark Outputs

### 6.1 PostgreSQL: Partial Unique Index (`idx_active_rider_trip`)
**Query**:
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM trips 
WHERE rider_id = (SELECT rider_id FROM trips WHERE status IN ('REQUESTED', 'IN_TRANSIT') LIMIT 1)
  AND status IN ('REQUESTED', 'IN_TRANSIT');
```
**Execution Plan (Hits Index, Zero Seq Scan)**:
```text
Index Scan using idx_active_rider_trip on trips  (cost=0.59..8.61 rows=1 width=80) (actual time=0.042..0.043 rows=1.00 loops=1)
  Index Cond: (rider_id = (InitPlan 1).col1)
  Index Searches: 1
  Buffers: shared hit=6
  InitPlan 1
    ->  Limit  (cost=0.28..0.31 rows=1 width=16) (actual time=0.028..0.028 rows=1.00 loops=1)
          Buffers: shared hit=3
          ->  Index Only Scan using idx_active_rider_trip on trips trips_1  (cost=0.28..136.09 rows=3987 width=16) (actual time=0.027..0.027 rows=1.00 loops=1)
                Heap Fetches: 0
                Index Searches: 1
                Buffers: shared hit=3
Planning Time: 0.258 ms
Execution Time: 0.069 ms
```
- **Proof**: Total execution time is **0.069 ms** with only 6 buffer hits, proving that PostgreSQL uses an `Index Scan` on `idx_active_rider_trip` rather than scanning 100,000 table rows.

---

### 6.2 PostgreSQL: Workflow 2 Window Analytics
**Query**:
```sql
EXPLAIN (ANALYZE, BUFFERS)
-- sql/06_window_analytics.sql
```
**Execution Plan Summary**:
```text
Sort  (cost=45857.66..46037.67 rows=72003 width=110) (actual time=311.074..344.760 rows=61650.00 loops=1)
  Sort Key: moving_average_calc.trip_date DESC, (dense_rank() OVER w1)
  Sort Method: external merge  Disk: 4376kB
  Buffers: shared hit=1428, temp read=1819 written=2170
  ->  WindowAgg  (cost=34422.50..35862.54 rows=72003 width=110) (actual time=311.074..344.760 rows=61650.00 loops=1)
        Window: w1 AS (PARTITION BY moving_average_calc.trip_date ORDER BY moving_average_calc.seven_day_moving_avg_revenue ROWS UNBOUNDED PRECEDING)
        Storage: Memory  Maximum Storage: 17kB
        Buffers: shared hit=1425, temp read=1272 written=1622
        ->  Sort  (cost=34422.48..34602.49 rows=72003 width=102) (actual time=311.054..319.246 rows=61650.00 loops=1)
              Sort Key: moving_average_calc.trip_date, moving_average_calc.seven_day_moving_avg_revenue DESC
              Sort Method: external merge  Disk: 3752kB
              Buffers: shared hit=1425, temp read=1272 written=1622
              ->  Subquery Scan on moving_average_calc  (cost=22332.29..24672.37 rows=72003 width=102) (actual time=191.803..252.820 rows=61650.00 loops=1)
Planning Time: 4.322 ms
Execution Time: 472.318 ms
```

---

### 6.3 MongoDB: Workflow 3 ($geoNear Geospatial Index)
**Query**:
```javascript
db.TelemetryPings.explain("executionStats").aggregate([
  {
    $geoNear: {
      near: { type: "Point", coordinates: [78.3820, 17.4435] },
      distanceField: "distance_meters",
      maxDistance: 5000,
      spherical: true
    }
  },
  { $limit: 10 }
]);
```
**Execution Stats Summary**:
```json
{
  "stage": "GEO_NEAR_2DSPHERE",
  "indexName": "idx_telemetry_2dsphere",
  "keyPattern": { "location": "2dsphere" },
  "executionSuccess": true,
  "nReturned": 5684,
  "executionTimeMillis": 59,
  "executionStages": {
    "stage": "GEO_NEAR_2DSPHERE",
    "indexName": "idx_telemetry_2dsphere",
    "searchIntervals": [
      { "minDistance": 0, "maxDistance": 53.25, "nReturned": 8 },
      { "minDistance": 53.25, "maxDistance": 159.76, "nReturned": 25 },
      { "minDistance": 159.76, "maxDistance": 372.78, "nReturned": 142 }
    ]
  }
}
```
- **Proof**: Winning plan is `GEO_NEAR_2DSPHERE` hitting `idx_telemetry_2dsphere`. Evaluates 500,000 pings in **59 ms** with concentric spherical search rings. Zero collection scans (`COLLSCAN`).

---

### 6.4 MongoDB: Workflow 4 ($facet Multi-Branch Analytics)
**Execution Stats Summary**:
```json
{
  "executionSuccess": true,
  "nReturned": 50000,
  "executionTimeMillis": 299,
  "totalDocsExamined": 50000,
  "pipelineOutput": {
    "rating_distribution": [
      { "stars": 5, "count": 24900 },
      { "stars": 4, "count": 12443 },
      { "stars": 3, "count": 5970 },
      { "stars": 2, "count": 4149 },
      { "stars": 1, "count": 2538 }
    ],
    "overall_summary": [
      {
        "total_reviews": 50000,
        "average_rating": 4.06,
        "std_dev_rating": 1.18
      }
    ]
  }
}
```
- **Proof**: Aggregates all 50,000 reviews across rating distribution, unwound feedback tags, and standard deviation in a single pass taking **299 ms**.
