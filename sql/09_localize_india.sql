-- ============================================================================
-- RideSync - Assignment 1B
-- 09_localize_india.sql: make existing seeded data look Indian
-- ============================================================================
-- The Assignment 1 seeder used Faker's default (US) locale, so riders had
-- names like "Michael Brown" and plates like "TX-4821-AB", in a product set in
-- Hyderabad. This script rewrites, in place and without re-seeding:
--   * riders.name  -> Indian first name + surname (mixed regions)
--   * riders.email -> firstname.surname<n>@example.in (unique)
--   * vehicles.license_plate -> Indian format "TS 09 EK 4821"
--     (mostly Telangana, some AP / KA / MH / TN; plates stay UNIQUE)
-- then refreshes mv_vehicle_lifetime_earnings (it stores the plate).
-- Balances, trips, audit rows and ids are untouched, so nothing else changes.
-- MongoDB VehicleMetadata also stores the plate: run
--   python data_generation/sync_vehicle_plates.py
-- afterwards to copy the new plates there.
-- Deterministic: re-running gives the same names and plates.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE _first_names (i INT, name TEXT) ON COMMIT DROP;
INSERT INTO _first_names
SELECT ordinality - 1, name FROM unnest(ARRAY[
  'Aarav','Vivaan','Aditya','Arjun','Sai','Reyansh','Krishna','Ishaan','Rohan','Karthik',
  'Vikram','Rahul','Siddharth','Anirudh','Pranav','Harsha','Varun','Nikhil','Abhishek','Manish',
  'Suresh','Ravi','Venkat','Srinivas','Rajesh','Mahesh','Naveen','Kiran','Teja','Charan',
  'Imran','Farhan','Arif','Sameer','Joseph','Thomas','Gurpreet','Harpreet','Aniket','Omkar',
  'Ananya','Aadhya','Diya','Saanvi','Priya','Kavya','Meera','Sneha','Pooja','Divya',
  'Lakshmi','Swathi','Harika','Sravani','Keerthi','Bhavana','Nandini','Deepika','Shreya','Ishita',
  'Aishwarya','Neha','Riya','Tanvi','Sana','Ayesha','Fatima','Mary','Anjali','Simran',
  'Akash','Ajay','Amit','Anand','Ashok','Bharat','Chetan','Deepak','Dinesh','Gaurav',
  'Girish','Hemant','Jagadeesh','Jayant','Kunal','Lokesh','Madhav','Mohan','Nitin','Prakash',
  'Pradeep','Rakesh','Sandeep','Sanjay','Satish','Shiva','Sunil','Tarun','Uday','Vinay',
  'Yash','Zubair','Alok','Bhargav','Dhruv','Eshwar','Hrithik','Kabir','Manoj','Parth',
  'Aparna','Bhavya','Chitra','Gayathri','Hema','Indu','Jyothi','Kalpana','Lavanya','Madhuri',
  'Mounika','Nikitha','Padma','Pallavi','Radha','Ramya','Rekha','Roopa','Sahithi','Sangeetha',
  'Shalini','Sindhu','Sowmya','Sunitha','Supriya','Uma','Vaishnavi','Vani','Varsha','Yamini'
]) WITH ORDINALITY AS t(name, ordinality);

CREATE TEMP TABLE _last_names (i INT, name TEXT) ON COMMIT DROP;
INSERT INTO _last_names
SELECT ordinality - 1, name FROM unnest(ARRAY[
  'Reddy','Rao','Naidu','Sharma','Verma','Gupta','Iyer','Iyengar','Nair','Menon',
  'Pillai','Kumar','Singh','Patel','Shah','Mehta','Joshi','Kulkarni','Deshpande','Patil',
  'Chowdary','Varma','Raju','Goud','Yadav','Mishra','Pandey','Banerjee','Chatterjee','Mukherjee',
  'Das','Bose','Sen','Khan','Hussain','Siddiqui','Fernandes','DSouza','Gill','Sandhu',
  'Agarwal','Bansal','Kapoor','Malhotra','Chauhan','Thakur','Hegde','Shetty','Bhat','Krishnan',
  'Acharya','Bhattacharya','Chandra','Dutta','Ganguly','Ghosh','Jain','Kamath','Karnik','Kaur',
  'Kohli','Lal','Mahajan','Murthy','Nambiar','Pai','Prasad','Rajan','Rathod','Saxena',
  'Sethi','Sinha','Srivastava','Subramanian','Tiwari','Trivedi','Venkatesh','Vyas','Wagh','Zaveri'
]) WITH ORDINALITY AS t(name, ordinality);

-- 1. Riders: name + unique email
WITH numbered AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY id) AS rn,
           abs(hashtext(id::text)::bigint) AS h,
           abs(hashtext('surname' || id::text)::bigint) AS h2
    FROM riders
), named AS (
    SELECT n.id, n.rn, f.name AS first_name, l.name AS last_name
    FROM numbered n
    JOIN _first_names f ON f.i = n.h % (SELECT count(*) FROM _first_names)
    JOIN _last_names  l ON l.i = n.h2 % (SELECT count(*) FROM _last_names)
)
UPDATE riders r
SET name  = nm.first_name || ' ' || nm.last_name,
    email = lower(nm.first_name) || '.' || lower(nm.last_name) || nm.rn || '@example.in'
FROM named nm
WHERE r.id = nm.id;

-- 2. Vehicles: Indian plates "SS DD LL NNNN"; the 4 digits are a bijection
--    of the row number (7919 is coprime with 9000), so plates are unique.
WITH numbered AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY id) AS rn,
           abs(hashtext('plate' || id::text)::bigint) AS h
    FROM vehicles
)
UPDATE vehicles v
SET license_plate =
      (ARRAY['TS','TS','TS','TS','TS','TS','AP','AP','KA','MH','TN'])[1 + n.h % 11]
   || ' ' || lpad((1 + (n.h / 11) % 38)::text, 2, '0')
   || ' ' || chr((65 + (n.h / 418) % 26)::int) || chr((65 + (n.h / 10868) % 26)::int)
   || ' ' || (1000 + ((n.rn * 7919) % 9000))::text
FROM numbered n
WHERE v.id = n.id;

COMMIT;

-- the materialized view copies license_plate, so rebuild it
REFRESH MATERIALIZED VIEW mv_vehicle_lifetime_earnings;

SELECT 'riders renamed' AS step, count(*) FROM riders
UNION ALL
SELECT 'vehicles re-plated', count(*) FROM vehicles WHERE license_plate ~ '^[A-Z]{2} \d{2} [A-Z]{2} \d{4}$';
