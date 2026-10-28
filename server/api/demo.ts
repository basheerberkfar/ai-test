import crypto from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { demoDb, verifyPassword, now } from "../database/demo-db.js";
import { bugOn } from "../config.js";

/**
 * Backend of the system under test. Some behaviors are controlled by flags in
 * config/sut.json; their meaning is documented only in evaluation/hidden-bugs.json.
 */
export const demoApi = Router();

type User = { id: number; email: string; name: string; role: "therapist" | "admin" };
type AuthedRequest = Request & { user: User };

const STATUSES = ["Active", "Inactive", "On Hold", "Discharged"];
const GENDERS = ["Female", "Male", "Non-binary", "Prefer not to say"];
const PAGE_SIZE = 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const user = token
    ? (demoDb
        .prepare("SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?")
        .get(token) as User | undefined)
    : undefined;
  if (!user) return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  (req as AuthedRequest).user = user;
  next();
}

function toPatient(row: any) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone ?? "",
    dateOfBirth: row.date_of_birth,
    gender: row.gender,
    status: row.status,
    notes: row.notes ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type PatientInput = {
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  status: string;
  notes: string;
};

function validatePatient(body: any): { data?: PatientInput; errors?: Record<string, string> } {
  const errors: Record<string, string> = {};
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const data: PatientInput = {
    fullName: s(body?.fullName),
    email: s(body?.email),
    phone: s(body?.phone),
    dateOfBirth: s(body?.dateOfBirth),
    gender: s(body?.gender),
    status: s(body?.status) || "Active",
    notes: typeof body?.notes === "string" ? body.notes.trim() : "",
  };

  if (!data.fullName) errors.fullName = "Full name is required.";
  else if (data.fullName.length < 2) errors.fullName = "Full name must be at least 2 characters.";
  else if (data.fullName.length > 100) errors.fullName = "Full name must be 100 characters or fewer.";

  if (!data.email) errors.email = "Email is required.";
  else if (!bugOn("BUG-03") && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) errors.email = "Enter a valid email address.";

  if (data.phone && !/^\+?[0-9\s().-]{7,20}$/.test(data.phone)) errors.phone = "Enter a valid phone number.";

  if (!data.dateOfBirth) errors.dateOfBirth = "Date of birth is required.";
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(data.dateOfBirth) || Number.isNaN(Date.parse(data.dateOfBirth)))
    errors.dateOfBirth = "Enter a valid date.";
  else if (data.dateOfBirth > new Date().toISOString().slice(0, 10)) errors.dateOfBirth = "Date of birth cannot be in the future.";

  if (!data.gender) errors.gender = "Gender is required.";
  else if (!GENDERS.includes(data.gender)) errors.gender = "Select a valid option.";

  if (!STATUSES.includes(data.status)) errors.status = "Select a valid status.";
  if (data.notes.length > 2000) errors.notes = "Notes must be 2000 characters or fewer.";

  return Object.keys(errors).length ? { errors } : { data };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

demoApi.post("/auth/login", async (req, res) => {
  await sleep(250);
  const { email, password } = req.body ?? {};
  const row = demoDb
    .prepare("SELECT id, email, name, role, password_hash FROM users WHERE lower(email) = lower(?)")
    .get(String(email ?? "").trim()) as (User & { password_hash: string }) | undefined;
  if (!row || !verifyPassword(String(password ?? ""), row.password_hash))
    return res.status(401).json({ error: "Incorrect email or password." });
  const token = crypto.randomBytes(24).toString("hex");
  demoDb.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, row.id, now());
  const { password_hash: _ignored, ...user } = row;
  res.json({ token, user });
});

demoApi.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: (req as AuthedRequest).user });
});

demoApi.post("/auth/logout", requireAuth, (req, res) => {
  const token = req.header("authorization")!.replace(/^Bearer\s+/i, "");
  demoDb.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

demoApi.get("/patients", requireAuth, (req, res) => {
  const search = String(req.query.search ?? "").trim();
  const status = String(req.query.status ?? "").trim();
  const page = Math.max(1, Number(req.query.page) || 1);

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (search) {
    where.push("lower(full_name) LIKE ?");
    params.push(`%${search.toLowerCase()}%`);
  }
  const applyStatus = status && status !== "All" && !(bugOn("BUG-02") && search);
  if (applyStatus) {
    where.push("status = ?");
    params.push(status);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (demoDb.prepare(`SELECT COUNT(*) AS n FROM patients ${clause}`).get(...params) as { n: number }).n;
  const rows = demoDb
    .prepare(`SELECT * FROM patients ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE);

  res.json({ items: rows.map(toPatient), page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

demoApi.get("/patients/:id", requireAuth, (req, res) => {
  const row = demoDb.prepare("SELECT * FROM patients WHERE id = ?").get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Patient not found." });
  res.json(toPatient(row));
});

demoApi.post("/patients", requireAuth, async (req, res) => {
  const { data, errors } = validatePatient(req.body);
  if (errors) return res.status(422).json({ error: "Please correct the highlighted fields.", fieldErrors: errors });
  await sleep(900); // realistic latency of a downstream service
  const ts = now();
  const user = (req as AuthedRequest).user;
  const notes = bugOn("BUG-05") ? null : data!.notes || null;
  const result = demoDb
    .prepare(
      `INSERT INTO patients (full_name, email, phone, date_of_birth, gender, status, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(data!.fullName, data!.email, data!.phone || null, data!.dateOfBirth, data!.gender, data!.status, notes, user.id, ts, ts);
  const row = demoDb.prepare("SELECT * FROM patients WHERE id = ?").get(Number(result.lastInsertRowid));
  res.status(201).json(toPatient(row));
});

demoApi.put("/patients/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!demoDb.prepare("SELECT 1 FROM patients WHERE id = ?").get(id)) return res.status(404).json({ error: "Patient not found." });
  const { data, errors } = validatePatient(req.body);
  if (errors) return res.status(422).json({ error: "Please correct the highlighted fields.", fieldErrors: errors });
  await sleep(400);
  demoDb
    .prepare(
      `UPDATE patients SET full_name = ?, email = ?, phone = ?, date_of_birth = ?, gender = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?`,
    )
    .run(data!.fullName, data!.email, data!.phone || null, data!.dateOfBirth, data!.gender, data!.status, data!.notes || null, now(), id);
  res.json(toPatient(demoDb.prepare("SELECT * FROM patients WHERE id = ?").get(id)));
});

demoApi.delete("/patients/:id", requireAuth, (req, res) => {
  const user = (req as AuthedRequest).user;
  if (!bugOn("BUG-04") && user.role !== "admin")
    return res.status(403).json({ error: "Only administrators can delete patients." });
  const result = demoDb.prepare("DELETE FROM patients WHERE id = ?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "Patient not found." });
  res.status(204).end();
});
