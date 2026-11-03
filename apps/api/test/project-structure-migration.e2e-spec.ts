import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// Use pg-boss's existing PostgreSQL driver; exercise the migration on genuine old tables.
const { Client } = createRequire(require.resolve('pg-boss'))('pg');

describe('Legacy project structure migration', () => {
 it('preserves independent Epic identities, old codes, testcase IDs and item keys', async () => {
  const client=new Client({connectionString:process.env.TEST_DATABASE_URL});
  await client.connect();
  const schema=`structure_migration_${Date.now()}`;
  try {
   await client.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}",public`);
   const root=path.join(__dirname,'../prisma/migrations');
   for(const dir of readdirSync(root).filter(d=>/^000[1-7]_/.test(d)).sort()) await client.query(readFileSync(path.join(root,dir,'migration.sql'),'utf8'));
   await client.query(`
    INSERT INTO projects(key,name) VALUES('OLD','Legacy');
    INSERT INTO workflow_statuses(project_id,name,category,position) VALUES(1,'Todo','todo',0);
    INSERT INTO workflow_settings(project_id,initial_manual_status_id,initial_auto_status_id) VALUES(1,1,1);
    INSERT INTO labels(project_id,name,is_system) VALUES(1,'manual',true);
    INSERT INTO issues(project_id,number,type,title,status_id,rank) VALUES(1,7,'epic','Same name',1,'a0');
    INSERT INTO requirements(project_id,kind,code,name,rank) VALUES(1,'epic','OLD-E','Same name','a0'),(1,'function','OLD-F','Old function','a1'),(1,'epic','WORK-EPIC-1','Collision test','a2');
    INSERT INTO requirements(project_id,kind,code,name,rank,deleted_at) VALUES(1,'epic','LONG-OLD',repeat('L',300),'a3',now());
    INSERT INTO requirement_links(epic_id,function_id) VALUES(1,2);
    INSERT INTO test_cases(project_id,function_id,seq,code,title,rank) VALUES(1,2,1,'CL_OLD-F-001','Historical case','a0');
   `);
   await client.query(readFileSync(path.join(root,'0008_project_structure/migration.sql'),'utf8'));
   const epics=(await client.query(`SELECT * FROM requirements WHERE kind='epic' ORDER BY id`)).rows;
   expect(epics).toHaveLength(4);
   expect(new Set(epics.map((e:any)=>e.epic_issue_id)).size).toBe(4);
   expect(epics.find((e:any)=>e.code==='OLD-E')).toMatchObject({id:'1',name:'Same name'});
   expect(epics.find((e:any)=>e.epic_issue_id==='1').code).toBe('WORK-EPIC-1-');
   expect((await client.query(`SELECT number,title FROM issues WHERE id=1`)).rows[0]).toEqual({number:'7',title:'Same name'});
   expect((await client.query(`SELECT id,code,function_id FROM test_cases`)).rows[0]).toEqual({id:'1',code:'CL_OLD-F-001',function_id:'2'});
   expect((await client.query(`SELECT * FROM requirement_links`)).rows).toEqual([{epic_id:'1',function_id:'2'}]);
   expect((await client.query(`SELECT module_id FROM requirements WHERE id=2`)).rows[0].module_id).toBeNull();
   expect((await client.query(`SELECT name,deleted_at FROM requirements WHERE code='LONG-OLD'`)).rows[0].name).toHaveLength(300);
   await client.query(`INSERT INTO requirements(project_id,kind,code,name,rank) VALUES(1,'epic','NEW-E','New Epic','a4')`);
   expect((await client.query(`SELECT COUNT(*) FROM requirements WHERE kind='epic' AND epic_issue_id IS NOT NULL`)).rows[0].count).toBe('5');
  } finally {
   await client.query(`SET search_path TO public; DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
   await client.end();
  }
 });
});
