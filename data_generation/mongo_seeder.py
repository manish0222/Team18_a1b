"""
RideSync - MongoDB Geospatial & Review Data Seeder
Generates 500k+ realistic TelemetryPings with GeoJSON coordinates and TripReviews.

[A1B changes - see docs/handover_note.md]
* Pings, reviews and VehicleMetadata now reference REAL PostgreSQL ids
  (vehicles.id, trips.id, riders.id). Previously every ping and review got a
  fresh uuid4(), so nothing in MongoDB could be joined back to PostgreSQL and
  the UI could not show "which vehicle is this?" for a map result or review.
  If PostgreSQL is unreachable the old random-id behaviour is used.
* Each vehicle gets a home area and its pings form a short track around it,
  so one vehicle shows up as one moving dot instead of 200 random points.
* Collections are cleared before inserting, so re-running the seeder does not
  hit the unique index on TripReviews.trip_id.
* Run postgres_seeder.py FIRST.
"""

import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from pymongo import MongoClient
from faker import Faker
from tqdm import tqdm

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
MONGO_DB = os.getenv("MONGO_DB", "ridesync_db")

TOTAL_PINGS = 500000
TOTAL_REVIEWS = 50000

fake = Faker('en_IN')  # [A1B] Indian names for inspectors

# Center coordinates (Hyderabad City Center: [Longitude, Latitude])
CENTER_LNG = 78.3820
CENTER_LAT = 17.4435

TAG_POOL = [
    "Clean Car", "Smooth Drive", "Polite Driver", "Great Music",
    "Fast Route", "Safe Driving", "AC Was Cold", "Late Arrival",
    "Rash Driving", "Unprofessional", "Navigation Issue", "Good Conversation"
]


def load_postgres_ids():
    """Return (vehicles, completed_trips) from PostgreSQL, or ([], []) if unavailable."""
    try:
        import psycopg2
        pg_conn = psycopg2.connect(
            host=os.getenv("POSTGRES_HOST", "localhost"),
            port=os.getenv("POSTGRES_PORT", "5432"),
            dbname=os.getenv("POSTGRES_DB", "ridesync_db"),
            user=os.getenv("POSTGRES_USER", "postgres"),
            password=os.getenv("POSTGRES_PASSWORD", "postgres")
        )
        cur = pg_conn.cursor()
        cur.execute("SELECT id, license_plate, class, is_active FROM vehicles;")
        vehicles = [(str(r[0]), r[1], r[2], r[3]) for r in cur.fetchall()]
        cur.execute("SELECT id, rider_id, vehicle_id, created_at FROM trips WHERE status = 'COMPLETED';")
        trips = [(str(r[0]), str(r[1]), str(r[2]), r[3]) for r in cur.fetchall()]
        pg_conn.close()
        return vehicles, trips
    except Exception as e:
        print(f"Could not read PostgreSQL ids ({e}); falling back to random ids.")
        return [], []


def seed_mongodb():
    print(f"Connecting to MongoDB at {MONGO_URI}...")
    client = MongoClient(MONGO_URI)
    db = client[MONGO_DB]

    pg_vehicles, pg_completed_trips = load_postgres_ids()
    active_vehicle_ids = [v[0] for v in pg_vehicles if v[3]]
    # home position per vehicle so its pings form a plausible track
    vehicle_home = {
        v_id: (CENTER_LNG + random.uniform(-0.15, 0.15), CENTER_LAT + random.uniform(-0.15, 0.15))
        for v_id in active_vehicle_ids
    }

    # Generate Telemetry Pings
    print(f"Seeding {TOTAL_PINGS} TelemetryPings with GeoJSON 2dsphere points...")
    pings_collection = db["TelemetryPings"]
    pings_collection.delete_many({})
    
    batch_size = 10000
    pings_batch = []
    
    now = datetime.utcnow()
    
    for i in tqdm(range(TOTAL_PINGS), desc="Telemetry Pings"):
        # Ping timestamps within the last 1.5 hours (within 2-hr TTL window)
        ping_time = now - timedelta(seconds=random.randint(0, 5400))

        if active_vehicle_ids:
            vehicle_id = random.choice(active_vehicle_ids)
            home_lng, home_lat = vehicle_home[vehicle_id]
            # wander up to ~2 km around the vehicle's home area
            lng = home_lng + random.uniform(-0.02, 0.02)
            lat = home_lat + random.uniform(-0.02, 0.02)
        else:
            # Spread points within ~15km radius of city center (original behaviour)
            vehicle_id = str(uuid.uuid4())
            lng = CENTER_LNG + random.uniform(-0.15, 0.15)
            lat = CENTER_LAT + random.uniform(-0.15, 0.15)

        doc = {
            "ping_id": str(uuid.uuid4()),
            "vehicle_id": vehicle_id,
            "is_available": random.random() > 0.3,
            "speed_kmh": round(random.uniform(0.0, 95.0), 1),
            "heading_degrees": round(random.uniform(0.0, 360.0), 1),
            "location": {
                "type": "Point",
                "coordinates": [round(lng, 6), round(lat, 6)]
            },
            "created_at": ping_time
        }
        pings_batch.append(doc)

        if len(pings_batch) >= batch_size:
            pings_collection.insert_many(pings_batch, ordered=False)
            pings_batch = []

    if pings_batch:
        pings_collection.insert_many(pings_batch, ordered=False)

    # Generate Trip Reviews
    print(f"Seeding {TOTAL_REVIEWS} TripReviews...")
    reviews_collection = db["TripReviews"]
    reviews_collection.delete_many({})
    reviews_batch = []

    # one review per sampled COMPLETED trip (trip_id is unique in TripReviews)
    sampled_trips = random.sample(pg_completed_trips, min(TOTAL_REVIEWS, len(pg_completed_trips)))
    review_count = len(sampled_trips) if sampled_trips else TOTAL_REVIEWS

    for i in tqdm(range(review_count), desc="Trip Reviews"):
        rating = random.choices([5, 4, 3, 2, 1], weights=[50, 25, 12, 8, 5])[0]
        num_tags = random.randint(1, 4)
        tags = random.sample(TAG_POOL, num_tags)
        
        if sampled_trips:
            trip_id, rider_id, vehicle_id, trip_created = sampled_trips[i]
            created_at = min(
                trip_created.astimezone(timezone.utc).replace(tzinfo=None) + timedelta(hours=random.randint(1, 48)),
                datetime.utcnow(),
            )
        else:
            trip_id, rider_id, vehicle_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
            created_at = fake.date_time_between(start_date="-60d", end_date="now")

        doc = {
            "review_id": str(uuid.uuid4()),
            "trip_id": trip_id,
            "rider_id": rider_id,
            "vehicle_id": vehicle_id,
            "rating": int(rating),
            "feedback_tags": tags,
            "comment": fake.sentence() if random.random() > 0.4 else None,
            "created_at": created_at
        }
        reviews_batch.append(doc)

        if len(reviews_batch) >= batch_size:
            reviews_collection.insert_many(reviews_batch, ordered=False)
            reviews_batch = []

    if reviews_batch:
        reviews_collection.insert_many(reviews_batch, ordered=False)

    # Generate VehicleMetadata (linking to PostgreSQL vehicles if available)
    print("Seeding VehicleMetadata...")
    vm_collection = db["VehicleMetadata"]
    
    # Real vehicle IDs from Postgres (loaded once at the top)
    vehicles_info = [(v_id, plate, v_class) for v_id, plate, v_class, _active in pg_vehicles]

    if not vehicles_info:
        classes = ["Standard", "Comfort", "XL", "Executive", "Black"]
        vehicles_info = [(str(uuid.uuid4()), f"TS {random.randint(1, 38):02d} {fake.lexify('??').upper()} {1000 + (i * 7919) % 9000}", random.choice(classes)) for i in range(2500)]

    vm_batch = []
    for v_id, plate, v_class in tqdm(vehicles_info, desc="Vehicle Metadata"):
        num_inspections = random.randint(1, 3)
        inspections = []
        for _ in range(num_inspections):
            inspections.append({
                "inspection_id": str(uuid.uuid4()),
                "date": fake.date_time_between(start_date="-1y", end_date="now"),
                "passed": random.random() > 0.05,
                "inspector": f"RTA Station #{random.randint(10, 99)} - {fake.first_name()} {fake.last_name()}",
                "notes": fake.sentence()
            })

        doc = {
            "vehicle_id": str(v_id),
            "license_plate": plate,
            "class": v_class,
            "inspection_records": inspections,
            "features": {
                "has_child_seat": random.random() > 0.5,
                "wheelchair_accessible": random.random() > 0.7,
                "pet_friendly": random.random() > 0.6,
                "dashcam_enabled": random.random() > 0.3
            },
            "updated_at": datetime.utcnow()
        }
        vm_batch.append(doc)

    if vm_batch:
        vm_collection.delete_many({})
        vm_collection.insert_many(vm_batch, ordered=False)

    print("MongoDB seeding completed successfully!")


if __name__ == "__main__":
    seed_mongodb()

