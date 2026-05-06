const express = require('express');
const multer = require('multer');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── CARPETAS ──
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR  = path.join(__dirname, 'public');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(PUBLIC_DIR))  fs.mkdirSync(PUBLIC_DIR);

// ── BASE DE DATOS ──
const db = new Database(path.join(__dirname, 'sepet.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    text        TEXT    DEFAULT '',
    tags        TEXT    DEFAULT '',
    date        TEXT    NOT NULL,
    filename    TEXT    NOT NULL,
    featured    INTEGER DEFAULT 0,
    visibility  TEXT    DEFAULT 'public',
    created_at  TEXT    DEFAULT (datetime('now'))
  )
`);

// ── MIDDLEWARES ──
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR));

// ── MULTER (subida de fotos) ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20mb
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// ════════════════════════════════
//  API ROUTES
// ════════════════════════════════

// GET todas las entradas públicas
app.get('/api/entries', (req, res) => {
  const { tag, visibility } = req.query;
  let query = `SELECT * FROM entries`;
  const params = [];

  if (visibility !== 'all') {
    query += ` WHERE visibility = 'public'`;
    if (tag && tag !== 'todo') {
      query += ` AND tags LIKE ?`;
      params.push(`%${tag}%`);
    }
  } else {
    if (tag && tag !== 'todo') {
      query += ` WHERE tags LIKE ?`;
      params.push(`%${tag}%`);
    }
  }

  query += ` ORDER BY created_at DESC`;
  const entries = db.prepare(query).all(...params);
  res.json(entries);
});

// GET entrada destacada
app.get('/api/entries/featured', (req, res) => {
  const entry = db.prepare(`SELECT * FROM entries WHERE featured = 1 AND visibility = 'public' ORDER BY created_at DESC LIMIT 1`).get();
  res.json(entry || null);
});

// GET una entrada por id
app.get('/api/entries/:id', (req, res) => {
  const entry = db.prepare(`SELECT * FROM entries WHERE id = ?`).get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'No encontrada' });
  res.json(entry);
});

// POST nueva entrada (con foto)
app.post('/api/entries', upload.single('photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna foto' });

    const { title, text, tags, date, featured, visibility } = req.body;

    // Si se marca como destacada, quitar la anterior
    if (featured === '1' || featured === true) {
      db.prepare(`UPDATE entries SET featured = 0`).run();
    }

    const result = db.prepare(`
      INSERT INTO entries (title, text, tags, date, filename, featured, visibility)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      title || 'Sin título',
      text   || '',
      tags   || '',
      date   || new Date().toISOString().split('T')[0],
      req.file.filename,
      featured === '1' ? 1 : 0,
      visibility || 'public'
    );

    const entry = db.prepare(`SELECT * FROM entries WHERE id = ?`).get(result.lastInsertRowid);
    res.json({ ok: true, entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT editar entrada
app.put('/api/entries/:id', upload.single('photo'), (req, res) => {
  try {
    const existing = db.prepare(`SELECT * FROM entries WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'No encontrada' });

    const { title, text, tags, date, featured, visibility } = req.body;
    const filename = req.file ? req.file.filename : existing.filename;

    if (featured === '1') {
      db.prepare(`UPDATE entries SET featured = 0`).run();
    }

    db.prepare(`
      UPDATE entries SET title=?, text=?, tags=?, date=?, filename=?, featured=?, visibility=?
      WHERE id=?
    `).run(
      title      || existing.title,
      text       ?? existing.text,
      tags       ?? existing.tags,
      date       || existing.date,
      filename,
      featured === '1' ? 1 : 0,
      visibility || existing.visibility,
      req.params.id
    );

    const entry = db.prepare(`SELECT * FROM entries WHERE id = ?`).get(req.params.id);
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE entrada
app.delete('/api/entries/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM entries WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'No encontrada' });

  // Borrar archivo de imagen
  const filePath = path.join(UPLOADS_DIR, existing.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare(`DELETE FROM entries WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ── FALLBACK → sirve el frontend ──
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ SEPET corriendo en http://localhost:${PORT}`);
});
