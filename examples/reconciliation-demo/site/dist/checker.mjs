import { canonicalize, calculate, FILES, LABELS, STAMP, PERIOD } from './primitives.mjs';
export { FILES, LABELS, canonicalize };
const wire = value => canonicalize(value) + '\n';
export async function hash(text) {
  const bytes = new TextEncoder().encode(text);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}
export const digest = (role, value) => hash(`verifiable-conformity/v1\n${role}\n${canonicalize(value)}`);
function parse(text) {
  if (typeof text !== 'string' || text.length > 1048577) throw Error('Invalid demo file');
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  const value = JSON.parse(body);
  if (canonicalize(value) !== body) throw Error('Noncanonical demo file');
  return value;
}
export function revise(original, depositsCents, paymentsCents) {
  const candidate = structuredClone(original);
  candidate['reconciling-items.json'] = wire({ periodEnd: PERIOD, depositsInTransitCents: depositsCents, outstandingPaymentsCents: paymentsCents });
  candidate['calculation.json'] = wire(calculate(inputs(candidate)));
  return candidate;
}
function inputs(files) {
  return { statement: parse(files['statement.json']), ledger: parse(files['ledger.json']), items: parse(files['reconciling-items.json']), assumptions: parse(files['assumptions.json']) };
}
// Narrow browser demonstration of this fixed workflow; not a replacement for the
// general canonical-wire verifier. It hashes actual candidate file bytes on click.
export async function check(candidate, manifestWire, anchor, original) {
  try {
    if (JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify([...FILES].sort())) throw Error('Wrong file set');
    const manifest = parse(manifestWire);
    const commitmentMatches = await digest('manifest', manifest) === anchor.expectedCommitment;
    const contextMatches = manifest.protocol === 'verifiable-conformity/v1' && manifest.executionId === anchor.expectedExecutionId && anchor.protocol === 'verifiable-conformity/retained-anchor-v1';
    const adapterMatches = canonicalize(manifest.outputConstraint) === canonicalize({type:'adapter',id:'synthetic-cash-reconciliation',version:'1'});
    const hashes = Object.fromEntries(await Promise.all(FILES.map(async f => [f, await hash(candidate[f])])));
    const reviewedPackageHash = await digest('inputs', Object.fromEntries(FILES.filter(f=>f!=='approval.json').map(f=>[f,hashes[f]])));
    const approval = parse(candidate['approval.json']);
    const approvalMatches = canonicalize(approval) === canonicalize({kind:'simulated-approval', reviewerRole:'Fictional finance reviewer',decision:'simulated-approved',assertedAt:STAMP,reviewedPackageHash});
    const calculation = calculate(inputs(candidate));
    const arithmeticMatches = canonicalize(calculation) === canonicalize(parse(candidate['calculation.json']));
    const specification = {workflow:{id:'synthetic-cash-reconciliation',version:'1'},periodEnd:PERIOD,fileHashes:hashes,reviewedPackageHash};
    const specificationMatches = canonicalize(specification) === canonicalize(manifest.specification);
    const changes = FILES.filter(f=>hashes[f]!==manifest.specification.fileHashes[f]).map(file=>({file,label:LABELS[file],retainedHash:manifest.specification.fileHashes[file],candidateHash:hashes[file]}));
    // Original is display-only: it is never used to decide PASS.
    const differences = [];
    if (original) for (const file of FILES.filter(f=>f.endsWith('.json'))) {
      const before=parse(original[file]), after=parse(candidate[file]);
      for (const key of new Set([...Object.keys(before),...Object.keys(after)])) if (canonicalize(before[key] ?? null)!==canonicalize(after[key] ?? null)) differences.push({file,field:key,before:before[key],after:after[key]});
    }
    const ok=commitmentMatches&&contextMatches&&adapterMatches&&specificationMatches&&approvalMatches&&arithmeticMatches;
    return {ok,status:ok?'PASS':'FAIL',commitmentMatches,contextMatches,adapterMatches,approvalMatches,arithmeticMatches,calculation,changes,differences,hashes};
  } catch { return {ok:false,status:'FAIL',invalid:true,changes:[],differences:[]}; }
}
