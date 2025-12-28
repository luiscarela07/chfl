import fs from "fs/promises"; import path from "path";
const p=path.resolve("data","db.json");
const load=async()=>{try{return JSON.parse(await fs.readFile(p,"utf8"))}catch(e){if(e.code==="ENOENT")return {meta:{migrations:[]},users:[],cases:[]};throw e}};
const save=async(d)=>{const t=p+".tmp";await fs.writeFile(t,JSON.stringify(d,null,2),"utf8");await fs.rename(t,p)};
const d=await load(); d.meta??={migrations:[]}; d.users??=[]; d.cases??=[];
if(!d.meta.migrations.includes("m001_base")){ d.meta.migrations.push("m001_base"); await save(d); console.log("Seed complete."); }
else { console.log("Seed already applied."); }
