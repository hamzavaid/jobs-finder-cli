import {load} from 'cheerio';
export const PUBLIC_JOB_LISTS=Object.freeze(['https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md','https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md']);
/** Links are leads, never synthesized JobPosting records. */
export function extractPublicLinks(body,{base,maxLinks=5000}={}) {
 const links=new Set(),$=load(body||'');const add=value=>{try{const url=new URL(value,base);if(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&url.toString().length<=8192)links.add(url.toString());}catch{}};
 $('a[href]').each((_,el)=>{if(links.size<maxLinks)add($(el).attr('href'));});
 $('loc').each((_,el)=>{if(links.size<maxLinks)add($(el).text());});
 for(const match of String(body||'').matchAll(/\]\((https:\/\/[^\s)]+)\)/g)){if(links.size>=maxLinks)break;add(match[1]);}
 return [...links].slice(0,maxLinks);
}
export function employerCandidate(board,{url,method,employer,now=Date.now()}={}) {
 const timestamp=new Date(now).toISOString();return {...board,tenant:board.id,discoveredUrl:url||null,discoveryMethod:method||'unknown',observedEmployer:employer||null,firstSeenAt:timestamp,lastSeenAt:timestamp,status:'pending'};
}

/** Known public list tables: application cells only; skip promotions and closed rows. */
export function extractJobListLeads(body,{base}={}) {
 const $=load(body||''),links=new Set();
 $('table tbody tr').each((_,row)=>{const cells=$(row).find('td');if(cells.length<4||$(row).text().includes('??'))return;for(const link of extractPublicLinks($(cells[3]).html(),{base}))links.add(link);});
 for(const line of String(body||'').split('\n'))if(line.trim().startsWith('|')&&!line.includes('??'))for(const link of extractPublicLinks(line,{base}))links.add(link);
 return [...links].slice(0,5000);
}
