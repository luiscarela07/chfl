// src/server.js
import express from 'express'
import session from 'express-session'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'

import config from './config.js'
import { migrateAndSeed, findUserByEmail } from './models.js'
import dashboardRouter from './routes/dashboard.js'
import casesRouter from './routes/cases.js'
import { brandMiddleware } from './brand.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

const app = express()

// If running behind Azure’s reverse proxy, trust it for secure cookies
app.set('trust proxy', 1)

// Views & static assets
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))
app.use(express.static(path.join(__dirname, 'public')))

// Parsers
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Sessions
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production', // requires trust proxy in Azure
    maxAge: 1000 * 60 * 60 * 8 // 8 hours
  }
}))

// Branding
app.use(brandMiddleware)

// Simple auth helpers
function requireAuth(req, res, next) {
  if (req.session?.user?.id) return next()
  return res.redirect('/login')
}


function blockWritesForViewOnly(req, res, next) {
  const role = String(req.session?.user?.role || 'admin').toLowerCase()
  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method)
  if (safe || role === 'admin') return next()
  if ((req.get('Accept') || '').includes('application/json')) return res.status(403).json({ ok: false, error: 'read_only' })
  return res.status(403).send('Read-only account. Changes are not allowed.')
}


// Public routes
app.get('/login', (_req, res) => {
  res.render('login', { error: null })
})

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    const user = await findUserByEmail(String(email || '').trim().toLowerCase())
    if (!user) return res.status(401).render('login', { error: 'Invalid credentials' })
    const ok = bcrypt.compareSync(String(password || ''), user.password_hash)
    if (!ok) return res.status(401).render('login', { error: 'Invalid credentials' })
    req.session.user = { id: user.id, email: user.email, role: user.role || 'admin' }
    res.redirect('/')
  } catch (e) {
    console.error('Login error:', e)
    res.status(500).render('login', { error: 'Login error' })
  }
})

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'))
})

// Health check (enable in Azure → Settings → Health check → /healthz)
app.get('/healthz', (_req, res) => res.status(200).send('ok'))

// Protected routes
app.use('/', requireAuth, blockWritesForViewOnly, dashboardRouter)
app.use('/cases', requireAuth, blockWritesForViewOnly, casesRouter)

// 404
app.use((req, res) => res.status(404).send('Not found'))

// Error handler
// Avoid leaking stack traces in views
app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).send('Internal Server Error')
})

const PORT = config.port

const server = app.listen(PORT, '0.0.0.0', async () => {
  try {
    await migrateAndSeed()
  } catch (e) {
    console.error('Migration error:', e)
  }
  // Write a small pid file to the data directory (useful for scripts)
  try {
    const fs = await import('fs/promises')
    const dataDir = path.resolve(path.dirname(config.dbPath))
    await fs.mkdir(dataDir, { recursive: true })
    await fs.writeFile(path.join(dataDir, 'app.pid'), String(process.pid), 'utf8')
  } catch {
    // ignore
  }
  console.log(`Mini Case Mgmt JSON app is running on port ${PORT}`)
})

export default server
