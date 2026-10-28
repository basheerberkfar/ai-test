import crypto from "node:crypto";
import { openDb, now } from "./sqlite.js";

/** Database of the system under test (the patient management demo app). */
export const demoDb = openDb("demo.db");

demoDb.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('therapist','admin')),
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  date_of_birth TEXT NOT NULL,
  gender TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

export function hashPassword(password: string, salt = crypto.randomBytes(8).toString("hex")) {
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString("hex")}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt] = stored.split(":");
  return crypto.timingSafeEqual(Buffer.from(hashPassword(password, salt)), Buffer.from(stored));
}

const SEED_USERS = [
  { email: process.env.TEST_THERAPIST_EMAIL || "therapist@demo.clinic", name: "Dr. Maya Chen", role: "therapist", password: process.env.TEST_THERAPIST_PASSWORD || "Therapist#2024" },
  { email: process.env.TEST_ADMIN_EMAIL || "admin@demo.clinic", name: "Alex Morgan", role: "admin", password: process.env.TEST_ADMIN_PASSWORD || "Admin#2024" },
];

// Deterministic seed: same data for every reset so benchmark runs are comparable.
const SEED_PATIENTS: [string, string, string, string, string, string][] = [
  ["Olivia Bennett", "olivia.bennett@example.com", "+1 415 555 0101", "1987-03-14", "Female", "Active"],
  ["Liam Carter", "liam.carter@example.com", "+1 415 555 0102", "1979-11-02", "Male", "Active"],
  ["Sophia Alvarez", "sophia.alvarez@example.com", "+1 415 555 0103", "1992-06-21", "Female", "On Hold"],
  ["Noah Fischer", "noah.fischer@example.com", "+1 415 555 0104", "1968-01-30", "Male", "Discharged"],
  ["Emma Johansson", "emma.johansson@example.com", "+1 415 555 0105", "2001-09-09", "Female", "Active"],
  ["Lucas Moreau", "lucas.moreau@example.com", "+1 415 555 0106", "1995-12-17", "Male", "Inactive"],
  ["Ava Thompson", "ava.thompson@example.com", "+1 415 555 0107", "1983-04-05", "Female", "Active"],
  ["Ethan Brooks", "ethan.brooks@example.com", "+1 415 555 0108", "1975-08-23", "Male", "On Hold"],
  ["Mia Rossi", "mia.rossi@example.com", "+1 415 555 0109", "1990-02-11", "Female", "Inactive"],
  ["Jordan Lee", "jordan.lee@example.com", "+1 415 555 0110", "1998-07-28", "Non-binary", "Active"],
  ["Isabella Novak", "isabella.novak@example.com", "+1 415 555 0111", "1972-10-19", "Female", "Discharged"],
  ["Mason Clarke", "mason.clarke@example.com", "+1 415 555 0112", "1986-05-03", "Male", "Active"],
  ["Charlotte Weber", "charlotte.weber@example.com", "+1 415 555 0113", "1999-01-25", "Female", "Active"],
  ["Logan Price", "logan.price@example.com", "+1 415 555 0114", "1965-06-14", "Male", "Inactive"],
  ["Amelia Dubois", "amelia.dubois@example.com", "+1 415 555 0115", "1993-03-08", "Female", "On Hold"],
  ["Elijah Grant", "elijah.grant@example.com", "+1 415 555 0116", "1981-12-01", "Male", "Active"],
  ["Harper Quinn", "harper.quinn@example.com", "+1 415 555 0117", "2003-04-16", "Female", "Active"],
  ["Benjamin Hart", "benjamin.hart@example.com", "+1 415 555 0118", "1970-09-27", "Male", "Discharged"],
  ["Evelyn Park", "evelyn.park@example.com", "+1 415 555 0119", "1988-11-12", "Female", "Active"],
  ["Samuel Ortiz", "samuel.ortiz@example.com", "+1 415 555 0120", "1977-02-20", "Male", "Active"],
  ["Abigail Stone", "abigail.stone@example.com", "+1 415 555 0121", "1996-08-04", "Female", "Inactive"],
  ["Daniel Kim", "daniel.kim@example.com", "+1 415 555 0122", "1984-05-29", "Male", "Active"],
  ["Ella Sanders", "ella.sanders@example.com", "+1 415 555 0123", "1991-10-07", "Female", "On Hold"],
  ["Robin Olsen", "robin.olsen@example.com", "+1 415 555 0124", "1960-01-15", "Prefer not to say", "Inactive"],
];

/** Wipe and reseed the demo database. Used between independent benchmark runs. */
export function resetDemoData() {
  demoDb.exec("DELETE FROM sessions; DELETE FROM patients; DELETE FROM users;");
  const insUser = demoDb.prepare("INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)");
  for (const u of SEED_USERS) insUser.run(u.email, u.name, u.role, hashPassword(u.password));
  const therapistId = (demoDb.prepare("SELECT id FROM users WHERE role = 'therapist'").get() as { id: number }).id;
  const insPatient = demoDb.prepare(
    `INSERT INTO patients (full_name, email, phone, date_of_birth, gender, status, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  SEED_PATIENTS.forEach(([name, email, phone, dob, gender, status], i) => {
    const ts = new Date(Date.UTC(2024, 0, 1 + i, 9)).toISOString();
    insPatient.run(name, email, phone, dob, gender, status, i % 3 === 0 ? "Initial intake completed." : null, therapistId, ts, ts);
  });
}

if (!demoDb.prepare("SELECT 1 FROM users LIMIT 1").get()) resetDemoData();

export { now };
