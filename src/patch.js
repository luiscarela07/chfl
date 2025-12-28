import fs from "fs/promises"
import path from "path"
const dbPath = path.resolve("data","db.json")
async function load(){ try{ return JSON.parse(await fs.readFile(dbPath,"utf8")) } catch(e){ if(e.code==="ENOENT")return {meta:{migrations:[]},users:[],cases:[]}; throw e } }
async function save(d){ const tmp=dbPath+".tmp"; await fs.writeFile(tmp, JSON.stringify(d,null,2),"utf8"); await fs.rename(tmp, dbPath) }

const PHASE1_TEMPLATES = [
  'Client signed POA','Send to client CP intake','Client HIPAA',
  "Obtain from client - driver's license, relevant pics and docs",
  'If MVA - PIP and UIM confirmed, and notice letter sent',
  'Calendar 4-year SOL on UIM','Obtain police report','Welcome Letter sent',
  'Calendar SOL & 1yr/6mo warnings','Calendar 1, 2, 3 and 4 week TC with client',
  'Send LOP to medical provider for Client','Send LOR to at-fault party or insurance co.',
  'Health insurance - send notice letter',
  'CP data tabs - client, defs, incident, injuries, treatment, health insurance',
  'Confirm case file completeness'
]

function ensurePhaseTasks(c){
  c.phaseTasks ||= {1:[],2:[],3:[],4:[]}
  for(const k of [1,2,3,4]) if(!Array.isArray(c.phaseTasks[k])) c.phaseTasks[k] = []
}
function injectPhase1IfEmpty(c){
  ensurePhaseTasks(c)
  if(c.phaseTasks[1].length===0){
    let id=1
    c.phaseTasks[1] = PHASE1_TEMPLATES.map(t=>({id:id++, title:t, done:false}))
  }
}
function recalcPhases(c){
  c.phases ||= {1:false,2:false,3:false,4:false}
  for(const k of [1,2,3,4]){
    const arr = c.phaseTasks[k] || []
    c.phases[k] = arr.length>0 && arr.every(t=>!!t.done)
  }
}

export async function runPatch(){
  const d = await load()
  d.meta ||= { migrations: [] }
  d.cases ||= []

  // p002 numeric phase
  if (!d.meta.migrations.includes("p002_add_phase_field")) {
    for (const c of d.cases) {
      if (!("phase" in c) || ![1,2,3,4].includes(Number(c.phase))) c.phase = 1
    }
    d.meta.migrations.push("p002_add_phase_field")
  }

  // p003 boolean flags
  if (!d.meta.migrations.includes("p003_add_phases_flags")) {
    for (const c of d.cases) {
      c.phases ||= {1:false,2:false,3:false,4:false}
      for (const k of [1,2,3,4]) c.phases[k] = !!c.phases[k]
    }
    d.meta.migrations.push("p003_add_phases_flags")
  }

  // p004 per-phase tasks + inject + recompute flags
  if (!d.meta.migrations.includes("p004_phase_tasks")) {
    for (const c of d.cases) { ensurePhaseTasks(c); injectPhase1IfEmpty(c); recalcPhases(c) }
    d.meta.migrations.push("p004_phase_tasks")
  }

  await save(d)
  console.log("Patch applied: p002, p003, p004 (idempotent).")
}
if (import.meta.url === `file://${process.argv[1]}`) runPatch()