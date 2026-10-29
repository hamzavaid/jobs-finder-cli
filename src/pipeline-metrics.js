import {performance} from 'node:perf_hooks';
export class PipelineMetrics {
 constructor(){this.started=performance.now();this.stages=new Map();this.counts={};}
 add(name,value=1){if(Number.isFinite(value))this.counts[name]=(this.counts[name]||0)+value;}
 async stage(name,work){const start=performance.now();try{return await work();}finally{this.stages.set(name,(this.stages.get(name)||0)+performance.now()-start);}}
 snapshot(){return {...this.counts,elapsedMs:Math.round((performance.now()-this.started)*100)/100,stagesMs:Object.fromEntries(this.stages)};}
}
export function pipelineSummary(stats){const m=stats.metrics||{};return `Pipeline: ${m.sourcesSuccessful||0}/${m.sourcesAttempted||0} sources; ${m.boardsVisited||0} boards visited, ${m.boardsSkipped||0} skipped; ${m.completePostings||0} complete, ${m.incompletePostings||0} incomplete candidates; ${stats.duplicatesRemoved||0} confirmed duplicates; ${m.elapsedMs||0} ms${m.httpRequests==null?'':`; ${m.httpRequests} API/index requests, ${m.httpBytes||0} bytes`}.`;}
