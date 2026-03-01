#!/usr/bin/env node
/**
 * scripts/seed.js
 * ───────────────
 * Seeds the cafeteria database with a realistic menu for local testing.
 *
 * Usage:
 *   node scripts/seed.js                  # hit stock-service on default port 3003
 *   STOCK_URL=http://localhost:3003 node scripts/seed.js
 *
 * The script:
 *   1. Waits up to 30 s for the stock-service /health endpoint to respond.
 *   2. POSTs the full menu to /seed (upsert — safe to run multiple times).
 *   3. Fetches the resulting inventory and prints a summary table.
 *
 * Prerequisites: docker compose up (or the stock-service running standalone).
 */

const STOCK_URL = process.env.STOCK_URL || 'http://localhost:3003';

// ── Full cafeteria menu ──────────────────────────────────────────────────────
const MENU_ITEMS = [
  // Mains
  { id: 'spaghetti',    name: 'Spaghetti Carbonara',      quantity: 50 },
  { id: 'ramen',        name: 'Spicy Miso Ramen',          quantity: 40 },
  { id: 'pizza',        name: 'Pepperoni Pizza',            quantity: 30 },
  { id: 'burger',       name: 'Classic Beef Burger',        quantity: 35 },
  { id: 'biryani',      name: 'Chicken Biryani',            quantity: 45 },
  { id: 'sushi',        name: 'Salmon Sushi (8 pcs)',       quantity: 20 },
  { id: 'wrap',         name: 'Grilled Chicken Wrap',       quantity: 25 },
  { id: 'salad',        name: 'Caesar Salad',               quantity: 30 },
  // Sides
  { id: 'fries',        name: 'Crispy Fries',               quantity: 60 },
  { id: 'garlic-bread', name: 'Garlic Bread',               quantity: 40 },
  { id: 'soup',         name: 'Tomato Soup',                quantity: 30 },
  // Drinks
  { id: 'cola',         name: 'Coca-Cola (330 ml)',         quantity: 80 },
  { id: 'juice',        name: 'Fresh Orange Juice',         quantity: 50 },
  { id: 'water',        name: 'Mineral Water',              quantity: 100 },
  { id: 'coffee',       name: 'Flat White Coffee',          quantity: 60 },
  // Desserts
  { id: 'cheesecake',   name: 'New York Cheesecake',        quantity: 15 },
  { id: 'brownie',      name: 'Chocolate Brownie',          quantity: 25 },
  { id: 'icecream',     name: 'Vanilla Ice Cream',          quantity: 35 },
  // Low-stock edge-case item (useful for fast-fail tests)
  { id: 'special',      name: 'Chef\'s Special (limited!)', quantity: 3  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function get(path) {
  const res = await fetch(`${STOCK_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${STOCK_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function waitForHealth(maxWaitMs = 30_000) {
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const data = await get('/health');
      if (data.status === 'UP') {
        console.log(`✅  stock-service is healthy (attempt ${attempt})`);
        return;
      }
    } catch {
      // not ready yet
    }
    process.stdout.write(`   Waiting for stock-service… (attempt ${attempt})\r`);
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`stock-service did not become healthy within ${maxWaitMs / 1000} s`);
}

function printTable(items) {
  const col1 = Math.max(4, ...items.map(i => i.id.length));
  const col2 = Math.max(4, ...items.map(i => i.name.length));
  const col3 = 8;
  const line = `${'─'.repeat(col1 + 2)}┼${'─'.repeat(col2 + 2)}┼${'─'.repeat(col3 + 2)}`;
  const row = (id, name, qty) =>
    ` ${id.padEnd(col1)} │ ${name.padEnd(col2)} │ ${String(qty).padStart(col3)} `;

  console.log(`\n ${'ID'.padEnd(col1)}   ${'NAME'.padEnd(col2)}   ${'QUANTITY'.padStart(col3)}`);
  console.log(line);
  for (const i of items) console.log(row(i.id, i.name, i.quantity));
  console.log(`\n ${items.length} items in inventory.\n`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n🌱  Cafeteria seed script`);
  console.log(`   Target: ${STOCK_URL}\n`);

  try {
    await waitForHealth();

    console.log(`\n📦  Seeding ${MENU_ITEMS.length} menu items…`);
    const seedResult = await post('/seed', { items: MENU_ITEMS });
    console.log(`   ${seedResult.message}`);

    console.log(`\n📋  Current inventory:\n`);
    const inventory = await get('/stock');
    printTable(inventory);

    console.log(`🎉  Done! The stack is ready to test.\n`);
    console.log(`   Student UI  → http://localhost:3000`);
    console.log(`   Admin dash  → http://localhost:3000/admin`);
    console.log(`   Grafana     → http://localhost:3006  (admin / admin)`);
    console.log(`   RabbitMQ    → http://localhost:15672 (guest / guest)`);
    console.log(`   Prometheus  → http://localhost:9090\n`);
  } catch (err) {
    console.error(`\n❌  Seed failed: ${err.message}\n`);
    console.error(`   Make sure the stack is running:  docker compose up -d --build\n`);
    process.exit(1);
  }
})();
