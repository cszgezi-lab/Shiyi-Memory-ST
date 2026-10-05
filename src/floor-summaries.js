import { SummaryResponseError } from './errors.js';

/** Input rows have already passed the shared source-reference binding. */
export function requireIndependentFloorSummaries(bundle,messages) {
  const rows=Array.isArray(bundle.summaryView)?bundle.summaryView:[];
  const detail={expected:messages.length,received:rows.length,covered:0,invalidRows:0,duplicateCount:0,missingFloors:[],duplicateFloors:[],emptyFloors:[]};
  const matched=new Set();
  for(const message of messages){
    const candidates=rows.filter(row=>row.sourceRefs?.length===1&&row.sourceRefs[0].sourceId===message.id&&row.sourceRefs[0].fragmentId===message.fragmentId);
    for(const row of candidates)matched.add(row);
    if(!candidates.length){detail.missingFloors.push(message.index);continue;}
    if(candidates.length!==1){detail.duplicateFloors.push(message.index);detail.duplicateCount+=candidates.length-1;continue;}
    const row=candidates[0];
    if(!['text','description','summary','content'].some(key=>typeof row[key]==='string'&&row[key].trim())){detail.emptyFloors.push(message.index);continue;}
    // The verified source reference determines the absolute host floor, not
    // row position or a model-generated floor number.
    row.floorIndex=message.index;detail.covered++;
  }
  detail.invalidRows=rows.length-matched.size;
  if(detail.covered!==detail.expected||detail.received!==detail.expected){
    const error=new SummaryResponseError('independent floor summaries failed coverage checks',detail);
    error.code='FLOOR_SUMMARY_MISSING';throw error;
  }
  return detail;
}
