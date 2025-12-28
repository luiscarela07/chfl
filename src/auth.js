import bcrypt from 'bcryptjs'
import { findUserByEmail } from './models.js'

export function requireAuth (req, res, next) {
  if (req.session?.userId) return next()
  res.redirect('/login')
}

export async function loginHandler (req, res) {
  const { email, password } = req.body
  const user = await findUserByEmail(email)
  if (!user) return res.render('login', { error: 'Invalid credentials' })
  const ok = await bcrypt.compare(password, user.password_hash)
  if (!ok) return res.render('login', { error: 'Invalid credentials' })
  req.session.userId = user.id
  req.session.userEmail = user.email
  res.redirect('/')
}

export function logoutHandler (req, res) {
  req.session.destroy(() => res.redirect('/login'))
}
