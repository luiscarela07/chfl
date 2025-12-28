import { Router } from 'express'
import { getDashboardData, phaseNamesByStatus } from '../models.js'

const router = Router()

router.get('/', async (_req, res) => {
  try {
    const { org } = await getDashboardData()

    // Use canonical labels (mix of pre/lit): P1, P2 common; P3=Discovery (lit), P4=Trial (lit), P5=Demand.
    const litNames = phaseNamesByStatus('litigation')
    const rings = [
      { phase: 0, label: 'Total Cases', open: org.totalCases, total: org.totalCases, href: null },
      { phase: 1, label: `${litNames[1]} — Open Tasks`, open: org.openTasksByPhase[1] || 0, total: org.totalTasksByPhase[1] || 0, href: '/cases?phaseOpen=1' },
      { phase: 2, label: `${litNames[2]} — Open Tasks`, open: org.openTasksByPhase[2] || 0, total: org.totalTasksByPhase[2] || 0, href: '/cases?phaseOpen=2' },
      { phase: 3, label: `${litNames[3]} — Open Tasks`, open: org.openTasksByPhase[3] || 0, total: org.totalTasksByPhase[3] || 0, href: '/cases?phaseOpen=3' },
      { phase: 4, label: `${litNames[4]} — Open Tasks`, open: org.openTasksByPhase[4] || 0, total: org.totalTasksByPhase[4] || 0, href: '/cases?phaseOpen=4' },
      { phase: 5, label: `${litNames[5]} — Open Tasks`, open: org.openTasksByPhase[5] || 0, total: org.totalTasksByPhase[5] || 0, href: '/cases?phaseOpen=5' }
    ]
    res.render('dashboard', { org, rings })
  } catch (e) {
    console.error('[GET /] dashboard error:', e)
    res.status(500).send('Dashboard failed. Please retry.')
  }
})

export default router