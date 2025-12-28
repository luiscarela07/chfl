import fs from "fs/promises";
import path from "path";
import bcrypt from "bcryptjs";

const dbPath = path.resolve("data", "db.json");

function parseArgs() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === "--email") out.email = a[++i];
    else if (k === "--password") out.password = a[++i];
    else if (k === "--create") out.create = true;
    else throw new Error(`Unknown arg: ${k}`);
  }
  if (!out.email || !out.password) {
    throw new Error("Usage: node src/change-admin.js --email <EMAIL> --password <PASSWORD> [--create]");
  }
  return out;
}

async function loadDb() {
  try {
    const raw = await fs.readFile(dbPath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") return { meta: { migrations: [] }, users: [], cases: [] };
    throw e;
  }
}

async function saveDb(db) {
  const tmp = dbPath + ".tmp";
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, dbPath);
}

async function main() {
  const { email, password, create } = parseArgs();
  const db = await loadDb();
  db.users ||= [];
  const hash = bcrypt.hashSync(password, 10);

  const idx = db.users.findIndex(u => (u.email || "").toLowerCase() === email.toLowerCase());

  if (idx >= 0) {
    db.users[idx].password_hash = hash;
    db.users[idx].email = email;
    db.users[idx].updated_at = new Date().toISOString();
    console.log(`Updated existing user: ${email}`);
  } else if (create || db.users.length === 0) {
    const nextId = (db.users.reduce((m,u)=>Math.max(m, Number(u.id)||0), 0) || 0) + 1;
    db.users.push({ id: nextId, email, password_hash: hash, created_at: new Date().toISOString() });
    console.log(`Created user: ${email}`);
  } else {
    const existing = db.users.map(u => u.email).join(", ") || "(none)";
    throw new Error(`User not found for "${email}". Existing: ${existing}. Re-run with --create to add.`);
  }

  await saveDb(db);
  console.log("Saved data/db.json");
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
