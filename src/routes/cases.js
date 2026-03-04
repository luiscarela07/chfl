// FILE: src/routes/cases.js
import { Router } from 'express';

import { // Cases
  listCases, getCase, createCase, updateCase, deleteCase, setLitigationStatus, phaseNamesForCase, // Tasks
  addPhaseTask, addSettlementCheckType, removeSettlementCheckType, togglePhaseTask, editPhaseTaskTitle, deletePhaseTask, undoDeletePhaseTask, // Subtasks
  addPhaseSubtask, togglePhaseSubtask, editPhaseSubtaskTitle, deletePhaseSubtask, undoDeletePhaseSubtask, // Bulk/helpers (keep exported even if not used directly here)
  reorderPhaseTasks, setPhaseTasksStatus, setPhaseSubtasksStatus, setPhaseSubtasksStatusExact, // Migrations
  migrateIncidentReportsToPhase1, // Providers (category-aware)
  listProviders, addProvider, deleteProvider, replacePhase2TasksWithSelection, phase2Template,
  togglePhaseGrandchild,
  phase3LitTemplate,
  replacePhase3LitTasksWithSelection
} from '../models.js';
import { migratePhase3To5OnLitigation } from '../models.js';

const router = Router();

// Auto-migrate Phase 3 ? 5 on any /cases/:id access (idempotent)
router.param('id', async (req, res, next, id) => {
  try { await migratePhase3To5OnLitigation(id, req.session?.user?.email || 'system'); }
  catch (e) { /* non-fatal */ }
  next();
});

const actor = (req) => (req.session?.user?.email || req.session?.userEmail || 'system');

function wantsJson(req) {
  return (req.headers['accept'] || '').includes('application/json') ||
         (req.headers['x-requested-with'] || '') === 'fetch';
}

/* =============================== Cases =============================== */

router.get('/', async (req, res) => {
  try {
    const client = (req.query.client || '').trim();
    const rows = await listCases(client);
    res.render('cases', {
      rows,
      sort: 'phases',
      dir: 'desc',
      phaseOpen: 0,
      filterCount: rows.length,
      client,
      phaseFilter: 'any',
      dueFilter: 'any',
      start: '',
      end: '',
      lit: 'any',
      activeFilters: []
    });
  } catch (e) {
    console.error('[GET /cases] error:', e);
    res.status(500).send('Cases failed. Please retry.');
  }
});

router.get('/new', async (_req, res) => {
  const presetsPhase2 = await phase2Template(globalThis || {});
  res.render('case-form', { item: null, presetsPhase2 });
});

router.post('/new', async (req, res) => {
  try {
    const created = await createCase({
      firstName: req.body.first_name,
      lastName: req.body.last_name,
      status: req.body.status || 'Open',
      litigationStatus: req.body.litigation_status || 'pre',
      phase: parseInt(req.body.phase || '1', 10),
      dueDate: req.body.due_date || null,
      dateOfIncident: req.body.date_of_incident || null,
      typeOfCase: req.body.type_of_case || null,
      description: req.body.description || '',
      _actor: actor(req)
    });

    // Normalize Phase 2 selections from either "phase2_titles[]" or "phase2_titles"
    let p2 = req.body['phase2_titles[]'];
    if (typeof p2 === 'undefined') p2 = req.body.phase2_titles;
    if (typeof p2 === 'string') p2 = [p2];
    if (!Array.isArray(p2)) p2 = [];
    if (p2.length) {
      try { await replacePhase2TasksWithSelection(created.id, p2, {}, { markConfigured: true }); } catch {}
    }

    res.redirect('/cases');
  } catch (e) {
    console.error('[POST /cases/new] error:', e);
    res.status(400).send('Could not create case. Please retry.');
  }
});

/* ---------- Single source of truth: GET /cases/:id ---------- */
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const item = await getCase(id);
    if (!item) return res.status(404).send('Not found');

    let providers = [];
    try { providers = await listProviders(); } catch { providers = []; }

    res.render('case-detail', {
      presetsPhase2: phase2Template(globalThis || {}),
      presetsPhase3Lit: phase3LitTemplate(),
      item,
      phaseNames: phaseNamesForCase(item),
      providers
    });
  } catch (e) {
    console.error('[GET /cases/:id] error:', e);
    res.status(500).send('Could not load case. Please retry.');
  }
});

router.get('/:id/edit', async (req, res) => {
  try {
    const item = await getCase(parseInt(req.params.id, 10));
    if (!item) return res.status(404).send('Not found');
    res.render('case-form', {
      item,
      phaseNames: phaseNamesForCase(item),
      presetsPhase2: phase2Template(globalThis || {})
    });
  } catch (e) {
    console.error('[GET /cases/:id/edit] error:', e);
    res.status(500).send('Could not load edit form. Please retry.');
  }
});

router.post('/:id/edit', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await updateCase(id, {
      firstName: req.body.first_name,
      lastName: req.body.last_name,
      phase: req.body.phase ? parseInt(req.body.phase, 10) : undefined,
      dueDate: req.body.due_date || undefined,
      litigationStatus: req.body.litigation_status || undefined,
      description: req.body.description || undefined,
      // avoid clobbering with blanks
      dateOfIncident: (req.body.date_of_incident ?? '').trim() ? req.body.date_of_incident : undefined,
      typeOfCase: (req.body.type_of_case ?? '').trim() ? req.body.type_of_case : undefined,
      _actor: actor(req)
    });
    res.redirect(`/cases/${id}`);
  } catch (e) {
    console.error('[POST /cases/:id/edit] error:', e);
    res.status(400).send('Could not save changes. Please retry.');
  }
});

router.post('/:id/litigation', async (req, res) => {
  try {
    await setLitigationStatus(
      parseInt(req.params.id, 10),
      String(req.body.litigation || 'pre').toLowerCase(),
      actor(req)
    );
    const next = String(req.query.next || '').trim();
    if (next && next.startsWith('/')) return res.redirect(next);
    res.redirect(`/cases/${req.params.id}`);
  } catch (e) {
    console.error('[POST /cases/:id/litigation] error:', e);
    res.status(400).send('Could not update litigation status. Please retry.');
  }
});

router.post('/:id/delete', async (req, res) => {
  try {
    await deleteCase(parseInt(req.params.id, 10));
    res.redirect('/cases');
  } catch (e) {
    console.error('[POST /cases/:id/delete] error:', e);
    res.status(400).send('Could not delete case. Please retry.');
  }
});

/* =============================== Tasks =============================== */

router.post('/:id/phase/:phase/tasks', async (req, res) => {
  try {
    await addPhaseTask(+req.params.id, +req.params.phase, req.body.title, actor(req));
    res.redirect(`/cases/${req.params.id}#phase-${req.params.phase}`);
  } catch (e) {
    console.error('[POST addPhaseTask] error:', e);
    res.status(400).send('Could not add task. Please retry.');
  }
});

router.post('/:id/phase/:phase/tasks/reorder', async (req, res) => {
  try {
    const caseId = parseInt(req.params.id, 10);
    const phase = parseInt(req.params.phase, 10);
    let order = req.body.order;
    if (typeof order === 'undefined') order = req.body['order[]'];
    if (!Array.isArray(order)) order = typeof order === 'string' ? [order] : [];
    order = order.map(v => parseInt(v, 10)).filter(Number.isFinite);

    await reorderPhaseTasks(caseId, phase, order, actor(req));
    if (wantsJson(req)) return res.json({ ok: true });
    res.redirect(`/cases/${caseId}#phase-${phase}`);
  } catch (e) {
    console.error('[POST reorderPhaseTasks] error:', e);
    if (wantsJson(req)) return res.status(400).json({ ok: false });
    res.status(400).send('Could not reorder tasks. Please retry.');
  }
});

router.post('/:id/phase/:phase/tasks/:taskId/toggle', async (req, res) => {
  try {
    await togglePhaseTask(+req.params.id, +req.params.phase, +req.params.taskId, actor(req));
    if (wantsJson(req)) return res.json({ ok: true });
    res.redirect(`/cases/${req.params.id}#phase-${req.params.phase}`);
  } catch (e) {
    console.error('[POST togglePhaseTask] error:', e);
    if (wantsJson(req)) return res.status(400).json({ ok: false });
    res.status(400).send('Could not toggle task. Please retry.');
  }
});

router.post('/:id/phase/:phase/tasks/:taskId/edit', async (req, res) => {
  try {
    await editPhaseTaskTitle(+req.params.id, +req.params.phase, +req.params.taskId, req.body.title || '', actor(req));
    if (wantsJson(req)) return res.json({ ok: true });
    res.redirect(`/cases/${req.params.id}#phase-${req.params.phase}`);
  } catch (e) {
    console.error('[POST editPhaseTaskTitle] error:', e);
    if (wantsJson(req)) return res.status(400).json({ ok: false });
    res.status(400).send('Could not rename task. Please retry.');
  }
});

router.post('/:id/phase/:phase/tasks/:taskId/delete', async (req, res) => {
  try {
    await deletePhaseTask(+req.params.id, +req.params.phase, +req.params.taskId, actor(req));
    if (wantsJson(req)) return res.json({ ok: true });
    res.redirect(`/cases/${req.params.id}#phase-${req.params.phase}`);
  } catch (e) {
    console.error('[POST deletePhaseTask] error:', e);
    if (wantsJson(req)) return res.status(400).json({ ok: false });
    res.status(400).send('Could not delete task. Please retry.');
  }
});

router.post('/:id/phase/:phase/tasks/:taskId/undo-delete', async (req, res) => {
  try {
    await undoDeletePhaseTask(+req.params.id, +req.params.phase, +req.params.taskId, actor(req));
    if (wantsJson(req)) return res.json({ ok: true });
    res.redirect(`/cases/${req.params.id}#phase-${req.params.phase}`);
  } catch (e) {
    console.error('[POST undoDeletePhaseTask] error:', e);
    if (wantsJson(req)) return res.status(400).json({ ok: false, error: 'Could not undo delete' });
    res.status(400).send('Could not undo delete. Please retry.');
  }
});

/* ============================== Subtasks ============================== */

router.post('/:id/phase/:phase/tasks/:taskId/subtasks', async (req, res) => {
  try {
    await addPhaseSubtask(+req.params.id, +req.params.phase, +req.params.taskId, req.body.title, actor(req));
    res.redirect(`/cases/${req.params.id}#phase-${req.params.phase}-task-${req.params.taskId}`);
  } catch (e) {
    console.error('[POST addPhaseSubtask] error:', e);
    res.status(400).send('Could not add subtask. Please retry.');
  }
});

router.post('/:id/phase/:phase/tasks/:taskId/subtasks/:subId/toggle', async (req, res) => {
  try {
    await togglePhaseSubtask(+req.params.id, +req.params.phase, +req.params.taskId, +req.params.subId, actor(req));
    if (wantsJson(req)) return res.json({ ok: true });
    res.redirect(`/cases/${req.params.id}#phase-${req.params.phase}-task-${req.params.taskId}`);
  } catch (e) {
    console.error('[POST togglePhaseSubtask] error:', e);
    if (wantsJson(req)) return res.status(400).json({ ok: false });
    res.status(400).send('Could not toggle subtask. Please retry.');
  }
});

router.post('/:id/phase/:phase/tasks/:taskId/subtasks/:subId/children/:childId/toggle', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    const phase = parseInt(req.params.phase, 10)
    const taskId = parseInt(req.params.taskId, 10)
    const subId = parseInt(req.params.subId, 10)
    const childId = parseInt(req.params.childId, 10)

    const actor = req?.session?.user?.email || 'user'
    const out = await togglePhaseGrandchild(id, phase, taskId, subId, childId, actor)
    if (!out) return res.status(404).json({ ok: false })
    res.json(out)
  } catch (e) {
    console.error('[POST grandchild toggle] error:', e)
    res.status(500).json({ ok: false })
  }
});

router.post('/:id/phase/:phase/tasks/:taskId/subtasks/:subId/edit', async (req, res) => {
  try {
    await editPhaseSubtaskTitle(
      +req.params.id,
      +req.params.phase,
      +req.params.taskId,
      +req.params.subId,
      req.body.title || '',
      actor(req)
    );
    if (wantsJson(req)) return res.json({ ok: true });
    res.redirect(`/cases/${req.params.id}#phase-${req.params.phase}-task-${req.params.taskId}`);
  } catch (e) {
    console.error('[POST editPhaseSubtaskTitle] error:', e);
    if (wantsJson(req)) return res.status(400).json({ ok: false });
    res.status(400).send('Could not rename subtask. Please retry.');
  }
});

router.post('/:id/phase/:phase/tasks/:taskId/subtasks/:subId/delete', async (req, res) => {
  try {
    await deletePhaseSubtask(+req.params.id, +req.params.phase, +req.params.taskId, +req.params.subId, actor(req));
    if (wantsJson(req)) return res.json({ ok: true });
    res.redirect(`/cases/${req.params.id}#phase-${req.params.phase}-task-${req.params.taskId}`);
  } catch (e) {
    console.error('[POST deletePhaseSubtask] error:', e);
    if (wantsJson(req)) return res.status(400).json({ ok: false });
    res.status(400).send('Could not delete subtask. Please retry.');
  }
});

router.post('/:id/phase/:phase/tasks/:taskId/subtasks/:subId/undo-delete', async (req, res) => {
  try {
    await undoDeletePhaseSubtask(+req.params.id, +req.params.phase, +req.params.taskId, +req.params.subId, actor(req));
    if (wantsJson(req)) return res.json({ ok: true });
    res.redirect(`/cases/${req.params.id}#phase-${req.params.phase}-task-${req.params.taskId}`);
  } catch (e) {
    console.error('[POST undoDeletePhaseSubtask] error:', e);
    if (wantsJson(req)) return res.status(400).json({ ok: false, error: 'Could not undo subtask delete' });
    res.status(400).send('Could not undo subtask delete. Please retry.');
  }
});

/* ============================= Providers ============================== */
/* Single, category-aware set; remove any duplicates elsewhere. */

router.post('/providers', async (req, res) => {
  try {
    const name = String(req.body?.name || req.body?.Name || '').trim();
    const category = String(req.body?.category || '').trim().toLowerCase() || null; // supports per-category lists
    if (!name) return res.status(400).json({ ok: false, error: 'Name required' });

    const p = await addProvider(name, category, actor(req));
    res.json({ ok: true, provider: p });
  } catch (e) {
    console.error('[POST /cases/providers] error:', e);
    res.status(500).json({ ok: false, error: 'Could not add provider' });
  }
});

router.post('/providers/:id/delete', async (req, res) => {
  try {
    const out = await deleteProvider(req.params.id, actor(req));
    const wants = wantsJson(req);
    if (wants) return res.json({ ok: !!out.ok });
    res.redirect('back');
  } catch (e) {
    console.error('[POST /cases/providers/:id/delete] error:', e);
    const wants = wantsJson(req);
    if (wants) return res.status(500).json({ ok: false, error: 'Could not delete provider' });
    res.status(500).send('Could not delete provider');
  }
});

/* ============================= Migration ============================== */

router.post('/admin/migrations/incident-reports-to-phase1', async (req, res) => {
  try {
    const result = await migrateIncidentReportsToPhase1(actor(req));
    res.json(result);
  } catch (e) {
    console.error('[migration incident-reports-to-phase1] error:', e);
    res.status(500).json({ ok: false, error: 'Migration failed' });
  }
});

/* ---------- Settlement check type management ---------- */
router.post('/:id/phase/:phase/tasks/:taskId/checks/add', async (req, res) => {
  try {
    await addSettlementCheckType(
      parseInt(req.params.id, 10),
      parseInt(req.params.phase, 10),
      parseInt(req.params.taskId, 10),
      String(req.body.checkType || ''),
      actor(req)
    );
    res.redirect(`/cases/${req.params.id}#phase-${req.params.phase}`);
  } catch (e) {
    console.error('[POST add settlement check type] error:', e);
    res.status(400).send('Could not add check type');
  }
});

router.post('/:id/phase/:phase/tasks/:taskId/checks/remove/:idx', async (req, res) => {
  try {
    await removeSettlementCheckType(
      parseInt(req.params.id, 10),
      parseInt(req.params.phase, 10),
      parseInt(req.params.taskId, 10),
      parseInt(req.params.idx, 10),
      actor(req)
    );
    res.redirect(`/cases/${req.params.id}#phase-${req.params.phase}`);
  } catch (e) {
    console.error('[POST remove settlement check type] error:', e);
    res.status(400).send('Could not remove check type');
  }
});

/* ---------- Choose applicable Phase-2 tasks (titles + chosen subtasks) ---------- */
router.post('/:id/phase2/choose', async (req, res, next) => {
  try {
    const caseId = req.params.id;

    // Titles: accept titles[], titles (CSV), or array
    let titles = [];
    if (Array.isArray(req.body.titles)) titles = req.body.titles;
    else if (Array.isArray(req.body['titles[]'])) titles = req.body['titles[]'];
    else if (typeof req.body.titles === 'string') {
      titles = req.body.titles.split(',').map(s => s.trim()).filter(Boolean);
    }

    // Subtask mapping: accept subtasks[title]=... or raw object
    let subMap = {};
    if (req.body && typeof req.body.subtasks === 'object') {
      subMap = req.body.subtasks;
    } else {
      subMap = {};
      for (const k of Object.keys(req.body || {})) {
        const m = k.match(/^subtasks\[(.+)\]$/);
        if (m) subMap[m[1]] = req.body[k];
      }
    }

    const result = await replacePhase2TasksWithSelection(caseId, titles, subMap, { markConfigured: true });
    if ((req.get('Accept') || '').includes('application/json')) return res.json({ ok: true, ...result });
    res.redirect(`/cases/${caseId}`);
  } catch (err) { next(err); }
});


/* ---------- Choose applicable Phase-3 (Litigation) tasks (titles + chosen subtasks) ---------- */
router.post('/:id/phase3-lit/choose', async (req, res, next) => {
  try {
    const caseId = req.params.id;

    let titles = [];
    if (Array.isArray(req.body.titles)) titles = req.body.titles;
    else if (Array.isArray(req.body['titles[]'])) titles = req.body['titles[]'];
    else if (typeof req.body.titles === 'string') {
      titles = req.body.titles.split(',').map(s => s.trim()).filter(Boolean);
    }

    const subMap = {};
    for (const k of Object.keys(req.body || {})) {
      const m = k.match(/^subtasks\[(.+)\]$/);
      if (m) subMap[m[1]] = req.body[k];
    }

    const result = await replacePhase3LitTasksWithSelection(caseId, titles, subMap, { markConfigured: true });
    if ((req.get('Accept') || '').includes('application/json')) return res.json({ ok: true, ...result });
    res.redirect(`/cases/${caseId}`);
  } catch (err) { next(err); }
});



// IMPORTANT: export AFTER all routes are defined
export default router;

router.post('/new', async (req, res) => {
  try {
    const created = await createCase({
      firstName: req.body.first_name,
      lastName: req.body.last_name,
      status: req.body.status || 'Open',
      litigationStatus: req.body.litigation_status || 'pre',
      phase: parseInt(req.body.phase || '1', 10),
      dueDate: req.body.due_date || null,
      dateOfIncident: req.body.date_of_incident || null,
      typeOfCase: req.body.type_of_case || null,
      description: req.body.description || '',
      _actor: (req.session && (req.session.user?.email || req.session.userEmail)) || 'system'
    });

    // Titles: accept "phase2_titles[]" or "phase2_titles"
    let titles = req.body['phase2_titles[]'];
    if (typeof titles === 'undefined') titles = req.body.phase2_titles;
    if (typeof titles === 'string') titles = [titles];
    if (!Array.isArray(titles)) titles = [];
    titles = titles.map(t => String(t || '').trim()).filter(Boolean);

    // Subtasks per task: fields named as subtasks[Task Title][]
    const chosen = {};
    for (const key of Object.keys(req.body || {})) {
      const m = key.match(/^subtasks\[(.+)\]$/);
      if (!m) continue;
      const title = m[1];
      let arr = req.body[key];
      if (typeof arr === 'string') arr = [arr];
      if (!Array.isArray(arr)) arr = [];
      const clean = arr.map(s => String(s || '').trim()).filter(Boolean);
      if (clean.length) chosen[title] = clean;
    }

    // Build subMap: { [title]: [{ title }, ...] }
    const subMap = {};
    for (const t of titles) {
      if (Array.isArray(chosen[t]) && chosen[t].length) {
        subMap[t] = chosen[t].map(s => ({ title: s }));
      }
    }

    if (titles.length) {
      await replacePhase2TasksWithSelection(created.id, titles, subMap, { markConfigured: true });
    }

    res.redirect('/cases');
  } catch (e) {
    console.error('[POST /cases/new] error:', e);
    res.status(400).send('Could not create case. Please retry.');
  }
});
