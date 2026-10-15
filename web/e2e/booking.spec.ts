// End-to-end tests for Workflow 1 through the browser, against the real API
// and seeded databases. They pick a rider with no active trip, so they can
// be re-run; each test leaves that rider with no active trip again.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

interface Rider { id: string; name: string; wallet_balance: number; has_active_trip: boolean }
interface Vehicle { id: string; license_plate: string }

let rider: Rider;
let vehicle: Vehicle;

async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(path);
  expect(res.ok(), `${path} -> ${res.status()}`).toBeTruthy();
  return res.json();
}

/** Cancel the rider's active trip (if any) so every test starts clean. */
async function clearActiveTrip(request: APIRequestContext, riderId: string) {
  const detail = await getJson<{ active_trip: { id: string } | null }>(request, `/api/riders/${riderId}`);
  if (detail.active_trip) {
    await request.post(`/api/trips/${detail.active_trip.id}/status`, { data: { status: 'CANCELLED' } });
  }
}

async function actAs(page: Page, riderId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('ridesync.actorRiderId', id), riderId);
}

test.beforeAll(async ({ request }) => {
  // a rider with a mid-range balance and no active trip
  const riders = await getJson<{ items: Rider[] }>(request, '/api/riders?sort=balance_desc&pageSize=100&page=40');
  const found = riders.items.find((r) => !r.has_active_trip && r.wallet_balance > 60 && r.wallet_balance < 400);
  expect(found, 'need a seeded rider with 60-400 balance and no active trip').toBeTruthy();
  rider = found!;
  const vehicles = await getJson<{ items: Vehicle[] }>(request, '/api/vehicles?active=true&pageSize=1');
  vehicle = vehicles.items[0];
});

test.beforeEach(async ({ request, page }) => {
  await clearActiveTrip(request, rider.id);
  await actAs(page, rider.id);
});

test.afterAll(async ({ request }) => {
  await clearActiveTrip(request, rider.id);
});

test('booking shows balance before/after and the audit row written by the trigger', async ({ page, request }) => {
  const before = (await getJson<Rider>(request, `/api/riders/${rider.id}`)).wallet_balance;
  await page.goto(`/#/book?vehicle=${vehicle.id}`);
  await expect(page.getByText(vehicle.license_plate).first()).toBeVisible();

  await page.getByLabel('Fare (₹)').fill('30');
  await page.getByRole('button', { name: /^Book trip/ }).click();

  await expect(page.getByRole('heading', { name: 'Trip booked' })).toBeVisible();
  const change = page.getByTestId('balance-change');
  await expect(change).toContainText(before.toLocaleString('en-IN', { minimumFractionDigits: 2 }));
  await expect(change).toContainText((before - 30).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  await expect(page.getByText('TRIP_ESCROW_DEBIT')).toBeVisible();
  await expect(page.getByText('trg_audit_wallet_balance').first()).toBeVisible();
});

test('a second active trip is refused by idx_active_rider_trip, and cancelling unblocks it', async ({ page }) => {
  await page.goto(`/#/book?vehicle=${vehicle.id}`);
  await expect(page.getByText(vehicle.license_plate).first()).toBeVisible();
  await page.getByLabel('Fare (₹)').fill('20');
  await page.getByRole('button', { name: /^Book trip/ }).click();
  await expect(page.getByRole('heading', { name: 'Trip booked' })).toBeVisible();

  // second booking for the same rider
  await page.getByRole('button', { name: /^Book trip/ }).click();
  const failure = page.getByRole('alert').filter({ hasText: 'already on a trip' });
  await expect(failure).toBeVisible();
  await expect(failure).toContainText('idx_active_rider_trip');

  // the error panel offers the way out
  await failure.getByRole('button', { name: 'Cancel and refund' }).click();
  await expect(page.getByText('Trip cancelled, fare refunded')).toBeVisible();

  await page.getByRole('button', { name: /^Book trip/ }).click();
  await expect(page.getByRole('heading', { name: 'Trip booked' })).toBeVisible();
});

test('insufficient balance explains the shortfall and a top-up fixes it', async ({ page }) => {
  await page.goto(`/#/book?vehicle=${vehicle.id}`);
  await expect(page.getByText(vehicle.license_plate).first()).toBeVisible();

  await page.getByRole('button', { name: 'More than the balance' }).click();
  await page.getByRole('button', { name: /^Book trip/ }).click();

  const failure = page.getByRole('alert').filter({ hasText: 'Not enough money in the wallet' });
  await expect(failure).toBeVisible();
  await expect(failure).toContainText('Nothing was charged');

  await failure.getByRole('button', { name: 'Top up ₹50.00', exact: true }).click();
  await expect(page.getByText('Added ₹50.00 to the wallet')).toBeVisible();

  await page.getByRole('button', { name: /^Book trip/ }).click();
  await expect(page.getByRole('heading', { name: 'Trip booked' })).toBeVisible();
});

test('fare validation happens before anything is sent', async ({ page }) => {
  await page.goto(`/#/book?vehicle=${vehicle.id}`);
  await expect(page.getByText(vehicle.license_plate).first()).toBeVisible();
  await page.getByLabel('Fare (₹)').fill('0');
  await page.getByRole('button', { name: /^Book trip/ }).click();
  await expect(page.getByText('The fare must be more than zero.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trip booked' })).toHaveCount(0);
});

test('audit trail shows a consistent running balance for the rider', async ({ page }) => {
  await page.goto('/#/wallet');
  await expect(page.getByRole('heading', { name: 'Wallet & audit trail' })).toBeVisible();
  await expect(page.getByText('Every running balance matches the balance stored by the trigger.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Wallet audit log entries' })).toBeVisible();
});
