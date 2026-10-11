/** Only server-resolved fields go in this prompt. No project names, user notes or raw references. */
import {FIELDS,resolveEdits,type Capabilities,type Observations} from './edit-plan.js';
const labels:Record<string,string>={bodyColor:'body paint color',wheelColor:'wheel finish color',bodyFinish:'body paint surface finish',wheelDesign:'generic wheel spoke design',white:'white',black:'black',silver:'silver',graphite:'graphite',blue:'deep blue',green:'forest green',red:'ruby red',yellow:'yellow',bronze:'warm bronze',gloss:'gloss',satin:'satin',matte:'matte',sport_multi_spoke:'generic sport multi-spoke wheels',classic_mesh:'generic classic mesh wheels'};
export function buildEditPrompt(raw:unknown,cap:Capabilities,base:Observations={}):string{
 const plan=resolveEdits(raw,cap,base);
 const lines=['Edit the supplied primary car photo. Keep the same vehicle identity, door count, windows, lights, visible badges, camera angle, composition, lighting and background. Keep the entire visible vehicle in frame.',
 'Do not invent hidden vehicle details or change the visible steering side or license plate layout. This is a visual concept, not a real product fitment specification.'];
 for(const c of plan.changes)lines.push(c.action==='restore_original'?`Restore only the ${labels[c.field]} from the separately supplied original reference photo; do not adopt its camera or background.`:`Change only the ${labels[c.field]} to ${labels[c.value!]}.`);
 if(plan.changes.some(c=>c.field==='wheelDesign'))lines.push('Change the visible wheel spoke appearance only. Keep wheel center positions, apparent outer diameter, tire geometry, axle position and stance unchanged. No brand, dimensions or fitment claims.');
 else lines.push('Keep existing wheel spoke structure, tire geometry and stance unchanged.');
 for(const field of FIELDS.filter(f=>plan.preserve.includes(f)))lines.push(`Preserve the current ${labels[field]}.`);
 lines.push('Do not add a body kit, spoiler, decals, people or scene objects.');
 return lines.join(' ');
}
