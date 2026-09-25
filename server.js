import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();
const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized:false } : undefined });

app.use(express.json({ limit:'1mb' }));
const PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({ pool, createTableIfMissing:true }),
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave:false,
  saveUninitialized:false,
  cookie:{ httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV==='production', maxAge:1000*60*60*8 }
}));
app.use(express.static(path.join(__dirname,'public')));

const defaultSkills={Observation:50,Recall:50,Explanation:50,'Error Detection':50,Correction:50,Application:50,Transfer:50,Persistence:50,'Confidence calibration':50};
async function query(text, params=[]){ const r=await pool.query(text,params); return r; }
async function initDb(){
  const sql=fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');
  await query(sql);
  const demoEmail='teacher@questprint.local';
  const existing=await query('SELECT id FROM users WHERE email=$1',[demoEmail]);
  if(!existing.rowCount){
    const hash=await bcrypt.hash('Teacher123!',12);
    const u=await query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'teacher') RETURNING id",['Demo Teacher',demoEmail,hash]);
    await query('INSERT INTO curriculum_objectives(teacher_id,title,subject,grade_level,description,standard_code,evidence_of_learning,difficulty,published) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)',[u.rows[0].id,'Explain how plants depend on sunlight','Science','Grade 4','Students explain why sunlight matters for plant growth and use evidence from a simple observation.','SCI.4.LS1','Learner explains the relationship and transfers it to a new plant scenario.','developing']);
  }
  const studentEmail='student@questprint.local';
  const s=await query('SELECT id FROM users WHERE email=$1',[studentEmail]);
  if(!s.rowCount){
    const hash=await bcrypt.hash('Student123!',12);
    const u=await query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'student') RETURNING id",['Sara Demo',studentEmail,hash]);
    await query('INSERT INTO learners(user_id,xp,streak) VALUES($1,1240,4)',[u.rows[0].id]);
    for(const [skill,score] of Object.entries({...defaultSkills,Observation:82,Recall:91,Explanation:67,'Error Detection':74,Correction:88,Application:79,Transfer:61,Persistence:94,'Confidence calibration':68})) await query('INSERT INTO skills(learner_id,skill,score) VALUES($1,$2,$3)',[u.rows[0].id,skill,score]);
  }
  const demoTeacher=await query('SELECT id FROM users WHERE email=$1',['teacher@questprint.local']);
  const demoStudent=await query('SELECT id FROM users WHERE email=$1',['student@questprint.local']);
  const demoObj=await query('SELECT id FROM curriculum_objectives WHERE teacher_id=$1 ORDER BY created_at LIMIT 1',[demoTeacher.rows[0].id]);
  if(demoTeacher.rowCount && demoStudent.rowCount && demoObj.rowCount){
    await query("INSERT INTO privacy_preferences(user_id) VALUES($1),($2) ON CONFLICT DO NOTHING",[demoTeacher.rows[0].id,demoStudent.rows[0].id]);
    for(const uid of [demoTeacher.rows[0].id,demoStudent.rows[0].id]) for(const type of ['terms','privacy']) await query("INSERT INTO privacy_consents(user_id,consent_type,version,granted,granted_at) VALUES($1,$2,'1.0',true,NOW()) ON CONFLICT(user_id,consent_type,version) DO NOTHING",[uid,type]);
    let cls=await query('SELECT id FROM classes WHERE teacher_id=$1 ORDER BY created_at LIMIT 1',[demoTeacher.rows[0].id]);
    if(!cls.rowCount){cls=await query("INSERT INTO classes(teacher_id,name,subject,grade_level,join_code) VALUES($1,'Demo Grade 4 Science','Science','Grade 4','SCI4QP') RETURNING id",[demoTeacher.rows[0].id]);}
    await query("INSERT INTO class_memberships(class_id,student_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[cls.rows[0].id,demoStudent.rows[0].id]);
    await query("INSERT INTO class_objectives(class_id,objective_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[cls.rows[0].id,demoObj.rows[0].id]);
  }
}
function auth(req,res,next){ if(!req.session.user) return res.status(401).json({error:'Authentication required'}); next(); }
function role(role){ return (req,res,next)=>{ if(req.session.user?.role!==role) return res.status(403).json({error:`${role} role required`}); next(); }; }

app.get('/api/health',async(req,res)=>{ try{await query('SELECT 1');res.json({ok:true,service:'QuestPrint',database:'postgresql',aiConfigured:Boolean(process.env.OPENAI_API_KEY)});}catch(e){res.status(503).json({ok:false,database:'unavailable'});} });
app.post('/api/auth/register',async(req,res)=>{
  const {name,email,password,role:requestedRole='student'}=req.body||{};
  const roleValue=requestedRole==='teacher'?'teacher':'student';
  if(roleValue==='teacher' && process.env.TEACHER_INVITE_CODE && req.body.teacherInviteCode!==process.env.TEACHER_INVITE_CODE) return res.status(403).json({error:'A valid teacher invite code is required.'});
  if(!name||!email||!password||password.length<8) return res.status(400).json({error:'Name, email and a password of at least 8 characters are required.'});
  try{ const hash=await bcrypt.hash(password,12); const u=await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role',[name,email.toLowerCase().trim(),hash,roleValue]); if(roleValue==='student'){await query('INSERT INTO learners(user_id,xp,streak) VALUES($1,0,0)',[u.rows[0].id]); for(const [k,v] of Object.entries(defaultSkills)) await query('INSERT INTO skills(learner_id,skill,score) VALUES($1,$2,$3)',[u.rows[0].id,k,v]);} req.session.user=u.rows[0]; res.status(201).json({user:u.rows[0]}); }catch(e){res.status(e.code==='23505'?409:500).json({error:e.code==='23505'?'Email already registered.':'Registration failed.'});}
});
app.post('/api/auth/login',async(req,res)=>{ const {email,password}=req.body||{}; if(!email||!password)return res.status(400).json({error:'Email and password are required.'}); const r=await query('SELECT id,name,email,password_hash,role FROM users WHERE email=$1',[email.toLowerCase().trim()]); if(!r.rowCount||!(await bcrypt.compare(password,r.rows[0].password_hash)))return res.status(401).json({error:'Invalid email or password.'}); const {password_hash,...user}=r.rows[0]; req.session.user=user; res.json({user}); });
app.post('/api/auth/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/auth/me',async(req,res)=>{if(!req.session.user)return res.status(401).json({error:'Not signed in'});res.json({user:req.session.user});});

app.get('/api/privacy/me',auth,async(req,res)=>{
  const p=await query('SELECT analytics_enabled,ai_personalization_enabled,research_data_opt_in,updated_at FROM privacy_preferences WHERE user_id=$1',[req.session.user.id]);
  const c=await query('SELECT consent_type,version,granted,granted_at,withdrawn_at FROM privacy_consents WHERE user_id=$1 ORDER BY created_at DESC',[req.session.user.id]);
  res.json({preferences:p.rows[0]||{analytics_enabled:true,ai_personalization_enabled:true,research_data_opt_in:false},consents:c.rows});
});
app.post('/api/privacy/consent',auth,async(req,res)=>{
  const {terms,privacy,aiPersonalization=true,researchData=false,version='1.0'}=req.body||{};
  if(terms!==true||privacy!==true)return res.status(400).json({error:'Terms and Privacy Notice consent are required to use QuestPrint.'});
  const uid=req.session.user.id, client=await pool.connect();
  try{await client.query('BEGIN');
    for(const [type,granted] of [['terms',true],['privacy',true],['ai_personalization',Boolean(aiPersonalization)],['research_data',Boolean(researchData)]]){
      await client.query("INSERT INTO privacy_consents(user_id,consent_type,version,granted,granted_at,withdrawn_at) VALUES($1,$2,$3,$4,CASE WHEN $4 THEN NOW() ELSE NULL END,CASE WHEN $4 THEN NULL ELSE NOW() END) ON CONFLICT(user_id,consent_type,version) DO UPDATE SET granted=EXCLUDED.granted,granted_at=EXCLUDED.granted_at,withdrawn_at=EXCLUDED.withdrawn_at,created_at=NOW()",[uid,type,version,granted]);
    }
    await client.query("INSERT INTO privacy_preferences(user_id,analytics_enabled,ai_personalization_enabled,research_data_opt_in) VALUES($1,true,$2,$3) ON CONFLICT(user_id) DO UPDATE SET ai_personalization_enabled=EXCLUDED.ai_personalization_enabled,research_data_opt_in=EXCLUDED.research_data_opt_in,updated_at=NOW()",[uid,Boolean(aiPersonalization),Boolean(researchData)]);
    await client.query('COMMIT'); res.json({ok:true});
  }catch(e){await client.query('ROLLBACK');res.status(500).json({error:'Could not save privacy preferences.'});}finally{client.release();}
});
app.patch('/api/privacy/preferences',auth,async(req,res)=>{
  const {analyticsEnabled,aiPersonalizationEnabled,researchDataOptIn}=req.body||{};
  if([analyticsEnabled,aiPersonalizationEnabled,researchDataOptIn].every(v=>v===undefined))return res.status(400).json({error:'No preference changes supplied.'});
  await query("INSERT INTO privacy_preferences(user_id,analytics_enabled,ai_personalization_enabled,research_data_opt_in) VALUES($1,COALESCE($2,true),COALESCE($3,true),COALESCE($4,false)) ON CONFLICT(user_id) DO UPDATE SET analytics_enabled=COALESCE($2,privacy_preferences.analytics_enabled),ai_personalization_enabled=COALESCE($3,privacy_preferences.ai_personalization_enabled),research_data_opt_in=COALESCE($4,privacy_preferences.research_data_opt_in),updated_at=NOW()",[req.session.user.id,analyticsEnabled,aiPersonalizationEnabled,researchDataOptIn]);
  res.json({ok:true});
});
app.delete('/api/privacy/data',auth,async(req,res)=>{ const uid=req.session.user.id; await query('DELETE FROM users WHERE id=$1',[uid]); req.session.destroy(()=>res.json({ok:true,message:'Your account and associated learning data were deleted.'})); });

app.get('/api/learner/me',auth,consented,role('student'),async(req,res)=>{ const u=req.session.user; const l=await query('SELECT u.id,u.name,l.xp,l.streak FROM users u JOIN learners l ON l.user_id=u.id WHERE u.id=$1',[u.id]); const skills=await query('SELECT skill,score FROM skills WHERE learner_id=$1 ORDER BY skill',[u.id]); res.json({...l.rows[0],skills:Object.fromEntries(skills.rows.map(x=>[x.skill,x.score]))}); });
app.get('/api/objectives',auth,consented,async(req,res)=>{ let r; if(req.session.user.role==='teacher') r=await query('SELECT * FROM curriculum_objectives WHERE teacher_id=$1 ORDER BY created_at DESC',[req.session.user.id]); else r=await query(`SELECT DISTINCT o.*,u.name AS teacher_name FROM curriculum_objectives o JOIN users u ON u.id=o.teacher_id JOIN class_objectives co ON co.objective_id=o.id JOIN class_memberships cm ON cm.class_id=co.class_id WHERE cm.student_id=$1 AND cm.status='active' AND o.published=true ORDER BY o.created_at DESC`,[req.session.user.id]); res.json(r.rows); });
app.post('/api/objectives',auth,consented,role('teacher'),async(req,res)=>{ const {title,subject,gradeLevel,description,standardCode,evidenceOfLearning,difficulty='developing',published=false}=req.body||{}; if(!title||!subject||!gradeLevel||!description)return res.status(400).json({error:'Title, subject, grade level and description are required.'}); const r=await query('INSERT INTO curriculum_objectives(teacher_id,title,subject,grade_level,description,standard_code,evidence_of_learning,difficulty,published) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[req.session.user.id,title,subject,gradeLevel,description,standardCode||null,evidenceOfLearning||null,difficulty,Boolean(published)]); res.status(201).json(r.rows[0]); });
app.patch('/api/objectives/:id',auth,consented,role('teacher'),async(req,res)=>{ const {published}=req.body||{}; const r=await query('UPDATE curriculum_objectives SET published=COALESCE($1,published),updated_at=NOW() WHERE id=$2 AND teacher_id=$3 RETURNING *',[published===undefined?null:Boolean(published),req.params.id,req.session.user.id]); if(!r.rowCount)return res.status(404).json({error:'Objective not found'}); res.json(r.rows[0]); });
app.delete('/api/objectives/:id',auth,consented,role('teacher'),async(req,res)=>{const r=await query('DELETE FROM curriculum_objectives WHERE id=$1 AND teacher_id=$2 RETURNING id',[req.params.id,req.session.user.id]);if(!r.rowCount)return res.status(404).json({error:'Objective not found'});res.json({ok:true});});

app.get('/api/classes',auth,consented,async(req,res)=>{
  if(req.session.user.role==='teacher'){
    const r=await query(`SELECT c.*,COUNT(DISTINCT cm.student_id) FILTER (WHERE cm.status='active')::int AS student_count,COUNT(DISTINCT co.objective_id)::int AS objective_count FROM classes c LEFT JOIN class_memberships cm ON cm.class_id=c.id LEFT JOIN class_objectives co ON co.class_id=c.id WHERE c.teacher_id=$1 GROUP BY c.id ORDER BY c.created_at DESC`,[req.session.user.id]); return res.json(r.rows);
  }
  const r=await query(`SELECT c.id,c.name,c.subject,c.grade_level,c.join_code,c.teacher_id,u.name AS teacher_name,cm.joined_at FROM classes c JOIN class_memberships cm ON cm.class_id=c.id JOIN users u ON u.id=c.teacher_id WHERE cm.student_id=$1 AND cm.status='active' ORDER BY cm.joined_at DESC`,[req.session.user.id]); res.json(r.rows);
});
app.post('/api/classes',auth,consented,role('teacher'),async(req,res)=>{
  const {name,subject='',gradeLevel=''}=req.body||{}; if(!name)return res.status(400).json({error:'Class name is required.'});
  let code=''; for(let i=0;i<10;i++){code=Math.random().toString(36).slice(2,8).toUpperCase(); const x=await query('SELECT 1 FROM classes WHERE join_code=$1',[code]); if(!x.rowCount)break;}
  const r=await query('INSERT INTO classes(teacher_id,name,subject,grade_level,join_code) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.session.user.id,name,subject,gradeLevel,code]); res.status(201).json(r.rows[0]);
});
app.post('/api/classes/join',auth,consented,role('student'),async(req,res)=>{
  const {joinCode}=req.body||{}; if(!joinCode)return res.status(400).json({error:'Join code is required.'});
  const c=await query('SELECT id,name,subject,grade_level,teacher_id FROM classes WHERE join_code=$1 AND archived_at IS NULL',[joinCode.toUpperCase().trim()]); if(!c.rowCount)return res.status(404).json({error:'Class not found or archived.'});
  try{await query("INSERT INTO class_memberships(class_id,student_id,status) VALUES($1,$2,'active') ON CONFLICT(class_id,student_id) DO UPDATE SET status='active'",[c.rows[0].id,req.session.user.id]); res.json(c.rows[0]);}catch(e){res.status(500).json({error:'Could not join class.'});}
});
app.get('/api/classes/:id',auth,consented,async(req,res)=>{
  const c=await query('SELECT c.*,u.name AS teacher_name FROM classes c JOIN users u ON u.id=c.teacher_id WHERE c.id=$1',[req.params.id]); if(!c.rowCount)return res.status(404).json({error:'Class not found'});
  const allowed=req.session.user.role==='teacher' ? c.rows[0].teacher_id===req.session.user.id : (await query("SELECT 1 FROM class_memberships WHERE class_id=$1 AND student_id=$2 AND status='active'",[req.params.id,req.session.user.id])).rowCount>0; if(!allowed)return res.status(403).json({error:'You do not have access to this class.'});
  const students=await query(`SELECT u.id,u.name,u.email,cm.joined_at FROM class_memberships cm JOIN users u ON u.id=cm.student_id WHERE cm.class_id=$1 AND cm.status='active' ORDER BY u.name`,[req.params.id]);
  const objectives=await query(`SELECT o.* FROM class_objectives co JOIN curriculum_objectives o ON o.id=co.objective_id WHERE co.class_id=$1 ORDER BY co.created_at DESC`,[req.params.id]);
  res.json({class:c.rows[0],students:students.rows,objectives:objectives.rows});
});
app.post('/api/classes/:id/objectives',auth,consented,role('teacher'),async(req,res)=>{const {objectiveId}=req.body||{}; if(!objectiveId)return res.status(400).json({error:'objectiveId is required'}); const own=await query('SELECT id FROM curriculum_objectives WHERE id=$1 AND teacher_id=$2',[objectiveId,req.session.user.id]); const cls=await query('SELECT id FROM classes WHERE id=$1 AND teacher_id=$2',[req.params.id,req.session.user.id]); if(!own.rowCount||!cls.rowCount)return res.status(404).json({error:'Class or objective not found.'}); await query('INSERT INTO class_objectives(class_id,objective_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.params.id,objectiveId]); res.json({ok:true});});
app.delete('/api/classes/:id/students/:studentId',auth,consented,role('teacher'),async(req,res)=>{const r=await query(`UPDATE class_memberships cm SET status='removed' FROM classes c WHERE cm.class_id=c.id AND cm.class_id=$1 AND cm.student_id=$2 AND c.teacher_id=$3 RETURNING cm.student_id`,[req.params.id,req.params.studentId,req.session.user.id]);if(!r.rowCount)return res.status(404).json({error:'Enrollment not found.'});res.json({ok:true});});

app.post('/api/events',auth,consented,role('student'),async(req,res)=>{ const {type,payload={},objectiveId=null,classId=null}=req.body||{}; if(!type)return res.status(400).json({error:'Event type is required'}); const id=req.session.user.id; const xp={correct_answer:20,incorrect_answer:2,quest_completed:25}[type]||0; const skill=payload.skill; const client=await pool.connect(); try{await client.query('BEGIN'); if(classId){const m=await client.query("SELECT 1 FROM class_memberships WHERE class_id=$1 AND student_id=$2 AND status='active'",[classId,id]); if(!m.rowCount) throw new Error('Student is not enrolled in this class.');}
 await client.query('INSERT INTO learning_events(learner_id,objective_id,class_id,type,payload) VALUES($1,$2,$3,$4,$5)',[id,objectiveId,classId,type,payload]); if(xp)await client.query('UPDATE learners SET xp=xp+$1,updated_at=NOW() WHERE user_id=$2',[xp,id]); if(skill){const delta=type==='correct_answer'?5:2;await client.query(`INSERT INTO skills(learner_id,skill,score) VALUES($1,$2,$3) ON CONFLICT(learner_id,skill) DO UPDATE SET score=LEAST(100,GREATEST(0,skills.score+$4)),updated_at=NOW()`,[id,skill,delta,delta]);} await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();} const l=await query('SELECT u.id,u.name,l.xp,l.streak FROM users u JOIN learners l ON l.user_id=u.id WHERE u.id=$1',[id]); const skills=await query('SELECT skill,score FROM skills WHERE learner_id=$1',[id]); res.json({...l.rows[0],skills:Object.fromEntries(skills.rows.map(x=>[x.skill,x.score]))}); });

const openai=process.env.OPENAI_API_KEY?new OpenAI({apiKey:process.env.OPENAI_API_KEY}):null;
app.post('/api/ai/quest',auth,consented,role('student'),async(req,res)=>{ if(!openai)return res.status(503).json({error:'OPENAI_API_KEY is not configured on the server.'}); const pref=await query('SELECT ai_personalization_enabled FROM privacy_preferences WHERE user_id=$1',[req.session.user.id]); if(pref.rowCount && !pref.rows[0].ai_personalization_enabled)return res.status(403).json({error:'AI personalization is disabled in your privacy settings.'}); const {objectiveId}=req.body||{}; if(!objectiveId)return res.status(400).json({error:'objectiveId is required'}); const o=await query('SELECT * FROM curriculum_objectives WHERE id=$1 AND published=true',[objectiveId]); if(!o.rowCount)return res.status(404).json({error:'Published objective not found'}); const l=await query('SELECT u.name,l.xp,l.streak FROM users u JOIN learners l ON l.user_id=u.id WHERE u.id=$1',[req.session.user.id]); const s=await query('SELECT skill,score FROM skills WHERE learner_id=$1',[req.session.user.id]); const objective=o.rows[0]; const learner={...l.rows[0],skills:Object.fromEntries(s.rows.map(x=>[x.skill,x.score]))}; const system=`You are QuestPrint's curriculum-safe quest designer for K-12 learners. Generate one playful adaptive mission from the teacher-authored curriculum objective. Do not diagnose, rank, shame, or make intelligence claims. Preserve the teacher objective. Include productive recovery after mistakes. Return JSON with exactly: title, mission, adaptive_rule, transfer_prompt, success_evidence, recovery_reward. Each field must be concise.`; try{const response=await openai.responses.create({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',input:[{role:'system',content:system},{role:'user',content:JSON.stringify({objective:{title:objective.title,subject:objective.subject,grade:objective.grade_level,description:objective.description,evidence:objective.evidence_of_learning,difficulty:objective.difficulty},learner})}],text:{format:{type:'json_object'}}});const parsed=JSON.parse(response.output_text);await query('INSERT INTO learning_events(learner_id,objective_id,type,payload) VALUES($1,$2,$3,$4)',[req.session.user.id,objective.id,'ai_quest_generated',parsed]);res.json({objective,quest:parsed});}catch(e){console.error(e);res.status(502).json({error:'The AI service could not generate a valid quest.'});} });

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
initDb().then(()=>app.listen(PORT,()=>console.log(`QuestPrint pilot running on http://localhost:${PORT}`))).catch(err=>{console.error('Database initialization failed:',err);process.exit(1)});
