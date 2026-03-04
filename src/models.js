// FILE: src/models.js  unified, de-duplicated, full functionality (Node 18+ ESM)

/* ========================= Imports ========================= */
import bcrypt from 'bcryptjs'
import config from './config.js'
import { createJsonDb } from './db.js'

/* ========================= DB ========================= */
export const db = createJsonDb(config.dbPath)

/* ========================= Core helpers ========================= */
function ensureCaseShape(c) {
  if (!c) return c
  if (!c.firstName || !c.lastName) {
    const raw = String(c.clientName || c.title || '').trim()
    const parts = raw.split(/\s+/).filter(Boolean)
    if (!c.firstName) c.firstName = parts[0] || ''
    if (!c.lastName) c.lastName = parts.slice(1).join(' ')
  }
  c.clientName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.clientName || c.title || 'Unnamed Client'
  c.title = c.clientName
  if (!c.phases) c.phases = { 1:false, 2:false, 3:false, 4:false, 5:false }
  if (!c.phaseTasks) c.phaseTasks = { 1:[], 2:[], 3:[], 4:[], 5:[] }
  for (let p = 1; p <= 5; p++) if (!Array.isArray(c.phaseTasks[p])) c.phaseTasks[p] = []
  return c
}

function normalizeClientNameParts(payload = {}, existing = {}) {
  const incomingFirst = payload.firstName !== undefined ? String(payload.firstName || '').trim() : undefined
  const incomingLast = payload.lastName !== undefined ? String(payload.lastName || '').trim() : undefined
  const incomingFull = payload.clientName !== undefined
    ? String(payload.clientName || '').trim()
    : (payload.title !== undefined ? String(payload.title || '').trim() : '')

  let firstName = incomingFirst !== undefined ? incomingFirst : String(existing.firstName || '').trim()
  let lastName = incomingLast !== undefined ? incomingLast : String(existing.lastName || '').trim()

  if ((!firstName && !lastName) && incomingFull) {
    const parts = incomingFull.split(/\s+/).filter(Boolean)
    firstName = parts[0] || ''
    lastName = parts.slice(1).join(' ')
  }

  if (!firstName) firstName = 'Unnamed'
  const clientName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Unnamed Client'
  return { firstName, lastName, clientName }
}

function recordAuditUnsafe(data, entry) {
  data.audit ||= []
  data.audit.push({
    id: (data.audit.reduce((m, a) => Math.max(m, a.id || 0), 0) || 0) + 1,
    when: new Date().toISOString(),
    ...entry
  })
}

function ensurePhaseTasks(c) {
  c.phaseTasks ||= { 1: [], 2: [], 3: [], 4: [], 5: [] }
  for (const k of [1,2,3,4,5]) if (!Array.isArray(c.phaseTasks[k])) c.phaseTasks[k] = []
  c.phases ||= { 1:false, 2:false, 3:false, 4:false, 5:false }
  for (const k of [1,2,3,4,5]) c.phases[k] = !!c.phases[k]
}

function deepCopyChildren(children) {
  if (!Array.isArray(children)) return undefined
  const now = new Date().toISOString()
  return children.map(st => ({
    id: st.id, title: st.title, done: !!st.done,
    createdAt: st.createdAt || now, updatedAt: now, deleted_at: st.deleted_at || null
  }))
}

function nextTaskId(arr) { return (arr.reduce((m, t) => Math.max(m, t.id || 0), 0) || 0) + 1 }
function nextSubId(task) {
  const kids = task.children || []
  return (kids.reduce((m, t) => Math.max(m, t.id || 0), 0) || 0) + 1
}

/* ========================= Phase names ========================= */
export function phaseNamesByStatus(status = 'pre') {
  const s = String(status || 'pre').toLowerCase()
  if (s === 'litigation') {
    return {
      1: 'Start Case',
      2: 'Manage Medical & Investigation',
      3: 'File Suit & Discovery',
      4: 'Trial',
      5: 'Demand & Settlement'
    }
  }
  return {
    1: 'Start Case',
    2: 'Manage Medical & Investigation',
    3: 'Demand & Settlement',
    4: '',
    5: ''
  }
}
export function phaseNamesForCase(c) { return phaseNamesByStatus(c?.litigationStatus || 'pre') }
export function phaseName(status, p) { return phaseNamesByStatus(status)?.[p] || `Phase ${p}` }

/* ========================= Templates ========================= */
const P1_TEMPLATE_LOP_TITLE = 'Send LOP to medical provider for Client'
const P1_TEMPLATE_KEY_LOP = 'P1_LOP'

const INCIDENT_TITLE = 'Receipt of accident/incident reports'
function titleMatchesIncident(raw) {
  const s = String(raw || '').trim().toLowerCase()
  const base = INCIDENT_TITLE.toLowerCase()
  return s === base || s === `${base}?`
}
const P1_INCIDENT_CHILDREN = [
  'If applicable, police report requested and obtained',
  'If applicable, animal control report requested and obtained',
  'If applicable, work incident report requested and obtained',
  'If applicable, store incident report requested and obtained'
]

const PHASE1_TEMPLATES = [
  'Client signed POA',
  'Send to client CP intake',
  'Client HIPAA',
  "Obtain from client - driver's license, relevant pics and docs",
  'If MVA - PIP and UIM confirmed, and notice letter sent',
  'Calendar 4-year SOL on UIM',
  'Obtain police report',
  'Welcome Letter sent',
  'Calendar SOL & 1yr/6mo warnings',
  'Calendar 1, 2, 3 and 4 week TC with client',
  'Send LOP to medical provider for Client',
  'Send LOR to at-fault party or insurance co.',
  'Health insurance - send notice letter',
  'CP data tabs - client, defs, incident, injuries, treatment, health insurance',
  'Confirm case file completeness'
]

const P2 = {
  tasks: [
    {
      title: 'Manage medical treatment', children: [
        'Chiro (name of provider) LOP',
        'MRI (name of provider) LOP',
        'Diagnostic Testing (name of provider) LOP',
        'Pain management (name of provider) LOP',
        'Orthopedic (name of provider) LOP',
        'Psychologist (name of provider) LOP'
      ]
    },
    { title: 'Is client treating on their own?', children: [ 'Confirm Name of healthcare providers (add here)' ] },
    { title: 'Insurance Co provided an acknowledgement of the claim' },
    { title: 'If applicable, health insurance subrogation amount received' },
    { title: 'If applicable, CMS or Medicaid subrogation amount received' },
    { title: 'If applicable, documents supporting a lost wage claim received?' },
    { title: 'If applicable, send PIP demand to clients auto carrier' }
  ]
}

const P3_TEMPLATES = [
  'Order records and bills from medical providers',
  'Prepare demand letter',
  'Send Demand letter',
  'Offer received?',
  'Counter(s) sent?',
  'Case settled',
  'Send to insurance co draft instructions, w-9 and request for release agreement',
  'Release agreement received from ins co?',
  'Release sent to Client for signature?',
  'Release signed?',
  'If notary is necessary, release notarized?',
  'Forward release to insurance carrier',
  'Reductions prepared and sent to all the providers identified in phase 1 and 2',
  'Approved reductions received from all Providers (from phase 1 and 2)',
  'If applicable, health insurance reduction request sent?',
  'If applicable, approved reduction from health insurance received?',
  'Confirm case costs in file and CP',
  'Prepare Settlement Disbursement Statement',
  'Forward Settlement Disbursement Statement to client for signature',
  'Receipt of signed Settlement Disbursement Statement from client?',
  'Settlement check received?',
  'Settlement check deposited?',
  'Prepare forward payment letters to everyone in #14, 16 and scan to file',
  'Prepare letter to client to forward settlement check and scan to file'
]

/* ========================= Phase 3 Litigation Template ========================= */
const P3_LIT = {
  tasks: [
    {
      title: 'Initiate Lawsuit to Defendant(s) Original Answer',
      children: [
        'Identify Defendant(s), registered agent and address for service',
        'Prepare Original Petition and Request for Citation for Each Defendant',
        'Look at County website  save local rules to file',
        'File Original Petition and Request for Citation',
        'Save receipt to expenses folder and CP costs',
        'Received citations from court',
        'Forward Original Petition and citations to process server',
        'Calendar follow up - 2 weeks, 3 weeks, 1 month, 3 months',
        'Received Return of Citation from the Process Server  save to file',
        'Calendar Defendants Deadline to File Original Answer',
        'Received Defendant(s) Original Answer'
      ]
    },
    {
      title: 'Calendaring',
      children: [
        '90 days from Original Answer  Deadline to file Notice of Filings',
        'Calendar 30 days  Deadline to serve Initial Disclosures',
        {
          title: 'Trial date and docket control order received?',
          children: [
            'If yes, calendar all deadlines',
            'If no, draft Motion for Trial Setting and Entry of Docket Control Order',
            'Confirm DCO calendared'
          ]
        }
      ]
    },
    {
      title: 'Plaintiffs Discovery',
      children: [
        'Draft and serve Plaintiffs Initial Disclosures',
        'Create table of Plaintiffs Discovery Responses',
        'Draft and serve Plaintiffs Interrogatories to Defendant',
        'Draft and serve Plaintiffs Request for Production to Defendant',
        'Draft and serve Plaintiffs Request for Admissions to Defendant',
        'Draft and send letter to request deposition dates',
        'Prepare Notice of Deposition',
        'Calendar depo',
        'Send NOD to court reporter',
        'If videographer  send notice'
      ]
    },
    {
      title: 'Defendants Discovery',
      children: [
        'Receipt of Defendants Initial Disclosures - date',
        'Create table of Defendant(s) Discovery Responses',
        'Def served Interrogatories? Calendar 30 day deadline',
        'Def served Request for Production? Calendar 30 day deadline',
        'Def served Plaintiffs Request for Admissions? Calendar 30 day deadline',
        'Def served Notice of Deposition for Plaintiff?'
      ]
    },
    {
      title: 'Experts',
      children: [
        {
          title: 'Plaintiffs Expert deadline',
          children: [
            'Send file materials to expert',
            'Report received?'
          ]
        },
        'Defendants Expert deadline'
      ]
    }
  ]
}



const P4_TRIAL = {
  tasks: [
    { title: 'Calendar trial date' },
    { title: 'Advise client in writing of trial date' },
    { title: 'Calendar docket call and pre-trial dates' },
    { title: 'Calendar 60-day warning' },
    {
      title: '40-day pre-trial task group',
      children: [
        'Supplement discovery responses',
        'Disclosures',
        'Request for Production (RFP)',
        'Interrogatories (Roggs)',
        'Requests for Admission (RFA)'
      ]
    },
    {
      title: '30-day pre-trial task group (or date defined in the DCO)',
      children: [
        'File Pre-Trial Order',
        'Witness List',
        'Exhibit List',
        'Jury Charge',
        'Motions in Limine (MIL)',
        'Deposition Excerpts'
      ]
    },
    { title: 'Prepare Witness Subpoenas (as needed)' },
    {
      title: 'Prepare Trial Notebook',
      children: [
        'Plaintiff’s PTO',
        'Defendant’s PTO',
        'Deposition transcripts',
        'Direct examinations',
        'Cross examinations'
      ]
    },
    { title: 'Organize and mark Exhibits' }
  ]
}
function seedPhase3LitDefaults_mutate(data, c, actor = 'migration:seedPhase3LitDefaults') {
  ensurePhaseTasks(c)
  c.phaseTasks[3] ||= []
  if (c.phaseTasks[3].length > 0) return

  const now = new Date().toISOString()
  let tid = 0
  const tasks = Array.isArray(phase3LitTemplate()) ? phase3LitTemplate() : []

  for (const t of tasks) {
    tid += 1
    const taskObj = {
      id: tid,
      title: String(t.title || '').trim() || `Task ${tid}`,
      done: false,
      createdAt: now,
      updatedAt: now
    }

    const subs = Array.isArray(t.subtasks) ? t.subtasks : []
    if (subs.length) {
      taskObj.children = subs.map((st, i) => {
        const sub = {
          id: i + 1,
          title: String(st.title || '').trim() || `Subtask ${i + 1}`,
          done: false,
          createdAt: now,
          updatedAt: now
        }
        const grands = Array.isArray(st.grandchildren) ? st.grandchildren : []
        if (grands.length) {
          sub.children = grands
            .map(g => String(g || '').trim())
            .filter(Boolean)
            .map((g, j) => ({
              id: j + 1,
              title: g,
              done: false,
              createdAt: now,
              updatedAt: now
            }))
        }
        return sub
      })
    }

    c.phaseTasks[3].push(taskObj)
  }

  recalcPhasesFromTasks(c)
  recordAuditUnsafe?.(data, { type: 'phase3.lit.seed', caseId: c.id, actor, meta: { tasks: c.phaseTasks[3].length } })
}

/* ========================= Seeding / Sync ========================= */
function injectPhase1IfEmpty(c) {
  ensurePhaseTasks(c)
  if (c.phaseTasks[1].length === 0) {
    let id = 1
    const now = new Date().toISOString()
    c.phaseTasks[1] = PHASE1_TEMPLATES.map(title => {
      const t = { id: id++, title, done: false, createdAt: now, updatedAt: now }
      if (title === P1_TEMPLATE_LOP_TITLE) t.templateKey = P1_TEMPLATE_KEY_LOP
      return t
    })
    const inc = {
      id: id++, title: INCIDENT_TITLE, done: false, createdAt: now, updatedAt: now,
      children: P1_INCIDENT_CHILDREN.map((title, i) => ({ id: i + 1, title, done: false, createdAt: now, updatedAt: now }))
    }
    c.phaseTasks[1].push(inc)
  } else {
    const lop = c.phaseTasks[1].find(t => (t.templateKey === P1_TEMPLATE_KEY_LOP) || t.title === P1_TEMPLATE_LOP_TITLE)
    if (lop && !lop.templateKey) lop.templateKey = P1_TEMPLATE_KEY_LOP
    const hasInc = (c.phaseTasks[1] || []).some(t => titleMatchesIncident(t.title))
    if (!hasInc) {
      const now = new Date().toISOString()
      const nid = (c.phaseTasks[1].reduce((m, t) => Math.max(m, t.id || 0), 0) || 0) + 1
      c.phaseTasks[1].push({
        id: nid, title: INCIDENT_TITLE, done: false, createdAt: now, updatedAt: now,
        children: P1_INCIDENT_CHILDREN.map((title, i) => ({ id: i + 1, title, done: false, createdAt: now, updatedAt: now }))
      })
    }
  }
}
function seedPhase2IfEmpty(c) {
  const now = new Date().toISOString()
  if ((c.phaseTasks[2] || []).length === 0) {
    let nid = 1
    c.phaseTasks[2] = P2.tasks.map(group => {
      const t = { id: nid++, title: group.title, done: false, createdAt: now, updatedAt: now }
      if (Array.isArray(group.children) && group.children.length) {
        t.children = group.children.map((name, i) => ({ id: i + 1, title: name, done: false, createdAt: now, updatedAt: now }))
      }
      return t
    })
  }
}
function seedPhase3Defaults(c, data) {
  ensurePhaseTasks(c)
  c.phaseTasks[3] ||= []
  const now = new Date().toISOString()
  const existingTitles = new Set(c.phaseTasks[3].map(t => String(t.title || '').trim().toLowerCase()))
  for (const title of P3_TEMPLATES) {
    const key = title.trim().toLowerCase()
    if (!existingTitles.has(key)) {
      const id = (c.phaseTasks[3].reduce((m, t) => Math.max(m, t.id || 0), 0) || 0) + 1
      c.phaseTasks[3].push({ id, title, done: false, createdAt: now, updatedAt: now })
      existingTitles.add(key)
      if (data) recordAuditUnsafe(data, { type: 'phase3.seed', caseId: c.id, clientName: c.clientName, phase: 3, taskId: id, title, actor: 'migration:p007' })
    }
  }
}

function seedPhase4TrialIfNeeded(c, data, actor = 'system') {
  ensurePhaseTasks(c)
  c.flags ||= {}
  const isLitigation = String(c.litigationStatus || '').toLowerCase() === 'litigation'
  if (!isLitigation || c.flags.phase4TrialSeeded) return

  c.phaseTasks[4] ||= []
  if (c.phaseTasks[4].length > 0) {
    c.flags.phase4TrialSeeded = true
    return
  }

  const now = new Date().toISOString()
  let tid = 0
  for (const group of P4_TRIAL.tasks) {
    tid += 1
    const task = {
      id: tid,
      title: String(group.title || '').trim() || `Task ${tid}`,
      done: false,
      createdAt: now,
      updatedAt: now
    }
    if (Array.isArray(group.children) && group.children.length > 0) {
      task.children = group.children.map((child, i) => ({
        id: i + 1,
        title: String(child || '').trim() || `Subtask ${i + 1}`,
        done: false,
        createdAt: now,
        updatedAt: now
      }))
    }
    c.phaseTasks[4].push(task)
  }

  c.flags.phase4TrialSeeded = true
  recordAuditUnsafe?.(data, { type: 'phase4.trial.seed', caseId: c.id, actor, meta: { tasks: c.phaseTasks[4].length } })
}

/* ========================= Demand (P1 LOP sync) ========================= */
function findP1LopTask(c) {
  ensurePhaseTasks(c)
  return (c.phaseTasks[1] || []).find(t => t.templateKey === P1_TEMPLATE_KEY_LOP) ||
         (c.phaseTasks[1] || []).find(t => (t.title || '').trim().toLowerCase() === P1_TEMPLATE_LOP_TITLE.toLowerCase()) || null
}
function findLinkedDestFromP1(c, destPhase, p1TaskId) {
  ensurePhaseTasks(c)
  return (c.phaseTasks[destPhase] || []).find(t => t.sourceRef && t.sourceRef.phase === 1 && t.sourceRef.taskId === p1TaskId) || null
}
function syncP1LopToDemand_mutate(data, c) {
  const destPhase = (String(c.litigationStatus || 'pre').toLowerCase() === 'litigation') ? 5 : 3
  const p1 = findP1LopTask(c); if (!p1) return
  ensurePhaseTasks(c); c.phaseTasks[destPhase] ||= []
  let dest = findLinkedDestFromP1(c, destPhase, p1.id)
  const now = new Date().toISOString()
  if (!dest) {
    dest = {
      id: nextTaskId(c.phaseTasks[destPhase]),
      title: p1.title, done: !!p1.done, createdAt: now, updatedAt: now,
      sourceRef: { phase: 1, taskId: p1.id, key: P1_TEMPLATE_KEY_LOP }
    }
    if (Array.isArray(p1.children) && p1.children.length) dest.children = deepCopyChildren(p1.children)
    c.phaseTasks[destPhase].push(dest)
    recordAuditUnsafe(data, { type: 'task.copy.p1toDemand', caseId: c.id, clientName: c.clientName, srcTaskId: p1.id, dstTaskId: dest.id, dstPhase: destPhase, actor: 'sync' })
  } else {
    dest.title = p1.title
    dest.done = !!p1.done
    if (Array.isArray(p1.children)) {
      if (!Array.isArray(dest.children)) dest.children = []
      const byId = new Map(dest.children.map(st => [st.id, st]))
      for (const st of p1.children) {
        const hit = byId.get(st.id)
        if (hit) { hit.title = st.title; hit.done = !!st.done; hit.updatedAt = now }
        else { dest.children.push({ id: st.id, title: st.title, done: !!st.done, createdAt: now, updatedAt: now }) }
      }
    } else {
      dest.children = undefined
    }
    dest.updatedAt = now
    dest.sourceRef = { phase: 1, taskId: p1.id, key: P1_TEMPLATE_KEY_LOP }
    recordAuditUnsafe(data, { type: 'task.sync.p1toDemand', caseId: c.id, clientName: c.clientName, srcTaskId: p1.id, dstTaskId: dest.id, dstPhase: destPhase, actor: 'sync' })
  }
  recalcPhasesFromTasks(c)
}
/* ========================= Phases recompute ========================= */
function recalcPhasesFromTasks(c) {
  c.phases ||= { 1:false, 2:false, 3:false, 4:false, 5:false }
  for (const k of [1,2,3,4,5]) {
    const arr = (c.phaseTasks[k] || []).filter(t => !t.deleted_at)
    const allDone = arr.length > 0 && arr.every(t => {
      const kids = Array.isArray(t.children) ? t.children.filter(st => !st.deleted_at) : []
      const kidsDone = kids.length === 0 || kids.every(st => !!st.done)
      return !!t.done && kidsDone
    })
    c.phases[k] = allDone
  }
}
function recalcPhases(c) { return recalcPhasesFromTasks(c) }
/* ========================= Migrations ========================= */
export async function migrateAndSeed() {
  await db.tx(async (data) => {
    try {
      data.meta ||= { migrations: [] }
      data.users ||= []; data.cases ||= []; data.audit ||= []
      if (!data.meta.migrations.includes('m001_base')) {
        if (!data.users.find(u => u.email === config.adminEmail)) {
          const hash = bcrypt.hashSync(config.adminPassword, 10)
          data.users.push({ id: 1, email: config.adminEmail, password_hash: hash, role: 'admin', created_at: new Date().toISOString() })
        }
        if (data.cases.length === 0) {
          const now = new Date().toISOString()
          data.cases.push({ id: 1, title: 'Sample', clientName: 'Jane Doe', status: 'Open', phase: 1, litigationStatus: 'pre',
            phases: {1:false,2:false,3:false,4:false,5:false}, phaseTasks: {1:[],2:[],3:[],4:[],5:[]}, openedAt: now, dueDate: null, description: '', notes: [], tasks: [] })
        }
        data.meta.migrations.push('m001_base')
        if (!data.meta.migrations.includes('m002_user_roles')) {
          for (const u of data.users) {
            if (!u.role) u.role = 'admin'
            u.role = String(u.role).toLowerCase() === 'view' ? 'view' : (String(u.role).toLowerCase() === 'view_only' ? 'view' : (String(u.role).toLowerCase() === 'readonly' ? 'view' : (String(u.role).toLowerCase() === 'viewer' ? 'view' : (String(u.role).toLowerCase() === 'view-only' ? 'view' : (String(u.role).toLowerCase() === 'admin' ? 'admin' : 'admin')))))
          }
          data.meta.migrations.push('m002_user_roles')
        }

      }
      if (!data.meta.migrations.includes('p003_add_phases_flags')) {
        for (const c of data.cases) {
          c.phases ||= {1:false,2:false,3:false,4:false}
          c.phases = {1:!!c.phases[1],2:!!c.phases[2],3:!!c.phases[3],4:!!c.phases[4],5:!!(c.phases[5]||false)}
        }
        data.meta.migrations.push('p003_add_phases_flags')
      }
      if (!data.meta.migrations.includes('p004_phase_tasks+timestamps')) {
        for (const c of data.cases) {
          ensurePhaseTasks(c); injectPhase1IfEmpty(c); seedPhase2IfEmpty(c); seedPhase4TrialIfNeeded(c, data, 'migration:p004')
          for (const p of [1,2,3,4,5]) {
            c.phaseTasks[p] = (c.phaseTasks[p] || []).map(t => ({
              ...t, createdAt: t.createdAt || new Date().toISOString(), updatedAt: t.updatedAt || new Date().toISOString()
            }))
          }
          recalcPhasesFromTasks(c)
        }
        data.meta.migrations.push('p004_phase_tasks+timestamps')
      }
      if (!data.meta.migrations.includes('p005_phase2_templates')) {
        for (const c of data.cases) { ensurePhaseTasks(c); seedPhase2IfEmpty(c); recalcPhasesFromTasks(c); recordAuditUnsafe(data, { type:'phase2.seed', caseId: c.id, clientName: c.clientName, actor: 'migration:p005' }) }
        data.meta.migrations.push('p005_phase2_templates')
      }
      if (!data.meta.migrations.includes('p006_sync_p1_lop_to_p3')) {
        for (const c of data.cases) { ensurePhaseTasks(c); injectPhase1IfEmpty(c); syncP1LopToDemand_mutate(data, c) }
        data.meta.migrations.push('p006_sync_p1_lop_to_p3')
      }
      if (!data.meta.migrations.includes('p007_phase3_templates')) {
        for (const c of data.cases) { ensurePhaseTasks(c); syncP1LopToDemand_mutate(data, c); seedPhase3Defaults(c, data); seedPhase4TrialIfNeeded(c, data, 'migration:p007'); recalcPhasesFromTasks(c) }
        data.meta.migrations.push('p007_phase3_templates')
      }

      if (!data.meta.migrations.includes('p008_phase4_trial_templates')) {
        for (const c of data.cases) {
          ensurePhaseTasks(c)
          seedPhase4TrialIfNeeded(c, data, 'migration:p008')
          recalcPhasesFromTasks(c)
        }
        data.meta.migrations.push('p008_phase4_trial_templates')
      }
      if (!data.meta.migrations.includes('p008_litigation_status+phase5')) {
        for (const c of data.cases) { ensurePhaseTasks(c); c.litigationStatus = ['pre','litigation'].includes(c.litigationStatus) ? c.litigationStatus : 'pre' }
        data.meta.migrations.push('p008_litigation_status+phase5')
      }
      if (!data.meta.migrations.includes('p009_phase_renames_move_p3_to_p5')) {
        for (const c of data.cases) {
          ensurePhaseTasks(c)
          if (String(c.litigationStatus || 'pre').toLowerCase() === 'litigation') {
            if ((c.phaseTasks[3] || []).length > 0) {
              c.phaseTasks[5] ||= []
              const startId = c.phaseTasks[5].reduce((m, t) => Math.max(m, t.id || 0), 0)
              let n = 0
              for (const t of c.phaseTasks[3]) { n++; c.phaseTasks[5].push({ ...t, id: startId + n, updatedAt: new Date().toISOString() }) }
              c.phaseTasks[3] = []
              recordAuditUnsafe(data, { type: 'phase.move.p3_to_p5', caseId: c.id, clientName: c.clientName, moved: n, actor: 'migration:p009' })
            }
          }
          recalcPhasesFromTasks(c)
        }
        data.meta.migrations.push('p009_phase_renames_move_p3_to_p5')
      }
      if (!data.meta.migrations.includes('p010_move_incident_reports_to_phase1')) {
        for (const c of data.cases) {
          ensurePhaseTasks(c); injectPhase1IfEmpty(c)
          const p2 = c.phaseTasks[2] || []
          const toMoveIdx = []; for (let i=0;i<p2.length;i++) if (titleMatchesIncident(p2[i]?.title)) toMoveIdx.push(i)
          if (toMoveIdx.length) {
            c.phaseTasks[1] ||= []
            for (let k=0;k<toMoveIdx.length;k++) {
              const idx = toMoveIdx[k] - k
              const [src] = p2.splice(idx,1)
              const dstExisting = (c.phaseTasks[1] || []).find(t => titleMatchesIncident(t.title))
              if (!dstExisting) {
                c.phaseTasks[1].push(src)
                recordAuditUnsafe(data, { type:'task.movePhase', caseId: c.id, from: 2, to: 1, taskId: src.id, title: src.title, actor: 'migration:p010' })
              } else {
                const now = new Date().toISOString()
                dstExisting.done = dstExisting.done || !!src.done
                const byKey = new Map((dstExisting.children || []).map(st => [String(st.title).toLowerCase(), st]))
                for (const st of (src.children || [])) {
                  const key = String(st.title || '').toLowerCase()
                  const hit = byKey.get(key)
                  if (hit) { hit.done = hit.done || !!st.done; hit.updatedAt = now }
                  else {
                    const nid = nextSubId(dstExisting)
                    ;(dstExisting.children ||= []).push({ id: nid, title: st.title, done: !!st.done, createdAt: st.createdAt || now, updatedAt: now })
                  }
                }
                dstExisting.updatedAt = now
                recordAuditUnsafe(data, { type:'task.mergePhaseMove', caseId: c.id, from: 2, to: 1, mergedFromTaskId: src.id, intoTaskId: dstExisting.id, title: dstExisting.title, actor: 'migration:p010' })
              }
            }
            recalcPhasesFromTasks(c)
          }
        }
        data.meta.migrations.push('p010_move_incident_reports_to_phase1')
      }
    } catch (e) {
      console.error('[migrateAndSeed] failed:', e)
      throw e
    }
  })
}

/* ========================= Metrics ========================= */
function countPhaseTotals(caseObj, phase) {
  const arr = (caseObj.phaseTasks?.[phase]) || []
  let total = 0, open = 0
  for (const t of arr) {
    total += 1; if (!t.done) open += 1
    if (Array.isArray(t.children) && t.children.length) {
      total += t.children.length
      open += t.children.filter(st => !st.done).length
    }
  }
  return { total, open }
}
export async function getDashboardData() {
  const data = await db.load()
  for (const c of data.cases) { ensureCaseShape(c); ensurePhaseTasks(c); c.litigationStatus ||= 'pre' }
  const totalCases = data.cases.length
  const openTasksByPhase = { 1:0, 2:0, 3:0, 4:0, 5:0 }
  const totalTasksByPhase = { 1:0, 2:0, 3:0, 4:0, 5:0 }
  for (const c of data.cases) {
    for (const p of [1,2,3,4]) {
      const { total, open } = countPhaseTotals(c, p)
      totalTasksByPhase[p] += total; openTasksByPhase[p] += open
    }
    if ((c.litigationStatus || 'pre') === 'litigation') {
      const { total, open } = countPhaseTotals(c, 5)
      totalTasksByPhase[5] += total; openTasksByPhase[5] += open
    }
  }
  return { org: { totalCases, openTasksByPhase, totalTasksByPhase } }
}

export async function getOpenTasksByPhase(phase) {
  const p = Number(phase)
  if (![1,2,3,4,5].includes(p)) return []

  const data = await db.load()
  const out = []

  for (const c of (Array.isArray(data.cases) ? data.cases : [])) {
    ensureCaseShape(c)
    ensurePhaseTasks(c)
    c.litigationStatus ||= 'pre'

    const tasks = Array.isArray(c.phaseTasks?.[p]) ? c.phaseTasks[p] : []
    const openTasks = []

    for (const t of tasks) {
      if (t?.deleted_at) continue
      const openSubs = []
      for (const st of (Array.isArray(t?.children) ? t.children : [])) {
        if (st?.deleted_at) continue
        const openGrands = []
        for (const gc of (Array.isArray(st?.children) ? st.children : [])) {
          if (gc?.deleted_at) continue
          if (!gc?.done) openGrands.push({ id: gc.id, title: gc.title })
        }
        if (!st?.done || openGrands.length) {
          openSubs.push({ id: st.id, title: st.title, done: !!st.done, grandchildren: openGrands })
        }
      }

      if (!t?.done || openSubs.length) {
        openTasks.push({ id: t.id, title: t.title, done: !!t.done, subtasks: openSubs })
      }
    }

    if (openTasks.length) {
      out.push({
        caseId: c.id,
        firstName: c.firstName || '',
        lastName: c.lastName || '',
        clientName: c.clientName || c.title || `Case ${c.id}`,
        litigationStatus: c.litigationStatus,
        openTasks
      })
    }
  }

  out.sort((a, b) => String(a.clientName).localeCompare(String(b.clientName)))
  return out
}

/* ========================= Auth ========================= */

export async function listUsers() {
  const data = await db.load()
  const users = Array.isArray(data.users) ? data.users : []
  return users
    .map(u => ({ id: u.id, email: u.email, role: u.role || 'admin', created_at: u.created_at }))
    .sort((a, b) => String(a.email).localeCompare(String(b.email)))
}

export async function createUser({ email, password, role }, actor = 'system') {
  const cleanEmail = String(email || '').trim().toLowerCase()
  const cleanRole = String(role || 'view').toLowerCase() === 'admin' ? 'admin' : 'view'
  const pw = String(password || '')
  if (!cleanEmail || !cleanEmail.includes('@')) throw new Error('invalid_email')
  if (pw.length < 8) throw new Error('password_too_short')

  return db.tx(async (data) => {
    data.users ||= []
    if (data.users.find(u => String(u.email).toLowerCase() === cleanEmail)) throw new Error('email_exists')
    const id = (data.users.reduce((m, u) => Math.max(m, u.id || 0), 0) || 0) + 1
    const hash = bcrypt.hashSync(pw, 10)
    const now = new Date().toISOString()
    const user = { id, email: cleanEmail, password_hash: hash, role: cleanRole, created_at: now }
    data.users.push(user)
    recordAuditUnsafe?.(data, { type: 'user.create', actor, meta: { id, email: cleanEmail, role: cleanRole } })
    return { id, email: cleanEmail, role: cleanRole, created_at: now }
  })
}


export async function resetUserPassword(userId, newPassword, actor = 'system') {
  const id = Number(userId)
  const pw = String(newPassword || '')
  if (!Number.isFinite(id) || id <= 0) throw new Error('invalid_user')
  if (pw.length < 8) throw new Error('password_too_short')

  return db.tx(async (data) => {
    data.users ||= []
    const u = data.users.find(x => Number(x.id) === id)
    if (!u) throw new Error('user_not_found')
    u.password_hash = bcrypt.hashSync(pw, 10)
    const now = new Date().toISOString()
    u.updated_at = now
    recordAuditUnsafe?.(data, { type: 'user.password_reset', actor, meta: { id: u.id, email: u.email } })
    return { ok: true, id: u.id, email: u.email }
  })
}

export async function findUserByEmail(email) {
  const data = await db.load()
  return data.users.find(u => u.email === (email || '').toLowerCase()) || null
}

/* ========================= Case CRUD ========================= */
export async function listCases(q = '') {
  const data = await db.load()
  const needle = String(q || '').toLowerCase()
  return data.cases
    .filter(c => {
      ensureCaseShape(c)
      return !needle || String(c.clientName || '').toLowerCase().includes(needle)
    })
    .sort((a,b) => b.id - a.id)


}
export async function getCase(id) {
  return db.tx(async (data) => {
    const c = data.cases.find(x => x.id === id) || null
    if (!c) return null

    ensureCaseShape(c)
    ensurePhaseTasks(c)
    c.litigationStatus ||= 'pre'

    if (String(c.litigationStatus).toLowerCase() === 'litigation') {
      seedPhase3LitDefaults_mutate(data, c)
    }
    seedPhase4TrialIfNeeded(c, data, 'case.get')

    recalcPhasesFromTasks(c)
    return c
  })
}
export async function createCase(payload) {
  return db.tx(async (data) => {
    const id = (data.cases.reduce((m, c) => Math.max(m, c.id), 0) || 0) + 1
    const { firstName, lastName, clientName } = normalizeClientNameParts(payload)
    const now = new Date().toISOString()
    const c = {
      id, title: clientName, clientName, firstName, lastName,
      dateOfIncident: payload.dateOfIncident || null,
      typeOfCase: payload.typeOfCase || null,
      status: payload.status || 'Open',
      litigationStatus: ['pre','litigation'].includes(String(payload.litigationStatus || '').toLowerCase()) ? String(payload.litigationStatus).toLowerCase() : 'pre',
      phase: [1,2,3,4,5].includes(Number(payload.phase)) ? Number(payload.phase) : 1,
      phases: {1:false,2:false,3:false,4:false,5:false},
      phaseTasks: {1:[],2:[],3:[],4:[],5:[]},
      openedAt: now, dueDate: payload.dueDate || null,
      description: payload.description || '', notes: [], tasks: []
    }
    injectPhase1IfEmpty(c); seedPhase2IfEmpty(c); seedPhase3Defaults(c, data)
    seedPhase4TrialIfNeeded(c, data, payload._actor || 'system')
    syncP1LopToDemand_mutate(data, c)
    recalcPhasesFromTasks(c)
    data.cases.push(c)
    recordAuditUnsafe(data, { type:'case.create', caseId: id, clientName, actor: payload._actor || 'system' })
    return c
  })
}
export async function updateCase(id, payload) {
  return db.tx(async (data) => {
    const c = data.cases.find(x => Number(x.id) === Number(id))
    if (!c) return null
    ensureCaseShape(c)
    const before = {
      clientName: c.clientName,
      firstName: c.firstName,
      lastName: c.lastName,
      phase: c.phase,
      dueDate: c.dueDate,
      description: c.description,
      litigationStatus: c.litigationStatus,
      dateOfIncident: c.dateOfIncident,
      typeOfCase: c.typeOfCase
    }
    if (payload.firstName !== undefined || payload.lastName !== undefined || payload.clientName !== undefined) {
      const next = normalizeClientNameParts(payload, c)
      c.firstName = next.firstName
      c.lastName = next.lastName
      c.clientName = next.clientName
    }
    c.title = c.clientName
    if (payload.phase !== undefined) c.phase = Number(payload.phase) || c.phase
    if (payload.dueDate !== undefined) c.dueDate = payload.dueDate || null
    if (payload.description !== undefined) c.description = payload.description || ''
    if (payload.litigationStatus !== undefined) {
      const s = String(payload.litigationStatus || '').toLowerCase()
      if (s === 'pre' || s === 'litigation') c.litigationStatus = s
    }
    if (payload.dateOfIncident !== undefined) c.dateOfIncident = payload.dateOfIncident
    if (payload.typeOfCase !== undefined) c.typeOfCase = payload.typeOfCase
    seedPhase4TrialIfNeeded(c, data, payload._actor || 'system')
    recalcPhases(c)
    recordAuditUnsafe(data, {
      type: 'case.update',
      caseId: c.id,
      before,
      after: {
        clientName: c.clientName,
        firstName: c.firstName,
        lastName: c.lastName,
        phase: c.phase,
        dueDate: c.dueDate,
        description: c.description,
        litigationStatus: c.litigationStatus,
        dateOfIncident: c.dateOfIncident,
        typeOfCase: c.typeOfCase
      },
      actor: payload._actor || 'system'
    })
    return c
  })
}
export async function setLitigationStatus(id, status, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => x.id === id); if (!c) return null
    const norm = String(status || '').toLowerCase()
    if (!['pre','litigation'].includes(norm)) return c
    if (c.litigationStatus !== norm) {
      const from = c.litigationStatus || 'pre'
      c.litigationStatus = norm
      ensurePhaseTasks(c)
      if (norm === 'litigation' && (c.phaseTasks[3] || []).length > 0) {
        c.phaseTasks[5] ||= []
        const startId = c.phaseTasks[5].reduce((m, t) => Math.max(m, t.id || 0), 0)
        let n = 0
        for (const t of c.phaseTasks[3]) { n++; c.phaseTasks[5].push({ ...t, id: startId + n, updatedAt: new Date().toISOString() }) }
        c.phaseTasks[3] = []
        recordAuditUnsafe(data, { type: 'phase.move.p3_to_p5', caseId: id, clientName: c.clientName, moved: n, actor })
      }
      recordAuditUnsafe(data, { type:'case.litigation.set', caseId: id, clientName: c.clientName, from, to: norm, actor })
    }
    seedPhase4TrialIfNeeded(c, data, actor)
    syncP1LopToDemand_mutate(data, c)
    recalcPhasesFromTasks(c)
    return c
  })
}
export async function deleteCase(id) {
  return db.tx(async (data) => {
    const i = data.cases.findIndex(c => c.id === id)
    if (i >= 0) {
      const removed = data.cases[i]
      data.cases.splice(i,1)
      recordAuditUnsafe(data, { type:'case.delete', caseId: id, clientName: removed?.clientName, actor: 'system' })
    }
  })
}
/* ========================= Tasks ========================= */
export async function addPhaseTask(id, phase, title, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => x.id === id); if (!c) return null
    ensurePhaseTasks(c)
    let p = Number(phase); if (![1,2,3,4,5].includes(p)) return null
    if (titleMatchesIncident(title) && p !== 1) {
      recordAuditUnsafe(data, { type:'task.autoPhaseRemap', caseId: id, from: p, to: 1, title: String(title || ''), actor })
      p = 1
    }
    const now = new Date().toISOString()
    const task = { id: nextTaskId(c.phaseTasks[p]), title: String(title || 'New Task').trim() || 'New Task', done: false, createdAt: now, updatedAt: now }
    if (p === 1 && titleMatchesIncident(task.title) && !Array.isArray(task.children)) {
      task.children = P1_INCIDENT_CHILDREN.map((t, i) => ({ id: i + 1, title: t, done: false, createdAt: now, updatedAt: now }))
    }
    c.phaseTasks[p].push(task)
    if (p === 1 && task.title.trim().toLowerCase() === P1_TEMPLATE_LOP_TITLE.toLowerCase()) task.templateKey = P1_TEMPLATE_KEY_LOP
    if (p === 1 && task.templateKey === P1_TEMPLATE_KEY_LOP) syncP1LopToDemand_mutate(data, c)
    recalcPhasesFromTasks(c)
    recordAuditUnsafe(data, { type:'task.add', caseId: id, clientName: c.clientName, phase: p, taskId: task.id, title: task.title, actor })
    return { phase: p, id: task.id }
  })
}
export async function togglePhaseTask(id, phase, taskId, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => x.id === id); if (!c) return null
    ensurePhaseTasks(c)
    const p = Number(phase); if (![1,2,3,4,5].includes(p)) return null
    const t = c.phaseTasks[p].find(t => t.id === Number(taskId)); if (!t) return null
    t.done = !t.done
    t.updatedAt = new Date().toISOString()
    if (p === 1 && (t.templateKey === P1_TEMPLATE_KEY_LOP)) syncP1LopToDemand_mutate(data, c)
    recalcPhasesFromTasks(c)
    recordAuditUnsafe(data, { type:'task.toggle', caseId: id, clientName: c.clientName, phase: p, taskId: t.id, done: t.done, title: t.title, actor })
    return t
  })
}
export async function editPhaseTaskTitle(id, phase, taskId, newTitle, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => x.id === id); if (!c) return null
    ensurePhaseTasks(c)
    const p = Number(phase); if (![1,2,3,4,5].includes(p)) return null
    const t = c.phaseTasks[p].find(t => t.id === Number(taskId)); if (!t) return null
    const before = t.title
    t.title = String(newTitle || '').trim() || before
    t.updatedAt = new Date().toISOString()
    if (p === 1 && (t.templateKey === P1_TEMPLATE_KEY_LOP || before.toLowerCase() === P1_TEMPLATE_LOP_TITLE.toLowerCase())) {
      t.templateKey = P1_TEMPLATE_KEY_LOP
      syncP1LopToDemand_mutate(data, c)
    }
    recalcPhasesFromTasks(c)
    recordAuditUnsafe(data, { type:'task.rename', caseId: id, clientName: c.clientName, phase: p, taskId: t.id, before, after: t.title, actor })
    return t
  })
}
export async function deletePhaseTask(id, phase, taskId, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => x.id === id); if (!c) return null
    c.phaseTasks ||= { 1:[], 2:[], 3:[], 4:[], 5:[] }
    const p = Number(phase); if (![1,2,3,4,5].includes(p)) return null
    const arr = c.phaseTasks[p] || []
    const idx = arr.findIndex(t => Number(t.id) === Number(taskId))
    if (idx < 0) return null
    const t = arr[idx]
    if (!t.deleted_at) {
      t.deleted_at = new Date().toISOString()
      t._deletedMeta = { prevIndex: idx }
      t.updatedAt = t.deleted_at
      recalcPhasesFromTasks(c)
      ;(data.audit ||= []).push({
        id: (data.audit.reduce((m, a) => Math.max(m, a.id || 0), 0) || 0) + 1,
        when: new Date().toISOString(),
        type: 'task.softDelete',
        caseId: id, phase: p, taskId: t.id, title: t.title, actor
      })
    }
    return true
  })
}
/* ========================= Subtasks ========================= */
export async function addPhaseSubtask(id, phase, taskId, title, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => x.id === id); if (!c) return null
    ensurePhaseTasks(c)
    const p = Number(phase); if (![1,2,3,4,5].includes(p)) return null
    const t = c.phaseTasks[p].find(t => t.id === Number(taskId)); if (!t) return null
    t.children ||= []
    const sid = nextSubId(t)
    const now = new Date().toISOString()
    t.children.push({ id: sid, title: String(title || 'New Subtask').trim() || 'New Subtask', done: false, createdAt: now, updatedAt: now })
    t.updatedAt = now
    if (p === 1 && t.templateKey === P1_TEMPLATE_KEY_LOP) syncP1LopToDemand_mutate(data, c)
    recalcPhasesFromTasks(c)
    recordAuditUnsafe(data, { type:'subtask.add', caseId: id, clientName: c.clientName, phase: p, taskId: t.id, subId: sid, title, actor })
    return { subId: sid }
  })
}
export async function togglePhaseSubtask(id, phase, taskId, subId, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => x.id === id); if (!c) return null
    ensurePhaseTasks(c)
    const p = Number(phase); if (![1,2,3,4,5].includes(p)) return null
    const t = c.phaseTasks[p].find(t => t.id === Number(taskId)); if (!t) return null
    const st = (t.children || []).find(x => x.id === Number(subId)); if (!st) return null
    st.done = !st.done
    st.updatedAt = new Date().toISOString()
    t.updatedAt = st.updatedAt
    if (p === 1 && t.templateKey === P1_TEMPLATE_KEY_LOP) syncP1LopToDemand_mutate(data, c)
    recalcPhasesFromTasks(c)
    recordAuditUnsafe(data, { type:'subtask.toggle', caseId: id, clientName: c.clientName, phase: p, taskId: t.id, subId: st.id, done: st.done, title: st.title, actor })
    return st
  })
}
export async function editPhaseSubtaskTitle(id, phase, taskId, subId, newTitle, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => x.id === id); if (!c) return null
    ensurePhaseTasks(c)
    const p = Number(phase); if (![1,2,3,4,5].includes(p)) return null
    const t = c.phaseTasks[p].find(t => t.id === Number(taskId)); if (!t) return null
    const st = (t.children || []).find(x => x.id === Number(subId)); if (!st) return null
    const before = st.title
    st.title = String(newTitle || '').trim() || before
    st.updatedAt = new Date().toISOString()
    t.updatedAt = st.updatedAt
    if (p === 1 && t.templateKey === P1_TEMPLATE_KEY_LOP) syncP1LopToDemand_mutate(data, c)
    recalcPhasesFromTasks(c)
    recordAuditUnsafe(data, { type:'subtask.rename', caseId: id, clientName: c.clientName, phase: p, taskId: t.id, subId: st.id, before, after: st.title, actor })
    return st
  })
}
export async function deletePhaseSubtask(id, phase, taskId, subId, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => x.id === id); if (!c) return null
    ensurePhaseTasks(c)
    const p = Number(phase); if (![1,2,3,4,5].includes(p)) return null
    const t = c.phaseTasks[p].find(t => t.id === Number(taskId)); if (!t) return null
    const subs = Array.isArray(t.children) ? t.children : (t.children = [])
    const idx = subs.findIndex(st => Number(st.id) === Number(subId))
    if (idx < 0) return null
    const s = subs[idx]
    if (s.deleted_at) return { ok: true }
    s.deleted_at = new Date().toISOString()
    s._undo_meta = { index: idx }
    recordAuditUnsafe(data, {
      type: 'subtask.delete',
      caseId: id, phase: p, taskId: t.id, subId: s.id,
      before: { ...s, deleted_at: undefined, _undo_meta: undefined },
      after: { ...s },
      actor
    })
    return { ok: true }
  })
}
export async function undoDeletePhaseTask(id, phase, taskId, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => x.id === id); if (!c) return null
    c.phaseTasks ||= {1:[], 2:[], 3:[], 4:[], 5:[]}
    const p = Number(phase); if (![1,2,3,4,5].includes(p)) return null
    const arr = c.phaseTasks[p] || []
    const idx = arr.findIndex(t => Number(t.id) === Number(taskId))
    if (idx < 0) return null
    const t = arr[idx]
    if (t.deleted_at) {
      const prevIndex = Number(t._deletedMeta?.prevIndex ?? -1)
      t.deleted_at = null
      delete t._deletedMeta
      t.updatedAt = new Date().toISOString()
      if (prevIndex >= 0 && prevIndex !== idx) {
        const [obj] = arr.splice(idx, 1)
        const ins = Math.min(Math.max(prevIndex, 0), arr.length)
        arr.splice(ins, 0, obj)
      }
      recalcPhasesFromTasks(c)
      ;(data.audit ||= []).push({
        id: (data.audit.reduce((m, a) => Math.max(m, a.id || 0), 0) || 0) + 1,
        when: new Date().toISOString(),
        type: 'task.undoDelete',
        caseId: id, phase: p, taskId: t.id, title: t.title, actor
      })
    }
    return true
  })
}
export async function undoDeletePhaseSubtask(caseId, phase, taskId, subId, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => Number(x.id) === Number(caseId)); if (!c) throw new Error('case not found')
    ensureCaseShape(c)
    const tasks = (c.phaseTasks && c.phaseTasks[phase]) || []
    const t = tasks.find(x => Number(x.id) === Number(taskId)); if (!t) throw new Error('task not found')
    let subs = Array.isArray(t.children) ? t.children : null
    if (!subs) subs = (t.children = [])
    const matchById = s => Number(s.id) === Number(subId) || String(s.id) === String(subId)
    let idx = subs.findIndex(matchById)
    if (idx === -1 && Number.isInteger(Number(subId)) && Number(subId) >= 0 && Number(subId) < subs.length) idx = Number(subId)
    if (idx === -1) throw new Error('subtask not found')
    const s = subs[idx]
    if (!s.deleted_at) return { ok: true }
    const before = { ...s }
    delete s.deleted_at
    const desiredIndex = (s._undo_meta && Number.isInteger(s._undo_meta.index)) ? s._undo_meta.index : idx
    if (desiredIndex !== idx && desiredIndex >= 0 && desiredIndex < subs.length) {
      const [item] = subs.splice(idx, 1)
      const insertAt = Math.min(desiredIndex, subs.length)
      subs.splice(insertAt, 0, item)
    }
    delete s._undo_meta
    recordAuditUnsafe(data, {
      type: 'subtask.undo_delete',
      caseId, phase, taskId, subId,
      before,
      after: { ...s },
      actor
    })
    return { ok: true }
  })
}
/* ========================= Bulk ops / reorder ========================= */
export async function reorderPhaseTasks(id, phase, order, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => x.id === id); if (!c) return null
    if (![1,2,3,4,5].includes(Number(phase))) return null
    const arr = Array.isArray(c.phaseTasks?.[phase]) ? c.phaseTasks[phase] : []
    const byId = new Map(arr.map(t => [Number(t.id), t]))
    const next = []; let nMoved = 0
    for (const tid of order) { const t = byId.get(Number(tid)); if (t) { next.push(t); byId.delete(Number(tid)); nMoved++ } }
    for (const t of arr) if (byId.has(Number(t.id))) next.push(t)
    c.phaseTasks[phase] = next
    recordAuditUnsafe(data, { type:'tasks.reorder', caseId: id, phase, moved: nMoved, order, actor })
    return true
  })
}
export async function setPhaseTasksStatus(id, phase, ids, done, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => x.id === id); if (!c) return null
    if (![1,2,3,4,5].includes(Number(phase))) return null
    const arr = Array.isArray(c.phaseTasks?.[phase]) ? c.phaseTasks[phase] : []
    const set = new Set(ids.map(Number))
    let changed = 0
    const now = new Date().toISOString()
    for (const t of arr) {
      if (set.has(Number(t.id)) && !!t.done !== !!done) { t.done = !!done; t.updatedAt = now; changed++ }
    }
    recalcPhasesFromTasks(c)
    recordAuditUnsafe(data, { type:'tasks.bulkSet', caseId: id, phase, changed, to: !!done, ids, actor })
    return true
  })
}
export async function setPhaseSubtasksStatus(id, phase, pairs, done, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => x.id === id); if (!c) return []
    if (![1,2,3,4,5].includes(Number(phase))) return []
    const arr = Array.isArray(c.phaseTasks?.[phase]) ? c.phaseTasks[phase] : []
    const want = !!done
    const now = new Date().toISOString()
    const prev = []
    for (const { taskId, subId } of pairs) {
      const t = arr.find(tt => Number(tt.id) === Number(taskId)); if (!t || !Array.isArray(t.children)) continue
      const st = t.children.find(s => Number(s.id) === Number(subId)); if (!st) continue
      prev.push({ taskId: Number(taskId), subId: Number(subId), done: !!st.done })
      st.done = want; st.updatedAt = now; t.updatedAt = now
    }
    recordAuditUnsafe(data, { type:'subtasks.bulkSet', caseId: id, phase, to: want, count: prev.length, actor })
    recalcPhasesFromTasks(c)
    return prev
  })
}
export async function setPhaseSubtasksStatusExact(id, phase, states, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => x.id === id); if (!c) return false
    if (![1,2,3,4,5].includes(Number(phase))) return false
    const arr = Array.isArray(c.phaseTasks?.[phase]) ? c.phaseTasks[phase] : []
    const now = new Date().toISOString()
    let changed = 0
    for (const { taskId, subId, done } of states) {
      const t = arr.find(tt => Number(tt.id) === Number(taskId)); if (!t || !Array.isArray(t.children)) continue
      const st = t.children.find(s => Number(s.id) === Number(subId)); if (!st) continue
      if (!!st.done !== !!done) changed++
      st.done = !!done; st.updatedAt = now; t.updatedAt = now
    }
    recordAuditUnsafe(data, { type:'subtasks.bulkUndo', caseId: id, phase, changed, actor })
    recalcPhasesFromTasks(c)
    return true
  })
}

export async function togglePhaseGrandchild(id, phase, taskId, subId, childId, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => Number(x.id) === Number(id))
    if (!c) return null
    ensurePhaseTasks(c)

    const p = Number(phase)
    if (![1,2,3,4,5].includes(p)) return null
    const t = (c.phaseTasks[p] || []).find(x => Number(x.id) === Number(taskId))
    if (!t || !Array.isArray(t.children)) return null

    const st = t.children.find(x => Number(x.id) === Number(subId))
    if (!st || !Array.isArray(st.children)) return null

    const gc = st.children.find(x => Number(x.id) === Number(childId))
    if (!gc) return null

    gc.done = !gc.done
    const now = new Date().toISOString()
    gc.updatedAt = now
    st.updatedAt = now
    t.updatedAt = now

    recalcPhasesFromTasks(c)
    recordAuditUnsafe?.(data, { type: 'grandchild.toggle', caseId: c.id, phase: p, taskId: t.id, subId: st.id, childId: gc.id, actor })
    return { ok: true, done: !!gc.done }
  })
}
/* ========================= Settlement check types (task meta) ========================= */
export const SETTLEMENT_CHECK_TYPES = [
  'PIP','UM/UIM','Other'
]
export async function addSettlementCheckType(id, phase, taskId, checkType, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => Number(x.id) === Number(id)); if (!c) return null
    ensurePhaseTasks(c)
    const p = Number(phase); if (![1,2,3,4,5].includes(p)) return null
    const t = (c.phaseTasks[p] || []).find(t => Number(t.id) === Number(taskId)); if (!t) return null
    const title = String(t.title || '').trim().toLowerCase()
    if (!/settlement\s*check\s*received\??/.test(title)) return t
    const type = String(checkType || '').trim(); if (!type) return t
    t.meta ||= {}; t.meta.settlementChecks ||= []
    if (!t.meta.settlementChecks.includes(type)) t.meta.settlementChecks.push(type)
    t.updatedAt = new Date().toISOString()
    recordAuditUnsafe(data, { type:'task.meta.addSettlementCheck', caseId: c.id, phase: p, taskId: t.id, checkType: type, actor })
    return t
  })
}
export async function removeSettlementCheckType(id, phase, taskId, index, actor = 'system') {
  return db.tx(async (data) => {
    const c = data.cases.find(x => Number(x.id) === Number(id)); if (!c) return null
    ensurePhaseTasks(c)
    const p = Number(phase); if (![1,2,3,4,5].includes(p)) return null
    const t = (c.phaseTasks[p] || []).find(t => Number(t.id) === Number(taskId)); if (!t) return null
    const title = String(t.title || '').trim().toLowerCase()
    if (!/settlement\s*check\s*received\??/.test(title)) return t
    const idx = Number(index)
    if (Array.isArray(t.meta?.settlementChecks) && idx >= 0 && idx < t.meta.settlementChecks.length) {
      const [removed] = t.meta.settlementChecks.splice(idx, 1)
      recordAuditUnsafe(data, { type:'task.meta.removeSettlementCheck', caseId: c.id, phase: p, taskId: t.id, removed, actor })
      t.updatedAt = new Date().toISOString()
    }
    return t
  })
}
/* ========================= Providers ========================= */
async function ensureProviders(data) { if (!Array.isArray(data.providers)) data.providers = [] }
export async function listProviders(category = null) {
  return db.tx(async (data) => {
    await ensureProviders(data)
    const items = category ? data.providers.filter(p => (p.category || '') === String(category)) : data.providers
    return [...items].sort((a,b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
  })
}
export async function addProvider(name, category = null, actor = 'system') {
  const trimmed = String(name || '').trim()
  const cat = category ? String(category).trim().toLowerCase() : null
  if (!trimmed) throw new Error('Provider name required')
  return db.tx(async (data) => {
    await ensureProviders(data)
    const hit = data.providers.find(p => (p.name || '').toLowerCase() === trimmed.toLowerCase() && (String(p.category || '') === String(cat || '')))
    if (hit) return hit
    const nextId = (arr) => (arr.reduce((m, x) => Math.max(m, Number(x.id || 0)), 0) || 0) + 1
    const provider = { id: nextId(data.providers), name: trimmed, category: cat, createdAt: new Date().toISOString(), createdBy: actor }
    data.providers.push(provider)
    recordAuditUnsafe(data, { type:'provider.add', id:provider.id, name:provider.name, category: provider.category, actor })
    return provider
  })
}
export async function deleteProvider(id, actor = 'system') {
  const pid = Number(id); if (!pid || Number.isNaN(pid)) throw new Error('Invalid provider id')
  return db.tx(async (data) => {
    await ensureProviders(data)
    const idx = data.providers.findIndex(p => Number(p.id) === pid)
    if (idx === -1) return { ok:false, removed:0 }
    const [removed] = data.providers.splice(idx, 1)
    recordAuditUnsafe(data, { type:'provider.delete', id:pid, name:removed?.name, category: removed?.category, actor })
    return { ok:true, removed:1 }
  })
}
/* ---------- Admin migration: move 'Incident Reports' from Phase 2 to Phase 1 ---------- */
export async function migrateIncidentReportsToPhase1(actor = 'system') {
  return db.tx(async (data) => {
    let movedCases = 0, movedTasks = 0
    if (!data || !Array.isArray(data.cases)) return { ok: true, movedCases, movedTasks }
    for (const c of data.cases) {
      try {
        ensurePhaseTasks(c)
        injectPhase1IfEmpty(c)
        const p2 = c.phaseTasks[2] || []
        const toMoveIdx = []
        for (let i = 0; i < p2.length; i++) {
          const t = p2[i]
          if (t && titleMatchesIncident(t.title)) toMoveIdx.push(i)
        }
        if (!toMoveIdx.length) continue
        c.phaseTasks[1] ||= []
        let caseMoved = 0
        for (let k = 0; k < toMoveIdx.length; k++) {
          const idx = toMoveIdx[k] - k
          const [srcTask] = p2.splice(idx, 1)
          const dstExisting = (c.phaseTasks[1] || []).find(t => titleMatchesIncident(t.title))
          if (!dstExisting) {
            c.phaseTasks[1].push(srcTask)
            caseMoved++; movedTasks++
            recordAuditUnsafe(data, { type: 'task.movePhase', caseId: c.id, from: 2, to: 1, taskId: srcTask.id, title: srcTask.title, actor })
          } else {
            const now = new Date().toISOString()
            dstExisting.done = dstExisting.done || !!srcTask.done
            const byKey = new Map((dstExisting.children || []).map(st => [String(st.title).toLowerCase(), st]))
            for (const st of (srcTask.children || [])) {
              const key = String(st.title || '').toLowerCase()
              const hit = byKey.get(key)
              if (hit) { hit.done = hit.done || !!st.done; hit.updatedAt = now }
              else {
                const nid = (Array.isArray(dstExisting.children) && dstExisting.children.length
                             ? Math.max(0, ...dstExisting.children.map(x => Number(x.id||0))) + 1
                             : 1)
                ;(dstExisting.children ||= []).push({ id: nid, title: st.title, done: !!st.done, createdAt: st.createdAt || now, updatedAt: now })
              }
            }
            dstExisting.updatedAt = now
            caseMoved++; movedTasks++
            recordAuditUnsafe(data, { type:'task.mergePhaseMove', caseId: c.id, from: 2, to: 1, mergedFromTaskId: srcTask.id, intoTaskId: dstExisting.id, title: dstExisting.title, actor })
          }
        }
        if (caseMoved) {
          movedCases++
          recalcPhasesFromTasks(c)
        }
      } catch (e) {
        console.error('[migrateIncidentReportsToPhase1] case error:', e)
      }
    }
    return { ok: true, movedCases, movedTasks }
  })
}
// --- BEGIN: Litigation migration helper (Phase 3 -> 5) ---
export async function migratePhase3To5OnLitigation(caseId, actor = 'system') {
  const _db = db
  return _db.tx(async (data) => {
    const cases = Array.isArray(data.cases) ? data.cases : [];
    const c = cases.find(x => String(x.id) === String(caseId));
    if (!c) return { ok: false, reason: 'not_found' };
    c.phaseTasks ||= { 1:[], 2:[], 3:[], 4:[], 5:[] };
    for (const k of [1,2,3,4,5]) if (!Array.isArray(c.phaseTasks[k])) c.phaseTasks[k] = [];
    const lit = String(c.litigationStatus || '').toLowerCase();
    if (lit != 'litigation') return { ok: true, skipped: 'not_litigation' };
    if (c.__dsMigratedV1 === true) return { ok: true, skipped: 'already_migrated' };
    const phase3 = c.phaseTasks[3] || [];
    const phase5 = c.phaseTasks[5] || [];
    if (!phase3.length) {
      c.__dsMigratedV1 = true;
      recordAuditUnsafe?.(data, { type: 'migration.phase3to5', actor, meta: { moved: 0 } });
      return { ok: true, moved: 0 };
    }
    const seen = new Set(
      phase5.map(t => (t?.id != null ? `id:${t.id}` : `title:${String(t?.title||'').toLowerCase().trim()}`))
    );
    let moved = 0;
    for (const t of phase3) {
      const key = (t?.id != null) ? `id:${t.id}` : `title:${String(t?.title||'').toLowerCase().trim()}`;
      if (!seen.has(key)) {
        phase5.push(t);
        seen.add(key);
        moved++;
      }
    }
    c.phaseTasks[5] = phase5;
    c.phaseTasks[3] = [];
    c.__dsMigratedV1 = true;
    recordAuditUnsafe?.(data, { type: 'migration.phase3to5', actor, meta: { moved } });
    return { ok: true, moved };
  });
}
// --- END: Litigation migration helper ---

/* ========================= Fixed Phase 2 Template Helpers ========================= */
function __p2_normKey(title) {
  return 'title:' + String(title || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

export function phase2Template() {
  try {
    if (P2 && Array.isArray(P2.tasks)) {
      const out = []
      for (const it of P2.tasks) {
        const title = typeof it?.title === 'string' ? it.title.trim() : ''
        if (!title) continue
        const subtasks = (Array.isArray(it?.children) ? it.children : [])
          .map(s => typeof s === 'string' ? s.trim() : typeof s?.title === 'string' ? s.title.trim() : '')
          .filter(Boolean)
        out.push({ title, subtasks })
      }
      return out
    }
  } catch (e) {}
  return []
}

export function phase2TemplateMap() {
  const map = new Map()
  try {
    const tpl = phase2Template()
    for (const t of tpl) {
      if (t.title) {
        const key = __p2_normKey(t.title)
        if (!map.has(key)) map.set(key, { title: t.title, subtasks: [...t.subtasks] })
      }
    }
  } catch (e) {}
  return map
}

export async function replacePhase2TasksWithSelection(caseId, titles, chosenSubtasksMap = {}, opts = {}) {
  const picked = Array.from(new Set(
    (Array.isArray(titles) ? titles : [])
      .map(t => String(t || '').trim())
      .filter(Boolean)
  ))

  return db.tx(async (data) => {
    const c = data.cases.find(x => String(x.id) === String(caseId))
    if (!c) throw new Error('case_not_found')

    ensurePhaseTasks(c)

    const existingByKey = new Map()
    for (const t of (c.phaseTasks[2] || [])) {
      const key = __p2_normKey(t?.title)
      if (key && !existingByKey.has(key)) existingByKey.set(key, t)
    }

    const tplMap = phase2TemplateMap()
    const newTasks = []
    const seen = new Set()

    for (const title of picked) {
      const key = __p2_normKey(title)
      if (seen.has(key)) continue
      seen.add(key)

      let template = tplMap.get(key) || (existingByKey.get(key) ? {
        title: existingByKey.get(key).title,
        subtasks: (existingByKey.get(key).children || []).map(ch => ch.title)
      } : { title, subtasks: [] })

      const chosen = chosenSubtasksMap[key] || chosenSubtasksMap[title]
      if (Array.isArray(chosen) && chosen.length > 0) {
        const wanted = new Set(chosen.map(s => String(s).trim().toLowerCase()))
        template.subtasks = template.subtasks.filter(st => wanted.has(String(st).trim().toLowerCase()))
      }

      const taskObj = {
        id: nextTaskId(c.phaseTasks[2] || []),
        title: template.title,
        done: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      if (template.subtasks.length > 0) {
        taskObj.children = template.subtasks.map((st, i) => ({
          id: i + 1,
          title: st,
          done: false,
          createdAt: taskObj.createdAt,
          updatedAt: taskObj.updatedAt
        }))
      }
      newTasks.push(taskObj)
    }

    const before = c.phaseTasks[2]?.length || 0
    c.phaseTasks[2] = newTasks
    if (opts?.markConfigured) (c.flags ||= {}).phase2Configured = true

    recalcPhasesFromTasks(c)

    return { ok: true, caseId: c.id, before, after: newTasks.length }
  })
}

/* ========================= Phase 3 Litigation Template Helpers ========================= */
function __p3_lit_normKey(title) {
  return 'title:' + String(title || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

export function phase3LitTemplate() {
  try {
    if (P3_LIT && Array.isArray(P3_LIT.tasks)) {
      const out = []
      for (const it of P3_LIT.tasks) {
        const title = typeof it?.title === 'string' ? it.title.trim() : ''
        if (!title) continue
        const subtasks = (Array.isArray(it?.children) ? it.children : [])
          .map(s => {
            if (typeof s === 'string') return { title: s.trim(), grandchildren: [] }
            if (typeof s?.title === 'string') {
              return {
                title: s.title.trim(),
                grandchildren: Array.isArray(s.children) ? s.children.map(g => typeof g === 'string' ? g.trim() : '') : []
              }
            }
            return null
          })
          .filter(Boolean)
        out.push({ title, subtasks })
      }
      return out
    }
  } catch (e) {}
  return []
}

export function phase3LitTemplateMap() {
  const map = new Map()
  try {
    for (const t of tpl) {
      if (t.title) {
        const key = __p3_lit_normKey(t.title)
        if (!map.has(key)) map.set(key, { title: t.title, subtasks: [...t.subtasks] })
      }
    }
  } catch (e) {}
  return map
}

export async function replacePhase3LitTasksWithSelection(caseId, titles, chosenSubtasksMap = {}, opts = {}) {
  const picked = Array.from(new Set(
    (Array.isArray(titles) ? titles : [])
      .map(t => String(t || '').trim())
      .filter(Boolean)
  ))

  return db.tx(async (data) => {
    const c = data.cases.find(x => String(x.id) === String(caseId))
    if (!c) throw new Error('case_not_found')

    if (String(c.litigationStatus || '').toLowerCase() !== 'litigation') {
      throw new Error('case_not_in_litigation')
    }

    ensurePhaseTasks(c)

    const existingByKey = new Map()
    for (const t of (c.phaseTasks[3] || [])) {
      const key = __p3_lit_normKey(t?.title)
      if (key && !existingByKey.has(key)) existingByKey.set(key, t)
    }

    const tplMap = phase3LitTemplateMap()
    const newTasks = []
    const seen = new Set()

    for (const title of picked) {
      const key = __p3_lit_normKey(title)
      if (seen.has(key)) continue
      seen.add(key)

      let template = tplMap.get(key) || (existingByKey.get(key) ? {
        title: existingByKey.get(key).title,
        subtasks: (existingByKey.get(key).children || []).map(ch => ({
          title: ch.title,
          grandchildren: (ch.children || []).map(g => g.title || '')
        }))
      } : { title, subtasks: [] })

      const chosen = chosenSubtasksMap[key] || chosenSubtasksMap[title]
      if (Array.isArray(chosen) && chosen.length > 0) {
        const wanted = new Set(chosen.map(s => String(s).trim().toLowerCase()))
        template.subtasks = template.subtasks.filter(st => wanted.has(String(st.title).trim().toLowerCase()))
      }

      const taskObj = {
        id: nextTaskId(c.phaseTasks[3] || []),
        title: template.title,
        done: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      if (template.subtasks.length > 0) {
        taskObj.children = template.subtasks.map((st, i) => {
          const sub = {
            id: i + 1,
            title: st.title,
            done: false,
            createdAt: taskObj.createdAt,
            updatedAt: taskObj.updatedAt
          }
          if (st.grandchildren && st.grandchildren.length > 0) {
            sub.children = st.grandchildren.map((g, j) => ({
              id: j + 1,
              title: g,
              done: false,
              createdAt: taskObj.createdAt,
              updatedAt: taskObj.updatedAt
            }))
          }
          return sub
        })
      }
      newTasks.push(taskObj)
    }

    const before = c.phaseTasks[3]?.length || 0
    c.phaseTasks[3] = newTasks
    if (opts?.markConfigured) (c.flags ||= {}).phase3LitConfigured = true

    recalcPhasesFromTasks(c)

    recordAuditUnsafe(data, { type: 'phase3_lit.template_replace', actor: 'user', meta: { before, after: newTasks.length } })

    return { ok: true, caseId: c.id, before, after: newTasks.length }
  })
}
