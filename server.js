// ─────────────────────────────────────────
// Установка всех зависимостей:
//   npm install express cors better-sqlite3 helmet express-rate-limit express-validator
// ─────────────────────────────────────────

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');        // HTTP заголовки безопасности
const rateLimit  = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const Database   = require('better-sqlite3');
const path       = require('path');

const app = express();


// ══════════════════════════════════════════
// 1. HELMET — защита HTTP заголовков
// Автоматически добавляет заголовки которые
// защищают от XSS, кликджекинга и других атак
// ══════════════════════════════════════════
app.use(helmet());


// ══════════════════════════════════════════
// 2. RATE LIMITING — защита от брутфорса
// Максимум 100 запросов за 15 минут с одного IP
// ══════════════════════════════════════════
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100,
  message: { error: 'Слишком много запросов. Подожди 15 минут.' }
});
app.use('/api/', limiter);

// Строгий лимит для формы контактов — 5 сообщений в час
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Лимит сообщений исчерпан. Попробуй через час.' }
});


// ══════════════════════════════════════════
// 3. CORS — разрешаем только свой домен
// В продакшне замени на свой реальный URL
// ══════════════════════════════════════════
const allowedOrigins = [
  'http://localhost:5500',      // Live Server (VS Code)
  'http://127.0.0.1:5500',
  'https://твой-сайт.vercel.app' // ← сюда вставишь свой URL после деплоя
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS: этот домен не разрешён'));
    }
  }
}));

app.use(express.json({ limit: '10kb' })); // ограничение размера тела запроса


// ══════════════════════════════════════════
// 4. БАЗА ДАННЫХ
// ══════════════════════════════════════════
const db = new Database('portfolio.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    title  TEXT NOT NULL,
    tech   TEXT NOT NULL,
    emoji  TEXT DEFAULT '💻',
    date   TEXT DEFAULT (date('now'))
  );
  CREATE TABLE IF NOT EXISTS messages (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL,
    email   TEXT NOT NULL,
    message TEXT NOT NULL,
    date    TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS skills (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL,
    percent INTEGER NOT NULL
  );
`);

const count = db.prepare('SELECT COUNT(*) as n FROM projects').get();
if (count.n === 0) {
  const ip = db.prepare('INSERT INTO projects (title, tech, emoji) VALUES (?,?,?)');
  ip.run('Портфолио сайт',     'HTML, CSS, Bootstrap',  '🎨');
  ip.run('Todo приложение',    'HTML, CSS, JavaScript', '📋');
  ip.run('Погодное приложение','JS, fetch, API',        '🌤️');

  const is = db.prepare('INSERT INTO skills (name, percent) VALUES (?,?)');
  ['HTML','CSS','Bootstrap','JavaScript','Node.js','SQL'].forEach((n,i) =>
    is.run(n, [90,80,70,60,50,40][i])
  );
}


// ══════════════════════════════════════════
// 5. ФУНКЦИЯ ОЧИСТКИ ОТ XSS
// Убирает HTML-теги из строки — защита от
// Cross-Site Scripting (XSS) атак
// ══════════════════════════════════════════
function sanitize(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#x27;');
}


// ══════════════════════════════════════════
// МАРШРУТЫ
// ══════════════════════════════════════════

// Отдаём index.html для фронтенда
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/projects
app.get('/api/projects', (req, res) => {
  res.json(db.prepare('SELECT * FROM projects ORDER BY id DESC').all());
});

// POST /api/projects — с валидацией
app.post('/api/projects', [
  body('title').trim().notEmpty().isLength({ max: 100 }),
  body('tech').trim().notEmpty().isLength({ max: 200 }),
  body('emoji').optional().trim().isLength({ max: 10 }),
], (req, res) => {
  // Проверяем ошибки валидации
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  // Очищаем от XSS
  const title = sanitize(req.body.title);
  const tech  = sanitize(req.body.tech);
  const emoji = sanitize(req.body.emoji || '💻');

  const result = db.prepare('INSERT INTO projects (title, tech, emoji) VALUES (?,?,?)').run(title, tech, emoji);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(project);
});

// DELETE /api/projects/:id
app.delete('/api/projects/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Неверный id' });
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  res.json({ success: true });
});

// GET /api/skills
app.get('/api/skills', (req, res) => {
  res.json(db.prepare('SELECT * FROM skills ORDER BY percent DESC').all());
});

// GET /api/search
app.get('/api/search', (req, res) => {
  const q = sanitize(req.query.q || '');
  const results = db.prepare(
    "SELECT * FROM projects WHERE title LIKE ? OR tech LIKE ?"
  ).all(`%${q}%`, `%${q}%`);
  res.json(results);
});

// POST /api/contact — с валидацией + rate limit
app.post('/api/contact', contactLimiter, [
  body('name').trim().notEmpty().isLength({ max: 100 }),
  body('email').trim().isEmail().normalizeEmail(),
  body('message').trim().notEmpty().isLength({ max: 1000 }),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const name    = sanitize(req.body.name);
  const email   = sanitize(req.body.email);
  const message = sanitize(req.body.message);

  db.prepare('INSERT INTO messages (name, email, message) VALUES (?,?,?)').run(name, email, message);
  res.json({ success: true });
});

// GET /api/messages
app.get('/api/messages', (req, res) => {
  res.json(db.prepare('SELECT * FROM messages ORDER BY id DESC').all());
});


// ══════════════════════════════════════════
// ОБРАБОТКА ОШИБОК
// ══════════════════════════════════════════
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// 404 для неизвестных маршрутов
app.use((req, res) => {
  res.status(404).json({ error: 'Маршрут не найден' });
});


// ══════════════════════════════════════════
// ЗАПУСК
// process.env.PORT — для Render/Railway
// 3000 — локально
// ══════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(PORT === 3000
    ? 'Локально: http://localhost:3000'
    : `Продакшн: порт ${PORT}`
  );
});