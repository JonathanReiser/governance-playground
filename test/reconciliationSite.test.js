const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const core=require('../server/verifiableConformity');
const w=require('../examples/reconciliation-demo/workflow');
const site=path.join(__dirname,'../examples/reconciliation-demo/site/dist');
const fixture=JSON.parse(fs.readFileSync(path.join(site,'fixture.json'),'utf8'));
describe('interactive reconciliation package checker',function(){
 let browser;
 before(async()=>{browser=await import(pathToFileURL(path.join(site,'checker.mjs')).href);});
 for(const [label,d,p,ok,difference] of [['original',400000,550000,true,0],['changed support',400000,500000,false,50000],['changed but balanced',450000,600000,false,0],['custom amount',123456,550000,false,-276544]]) it(`${label} agrees with the independent Node checker`,async()=>{
  const candidate=browser.revise(fixture.original,d,p);
  const result=await browser.check(candidate,fixture.manifestWire,fixture.anchor,fixture.original);
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'reconciliation-web-'));
  try{const files=path.join(tmp,'candidate'),trusted=path.join(tmp,'trusted');fs.mkdirSync(files);fs.mkdirSync(trusted);
   for(const [file,wire] of Object.entries(candidate))fs.writeFileSync(path.join(files,file),wire);
   fs.writeFileSync(path.join(trusted,'manifest.json'),fixture.manifestWire);fs.writeFileSync(path.join(trusted,'anchor.json'),w.json(fixture.anchor));
   const node=w.check(files,trusted);
   assert.equal(result.ok,ok);assert.equal(result.ok,node.report.ok);assert.equal(result.calculation.differenceCents,difference);assert.deepEqual(result.calculation,node.calculation);assert.deepEqual(result.changes.map(c=>c.label),node.changedFiles);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 });
 it('Web Crypto commitments and canonical serialization agree with the existing core',async()=>{
  const value=core.parseCanonical(fixture.manifestWire);
  assert.equal(await browser.digest('manifest',value),core.commitWire(fixture.manifestWire));
  assert.equal(browser.canonicalize({z:1,a:{y:2,x:3}}),core.canonicalize({a:{x:3,y:2},z:1}));
  assert.equal(browser.canonicalize(value),core.canonicalize(value));
 });
 it('retained commitment, context and manifest substitution fail',async()=>{
  const badAnchor={...fixture.anchor,expectedCommitment:'0'.repeat(64)};
  assert.equal((await browser.check(fixture.original,fixture.manifestWire,badAnchor)).ok,false);
  assert.equal((await browser.check(fixture.original,fixture.manifestWire,{...fixture.anchor,expectedExecutionId:'another-run'})).ok,false);
  const manifest=JSON.parse(fixture.manifestWire);manifest.specification.periodEnd='2026-07-31';
  assert.equal((await browser.check(fixture.original,w.json(manifest),fixture.anchor)).ok,false);
 });
 it('every file role is bound, including notes, policy and approval',async()=>{
  for(const file of w.FILES){const edited={...fixture.original};edited[file]+=' ';
   assert.equal((await browser.check(edited,fixture.manifestWire,fixture.anchor)).ok,false,file);}
 });
 it('rejects missing files, stale calculations and invalid amounts',async()=>{
  const missing={...fixture.original};delete missing['approval.json'];assert.equal((await browser.check(missing,fixture.manifestWire,fixture.anchor)).ok,false);
  const stale=browser.revise(fixture.original,400000,500000);stale['calculation.json']=fixture.original['calculation.json'];assert.equal((await browser.check(stale,fixture.manifestWire,fixture.anchor)).arithmeticMatches,false);
  for(const value of [-1,0.5,1e12+1,NaN])assert.throws(()=>browser.revise(fixture.original,value,500000));
 });
 it('regenerated primitives contain the exact existing canonicalizer and calculation functions',()=>{
  const generated=fs.readFileSync(path.join(site,'primitives.mjs'),'utf8');assert.ok(generated.includes(core.canonicalize.toString()));assert.ok(generated.includes(w.calculate.toString()));
 });
});
