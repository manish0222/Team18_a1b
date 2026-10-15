"""
RideSync - PostgreSQL High-Volume Data Seeder
Generates 100k+ realistic mock rows across riders, vehicles, trips, and wallet audit logs.
"""

import os
import random
import uuid
from datetime import datetime, timedelta
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import execute_values
from faker import Faker
from tqdm import tqdm

load_dotenv()

DB_HOST = os.getenv("POSTGRES_HOST", "localhost")
DB_PORT = os.getenv("POSTGRES_PORT", "5432")
DB_NAME = os.getenv("POSTGRES_DB", "ridesync_db")
DB_USER = os.getenv("POSTGRES_USER", "postgres")
DB_PASS = os.getenv("POSTGRES_PASSWORD", "postgres")

TOTAL_RIDERS = 10000
TOTAL_VEHICLES = 2500
TOTAL_TRIPS = 100000

# [A1B] Indian locale: the product is set in Hyderabad
fake = Faker('en_IN')
INDIAN_STATES = ['TS', 'TS', 'TS', 'TS', 'TS', 'TS', 'AP', 'AP', 'KA', 'MH', 'TN']
VEHICLE_CLASSES = ["Standard", "Comfort", "XL", "Executive", "Black"]
TRIP_STATUSES = ["COMPLETED", "COMPLETED", "COMPLETED", "CANCELLED", "IN_TRANSIT", "REQUESTED"]


def get_connection():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASS
    )


def seed_postgres():
    print(f"Connecting to PostgreSQL at {DB_HOST}:{DB_PORT}/{DB_NAME}...")
    conn = get_connection()
    cursor = conn.cursor()

    try:
        # 1. Seed Riders
        print(f"Seeding {TOTAL_RIDERS} riders...")
        rider_rows = []
        rider_ids = []
        for _ in range(TOTAL_RIDERS):
            r_id = str(uuid.uuid4())
            rider_ids.append(r_id)
            name = f"{fake.first_name()} {fake.last_name()}"
            email = f"{r_id[:8]}_{fake.unique.email()}"
            balance = round(random.uniform(20.0, 500.0), 2)
            created_at = fake.date_time_between(start_date="-1y", end_date="now")
            rider_rows.append((r_id, name, email, balance, created_at, created_at))

        execute_values(
            cursor,
            """
            INSERT INTO riders (id, name, email, wallet_balance, created_at, updated_at)
            VALUES %s ON CONFLICT (id) DO NOTHING
            """,
            rider_rows,
            page_size=2000
        )
        conn.commit()

        # 2. Seed Vehicles
        print(f"Seeding {TOTAL_VEHICLES} vehicles...")
        vehicle_rows = []
        vehicle_ids = []
        for i in range(TOTAL_VEHICLES):
            v_id = str(uuid.uuid4())
            vehicle_ids.append(v_id)
            # [A1B] Indian format "TS 09 EK 4821"; the 4 digits are a bijection of i
            # (7919 is coprime with 9000), so plates stay unique for i < 9000
            plate = (f"{random.choice(INDIAN_STATES)} {random.randint(1, 38):02d} "
                     f"{chr(65 + (i % 26))}{chr(65 + ((i // 26) % 26))} {1000 + (i * 7919) % 9000}")
            v_class = random.choice(VEHICLE_CLASSES)
            is_active = random.random() > 0.05
            created_at = fake.date_time_between(start_date="-2y", end_date="-1y")
            vehicle_rows.append((v_id, plate, v_class, is_active, created_at))

        execute_values(
            cursor,
            """
            INSERT INTO vehicles (id, license_plate, class, is_active, created_at)
            VALUES %s ON CONFLICT (license_plate) DO NOTHING
            """,
            vehicle_rows,
            page_size=2000
        )
        conn.commit()

        # 3. Seed Trips (Ensuring at most 1 active trip per rider for idx_active_rider_trip)
        print(f"Seeding {TOTAL_TRIPS} trips...")
        trip_rows = []
        active_riders = set()
        
        for _ in tqdm(range(TOTAL_TRIPS), desc="Trips"):
            t_id = str(uuid.uuid4())
            r_id = random.choice(rider_ids)
            v_id = random.choice(vehicle_ids)
            fare = round(random.uniform(8.0, 150.0), 2)
            
            # A rider can have at most ONE active trip ('REQUESTED' or 'IN_TRANSIT')
            if r_id not in active_riders and random.random() < 0.05:
                status = random.choice(["IN_TRANSIT", "REQUESTED"])
                active_riders.add(r_id)
            else:
                status = random.choice(["COMPLETED", "COMPLETED", "COMPLETED", "CANCELLED"])

            created_at = fake.date_time_between(start_date="-90d", end_date="now")
            completed_at = created_at + timedelta(minutes=random.randint(10, 60)) if status == "COMPLETED" else None

            trip_rows.append((t_id, r_id, v_id, fare, status, created_at, completed_at))

        execute_values(
            cursor,
            """
            INSERT INTO trips (id, rider_id, vehicle_id, fare_amount, status, created_at, completed_at)
            VALUES %s ON CONFLICT (id) DO NOTHING
            """,
            trip_rows,
            page_size=5000
        )
        conn.commit()

        print("PostgreSQL seeding completed successfully!")

    except Exception as e:
        conn.rollback()
        print(f"Error during seeding: {e}")
        raise
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    seed_postgres()