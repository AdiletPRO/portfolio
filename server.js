// ─────────────────────────────────────────
// Установка (только эти, без better-sqlite3):
//   npm install express cors helmet express-rate-limit express-validator
// ─────────────────────────────────────────

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const fs        = require('fs');   // встроен в Node — не нужно устанавливать
const path      = require('path');

const app = express();
const DB_FILE = path.join(__dirname, 'db.json');

// ══════════════════════════════════════════
// JSON "БАЗА ДАННЫХ"
// Читаем и пишем в файл db.json
// ══════════════════════════════════════════
function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    // Начальные данные при первом запуске
    const initial = {
      projects: [
        { id: 1, title: 'Портфолио сайт',      tech: 'HTML, CSS, Bootstrap',  emoji: '🎨', date: '2026-04-14' },
        { id: 2, title: 'Todo приложение',      tech: 'HTML, CSS, JavaScript', emoji: '📋', date: '2026-04-14' },
        { id: 3, title: 'Погодное приложение',  tech: 'JS, fetch, API',        emoji: '🌤️', date: '2026-04-14' },
      ],
      skills: [
        { id: 1, name: 'HTML',       percent: 90 },
        { id: 2, name: 'CSS',        percent: 80 },
        { id: 3, name: 'Bootstrap',  percent: 70 },
        { id: 4, name: 'JavaScript', percent: 60 },
        { id: 5, name: 'Node.js',    percent: 50 },
        { id: 6, name: 'SQL',        percent: 40 },
      ],
      messages: [],
      nextId: 4
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}


// ══════════════════════════════════════════
// MIDDLEWARE
// ══════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false
}));
app.use(express.json({ limit: '10kb' }));
app.use(cors({
  origin: [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://portfolio-byul.onrender.com'
  ]
}));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });

function sanitize(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


// ══════════════════════════════════════════
// ПРОЕКТЫ
// ══════════════════════════════════════════

app.get('/api/projects', (req, res) => {
  const db = readDB();
  res.json([...db.projects].reverse());
});

app.post('/api/projects', [
  body('title').trim().notEmpty().isLength({ max: 100 }),
  body('tech').trim().notEmpty().isLength({ max: 200 }),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const db = readDB();
  const newProject = {
    id:    db.nextId++,
    title: sanitize(req.body.title),
    tech:  sanitize(req.body.tech),
    emoji: sanitize(req.body.emoji || '💻'),
    date:  new Date().toISOString().slice(0, 10)
  };
  db.projects.push(newProject);
  writeDB(db);
  res.status(201).json(newProject);
});

app.delete('/api/projects/:id', (req, res) => {
  const db  = readDB();
  const id  = Number(req.params.id);
  db.projects = db.projects.filter(p => p.id !== id);
  writeDB(db);
  res.json({ success: true });
});

app.get('/api/search', (req, res) => {
  const db = readDB();
  const q  = (req.query.q || '').toLowerCase();
  const results = db.projects.filter(p =>
    p.title.toLowerCase().includes(q) ||
    p.tech.toLowerCase().includes(q)
  );
  res.json(results.reverse());
});


// ══════════════════════════════════════════
// НАВЫКИ
// ══════════════════════════════════════════

app.get('/api/skills', (req, res) => {
  const db = readDB();
  res.json(db.skills.sort((a, b) => b.percent - a.percent));
});


// ══════════════════════════════════════════
// СООБЩЕНИЯ
// ══════════════════════════════════════════

app.post('/api/contact', contactLimiter, [
  body('name').trim().notEmpty().isLength({ max: 100 }),
  body('email').trim().isEmail(),
  body('message').trim().notEmpty().isLength({ max: 1000 }),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const db = readDB();
  db.messages.unshift({
    id:      db.messages.length + 1,
    name:    sanitize(req.body.name),
    email:   sanitize(req.body.email),
    message: sanitize(req.body.message),
    date:    new Date().toISOString()
  });
  writeDB(db);
  res.json({ success: true });
});

app.get('/api/messages', (req, res) => {
  const db = readDB();
  res.json(db.messages);
});


// ══════════════════════════════════════════
// ЗАПУСК
// ══════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
  console.log('📁 База данных: db.json');
});