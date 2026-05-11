import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import sqlite3 from "sqlite3";
import session from "express-session";

const app = express();
const PORT = process.env.PORT || 4000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
  secret: 'osteria_secret_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
}));

const db = new sqlite3.Database(path.join(__dirname, "restaurant.db"));

const tables = [
  { id: 7, name: "Masa 7", x: 20, y: 30, capacity: 2, shape: "round" },
  { id: 8, name: "Masa 8", x: 20, y: 110, capacity: 2, shape: "round" },
  { id: 11, name: "Masa 11", x: 20, y: 190, capacity: 2, shape: "round" },
  { id: 13, name: "Masa 13", x: 20, y: 270, capacity: 2, shape: "round" },
  { id: 9, name: "Masa 9", x: 530, y: 30, capacity: 2, shape: "round" },
  { id: 10, name: "Masa 10", x: 530, y: 110, capacity: 2, shape: "round" },
  { id: 12, name: "Masa 12", x: 530, y: 190, capacity: 2, shape: "round" },
  { id: 14, name: "Masa 14", x: 530, y: 270, capacity: 2, shape: "round" },
  { id: 3, name: "Masa 3", x: 130, y: 60, capacity: 4, shape: "square" },
  { id: 4, name: "Masa 4", x: 130, y: 230, capacity: 4, shape: "square" },
  { id: 5, name: "Masa 5", x: 410, y: 60, capacity: 4, shape: "square" },
  { id: 6, name: "Masa 6", x: 410, y: 230, capacity: 4, shape: "square" },
  { id: 1, name: "Masa 1", x: 255, y: 110, capacity: 6, shape: "rect" },
  { id: 2, name: "Masa 2", x: 255, y: 190, capacity: 6, shape: "rect" }
];

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS staff_users (username TEXT UNIQUE, password TEXT, full_name TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS reservations (id INTEGER PRIMARY KEY, table_id INTEGER, customer_name TEXT, phone_number TEXT, guest_count INTEGER, start_time TEXT, end_time TEXT, status TEXT DEFAULT 'pending', cancel_reason TEXT)`);
  db.run(`INSERT OR IGNORE INTO staff_users VALUES ('admin', '12345', 'Yönetici')`);
});

// İstatistik Servisi (Personel için)
app.get("/api/stats", (req, res) => {
  if (req.session.user?.role !== 'staff') return res.status(403).json({ message: "Yetkisiz" });
  const today = new Date().toISOString().split('T')[0];
  db.get(`SELECT COUNT(*) as total, SUM(guest_count) as guests FROM reservations WHERE start_time LIKE ? AND status != 'cancelled'`, [`${today}%`], (err, row) => {
    res.json({
      totalRes: row.total || 0,
      totalGuests: row.guests || 0,
      occupancy: Math.round(((row.total || 0) / tables.length) * 100)
    });
  });
});

app.post("/api/login/cust", (req, res) => {
  const { fullName, phone } = req.body;
  if(!fullName || !phone) return res.status(400).json({ message: "Lütfen tüm alanları doldurun" });
  if(phone.length !== 11) return res.status(400).json({ message: "Telefon numarası 11 haneli olmalıdır." });
  req.session.user = { role: "customer", fullName, phone };
  res.json({ user: req.session.user });
});

app.post("/api/login/staff", (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM staff_users WHERE username=? AND password=?`, [username, password], (err, row) => {
    if (row) {
      req.session.user = { role: "staff", fullName: row.full_name };
      res.json({ user: req.session.user });
    } else res.status(401).json({ message: "Hatalı Giriş" });
  });
});

app.get("/api/availability", (req, res) => {
  const { startTime, duration } = req.query;
  const start = new Date(startTime);
  const end = new Date(start.getTime() + (duration || 2) * 3600000);

  db.all(`SELECT * FROM reservations WHERE status != 'cancelled'`, (err, rows) => {
    const results = tables.map(t => {
      const isReserved = rows.some(r => {
        if (r.table_id !== t.id) return false;
        const rStart = new Date(r.start_time);
        const rEnd = new Date(r.end_time);
        return (start < rEnd && end > rStart);
      });
      return { ...t, isReserved };
    });
    res.json(results);
  });
});

app.get("/api/reservations", (req, res) => {
  let sql = `SELECT * FROM reservations ORDER BY start_time ASC`;
  let params = [];
  if (req.session.user?.role === 'customer') {
    sql = `SELECT * FROM reservations WHERE (customer_name = ? AND phone_number = ?) AND status != 'cancelled' ORDER BY start_time DESC`;
    params = [req.session.user.fullName, req.session.user.phone];
  }
  db.all(sql, params, (err, rows) => {
    res.json((rows || []).map(r => ({ ...r, tableName: tables.find(t => t.id === r.table_id)?.name })));
  });
});

app.post("/api/reservations", (req, res) => {
  const { tableId, guests, start, duration } = req.body;
  const startDay = start.split('T')[0];
  
  db.get(`SELECT id FROM reservations WHERE customer_name=? AND phone_number=? AND start_time LIKE ? AND status != 'cancelled'`, 
    [req.session.user.fullName, req.session.user.phone, `${startDay}%`], (err, row) => {
      if(row && req.session.user.role === 'customer') {
          return res.status(400).json({ message: "Bugün için zaten aktif bir rezervasyonunuz bulunuyor." });
      }

      const end = new Date(new Date(start).getTime() + duration * 3600000).toISOString();
      db.run(`INSERT INTO reservations (table_id, customer_name, phone_number, guest_count, start_time, end_time, status) VALUES (?,?,?,?,?,?,'pending')`,
        [tableId, req.session.user.fullName, req.session.user.phone, guests, start, end], () => res.json({ ok: true }));
  });
});

app.patch("/api/reservations/:id/confirm", (req, res) => {
  db.run(`UPDATE reservations SET status='confirmed' WHERE id=?`, [req.params.id], () => res.json({ ok: true }));
});

app.delete("/api/reservations/:id", (req, res) => {
  const reason = req.body.reason || "Müşteri iptal etti";
  db.run(`UPDATE reservations SET status='cancelled', cancel_reason=? WHERE id=?`, [reason, req.params.id], () => res.json({ ok: true }));
});

app.listen(PORT, () => console.log(`Osteria Server: http://localhost:${PORT}`));