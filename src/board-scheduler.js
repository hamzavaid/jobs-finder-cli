import {normalizeCompany} from './filters.js';import {normalizeText} from './relevance.js';import {stableKey} from './cache.js';import {boardKey} from './ats/shared.js';
export const boardQueryKey=options=>stableKey({search:normalizeText(options.search),company:normalizeCompany(options.company),location:normalizeText(options.location)});
export function scheduleBoards(snapshots,options,{now=Date.now(),budget=64}={}) {
 const query=boardQueryKey(options),time=value=>Date.parse(value)||0;
 const priority=item=>{const b=item.board,age=Math.max(0,(now-time(b.lastJobFetchAt))/86400000);const history=b.queryStats?.[query];const decay=history?Math.exp(-Math.max(0,now-time(history.at))/(7*86400000)):0;
 return (options.company&&normalizeCompany(b.company||b.observedEmployer||b.id)===normalizeCompany(options.company)?10000:0)+Math.min(age,365)*10+(history?.matches||0)*decay*5+(b.successfulCollections?2:0)+(b.recentPostingCount||0)*0.1;
 };
 const compare=(a,b)=>priority(b)-priority(a)||boardKey(a.board).localeCompare(boardKey(b.board));
 const cooling=item=>Date.parse(item.board.retryAt)>now;
 const eligible=snapshots.filter(item=>!cooling(item));
 const unexplored=eligible.filter(s=>!s.board.lastJobFetchAt).sort((a,b)=>boardKey(a.board).localeCompare(boardKey(b.board)));
 const reserve=unexplored.slice(0,Math.ceil(budget*.25)),reserved=new Set(reserve);
 return [...reserve,...eligible.filter(s=>!reserved.has(s)).sort(compare),...snapshots.filter(cooling).sort(compare)];
}
export function observeBoard(board,options,matches,now) {
 const queryStats={...(board.queryStats||{}),[boardQueryKey(options)]:{matches,at:new Date(now).toISOString()}};
 const latest=Object.entries(queryStats).sort((a,b)=>Date.parse(b[1].at)-Date.parse(a[1].at)).slice(0,8);
 return {...board,queryStats:Object.fromEntries(latest)};
}
