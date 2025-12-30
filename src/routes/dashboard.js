import { Router } from 'express'
import { getDashboardData, getOpenTasksByPhase, listUsers, createUser, resetUserPassword, phaseNamesByStatus } from '../models.js'

const router = Router()

router.get('/', async (_req, res) => {
  try {
    const { org } = await getDashboardData()

    // Use canonical labels (mix of pre/lit): P1, P2 common; P3=Discovery (lit), P4=Trial (lit), P5=Demand.
    const litNames = phaseNamesByStatus('litigation')
    const rings = [
      { phase: 0, label: 'Total Cases', open: org.totalCases, total: org.totalCases, href: null },
      { phase: 1, label: `${litNames[1]} — Open Tasks`, open: org.openTasksByPhase[1] || 0, total: org.totalTasksByPhase[1] || 0, href: '/phase/1/open-tasks' },
      { phase: 2, label: `${litNames[2]} — Open Tasks`, open: org.openTasksByPhase[2] || 0, total: org.totalTasksByPhase[2] || 0, href: '/phase/2/open-tasks' },
      { phase: 3, label: `${litNames[3]} — Open Tasks`, open: org.openTasksByPhase[3] || 0, total: org.totalTasksByPhase[3] || 0, href: '/phase/3/open-tasks' },
      { phase: 4, label: `${litNames[4]} — Open Tasks`, open: org.openTasksByPhase[4] || 0, total: org.totalTasksByPhase[4] || 0, href: '/phase/4/open-tasks' },
      { phase: 5, label: `${litNames[5]} — Open Tasks`, open: org.openTasksByPhase[5] || 0, total: org.totalTasksByPhase[5] || 0, href: '/phase/5/open-tasks' }
    ]
    res.render('dashboard', { org, rings })
  } catch (e) {
    console.error('[GET /] dashboard error:', e)
    res.status(500).send('Dashboard failed. Please retry.')
  }
})


router.get('/phase/:phase/open-tasks', async (req, res) => {
  try {
    const phase = Number(req.params.phase)
    const litNames = phaseNamesByStatus('litigation')
    const label = litNames?.[phase] ? `${litNames[phase]} — Open Tasks` : `Phase ${phase} — Open Tasks`
    const rows = await getOpenTasksByPhase(phase)
    res.render('phase-open-tasks', { phase, label, rows })
  } catch (e) {
    console.error('[GET /phase/:phase/open-tasks] error:', e)
    res.status(500).send('Could not load open tasks. Please retry.')
  }
})


router.get('/settings', async (req, res) => {
  try {
    const user = req.session?.user || {}
    const users = await listUsers()
    res.render('org-settings', { user, users, error: null })
  } catch (e) {
    console.error('[GET /settings] error:', e)
    res.status(500).send('Could not load settings.')
  }
})

router.post('/settings/users', async (req, res) => {
  try {
    const actor = req.session?.user?.email || 'user'
    const role = String(req.session?.user?.role || 'admin').toLowerCase()
    if (role !== 'admin') return res.status(403).send('Admin required')

    const { email, password, role: newRole } = req.body || {}
    await createUser({ email, password, role: newRole }, actor)
    res.redirect('/settings')
  } catch (e) {
    const user = req.session?.user || {}
    const users = await listUsers().catch(() => [])
    const msg = e?.message || 'Could not create user'
    res.status(400).render('org-settings', { user, users, error: msg })
  }
})


router.post('/settings/users/:id/reset-password', async (req, res) => {
  try {
    const actor = req.session?.user?.email || 'user'
    const role = String(req.session?.user?.role || 'admin').toLowerCase()
    if (role !== 'admin') return res.status(403).send('Admin required')

    const userId = Number(req.params.id)
    const password = String(req.body.password || '')
    await resetUserPassword(userId, password, actor)
    res.redirect('/settings')
  } catch (e) {
    console.error('[POST /settings/users/:id/reset-password] error:', e)
    res.status(400).redirect('/settings')
  }
})

export default router