import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOptions,evaluateJob,makeSearchUrl} from '../src/filters.js';
import {findJobs} from '../src/search.js';
import {CacheManager} from '../src/cache.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {serializeJobs} from '../src/output.js';
import {parseJobDetail} from '../src/parser.js';
const options=extra=>normalizeOptions({search:'Software Engineer',website:'LinkedIn',pages:1,...extra});
const stamp=Date.parse('2026-10-29T12:00:00Z');
const card=(id,title,company='TikTok')=>`<li data-entity-urn="urn:li:jobPosting:${id}"><div class="base-search-card"><a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/${id}/"><h3>${title}</h3></a><h4>${company}</h4><span class="job-search-card__location">Los Angeles, CA (Remote)</span><time datetime="2026-10-29T10:00:00Z">2 hours ago</time></div></li>`;
const detail=(title,seniority='Entry level',employment='Full-time',company='TikTok')=>`<h1 class="topcard__title">${title}</h1><a class="topcard__org-name-link">${company}</a><div class="description__text">Build software systems as a Software Engineer.</div><li class="description__job-criteria-item"><h3>Seniority level</h3><span>${seniority}</span></li><li class="description__job-criteria-item"><h3>Employment type</h3><span>${employment}</span></li>`;

test('entry never accepts Senior, Staff or Principal titles even when entry facet or metadata contradicts',()=> {
 for(const title of ['Senior Software Engineer','Staff Software Engineer','Senior Software Engineer II','Principal Software Engineer']) {
  for(const seniorityLevel of [null,'Entry level','Mid-Senior level'])assert.equal(evaluateJob({source:'LinkedIn',title,seniorityLevel},options({experience:'entry'})).match,false,title);
 }
 for(const title of ['Junior Software Engineer','Entry Level Software Engineer'])assert.equal(evaluateJob({source:'LinkedIn',title},options({experience:'entry'})).match,true,title);
 for(const title of ['Software Engineer','Software Engineer II','Software Engineer Intern'])assert.equal(evaluateJob({source:'LinkedIn',title},options({experience:'entry'})).match,false,title);
 assert.equal(evaluateJob({source:'LinkedIn',title:'Junior Software Engineer'},options({experience:'entry',strict:true})).match,false);
 assert.equal(evaluateJob({source:'LinkedIn',title:'Junior Software Engineer',seniorityLevel:'Entry / Senior'},options({experience:'entry'})).match,false);
});
test('unknown constraints are excluded even when upstream declares corresponding facets',()=> {
 for(const extra of [{experience:'entry'},{employment:'internship'},{remote:'true'},{remote:'false'},{workplace:'onsite'},{date:'1d'},{under:'true'},{under:'false'},{verified:'true'},{verified:'false'},{location:'Los Angeles'}]) {
  assert.equal(evaluateJob({source:'LinkedIn',title:'Software Engineer'},options(extra),stamp).match,false,JSON.stringify(extra));
 }
});
test('LinkedIn keywords include company and targeted entry hint once, while retaining parameter encodings',()=> {
 const url=new URL(makeSearchUrl(options({company:'TikTok',experience:'entry',employment:'full-time',remote:'false',under:'false',date:'1d'})));
 assert.match(url.searchParams.get('keywords'),/TikTok/);assert.match(url.searchParams.get('keywords'),/entry-level/);
 assert.equal(url.searchParams.get('f_E'),'2');assert.equal(url.searchParams.get('f_JT'),'F');assert.equal(url.searchParams.get('f_WT'),'1,3');assert.equal(url.searchParams.get('f_TPR'),'r86400');assert.equal(url.searchParams.has('f_EA'),false);
 assert.equal((new URL(makeSearchUrl(options({search:'Software Engineer TikTok entry-level',company:'TikTok',experience:'entry'}))).searchParams.get('keywords').match(/TikTok/g)||[]).length,1);
});
test('TikTok retrieval hint recovers employer cards and never accepts incidental company mentions',async()=> {
 const requests=[];const http={get:async url=>{requests.push(url);return url.includes('jobPosting/')?detail('Software Engineer'):new URL(url).searchParams.get('keywords').includes('TikTok')?card('100001','Software Engineer')+card('100002','TikTok Software Engineer','Recruiter LLC'):card('100003','Software Engineer','Other Employer');}};
 const result=await findJobs(options({company:'TikTok'}),http,{cache:false,now:()=>stamp});assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].company,'TikTok');assert.equal(requests.length,1);
});
test('ignored experience facet rejects contradictions before details and resolves only missing candidate metadata',async()=> {
 const titles=['Senior Software Engineer','Staff Software Engineer','Software Engineer II','Junior Software Engineer','Software Engineer'];let requests=0;
 const http={get:async url=>{requests++;return url.includes('jobPosting/')?detail('Software Engineer II'):titles.map((title,index)=>card(String(100001+index),title)).join('');}};
 const result=await findJobs(options({experience:'entry'}),http,{cache:false,now:()=>stamp});
 assert.ok(result.jobs.every(job=>!/^Senior|^Staff|^Principal/.test(job.title)));assert.equal(result.jobs.length,3);assert.equal(requests,3);
});
test('combined observed constraints reject employer, employment, workplace, date and count contradictions',async()=> {
 const good={source:'LinkedIn',title:'Software Engineer',company:'TikTok Inc.',seniorityLevel:'Entry level',employmentType:'Internship',workplace:'remote',location:'Los Angeles, CA',postedAt:'2026-10-29T10:00:00Z',datePrecision:'instant',underTenApplicants:true,verified:true};
 const opts=options({company:'TikTok',experience:'entry',employment:'internship',remote:'true',location:'Los Angeles',date:'1d',under:'true',verified:'true'});
 assert.equal(evaluateJob(good,opts,stamp).match,true);
 for(const change of [{company:'TikTok Recruiters'},{employmentType:'Full-time'},{workplace:'onsite'},{postedAt:'2026-10-27T10:00:00Z'},{underTenApplicants:null},{verified:null},{location:'Sydney, Australia'}]) assert.equal(evaluateJob({...good,...change},opts,stamp).match,false,JSON.stringify(change));
 const result=await findJobs(options({under:'true'}),{get:async url=>url.includes('jobPosting/')?detail('Software Engineer')+'<span class="num-applicants__caption">8 applicants</span>':card('100001','Software Engineer')},{cache:false});
 assert.equal(result.jobs.length,1);assert.deepEqual(result.stats.providers.LinkedIn.unsupportedFilters,[]);
});

test('every experience and employment choice requires coherent observed evidence',()=> {
 for(const [experience,seniorityLevel] of [['internship','Internship'],['entry','Entry level'],['junior','Entry level'],['associate','Associate'],['senior','Mid-Senior level'],['director','Director'],['executive','Executive']]) {
  const opts=options({experience,strict:true});assert.equal(evaluateJob({seniorityLevel,title:'Software Engineer'},opts).match,true,experience);
  assert.equal(evaluateJob({seniorityLevel:null,title:'Software Engineer II'},opts).match,false,experience);
 }
 for(const [employment,employmentType] of [['full-time','FULL_TIME'],['part-time','Part time'],['contract','Contract'],['temporary','Temporary'],['internship','Internship'],['volunteer','Volunteer'],['other','Other']]) {
  assert.equal(evaluateJob({employmentType},options({employment})).match,true,employment);
  assert.equal(evaluateJob({employmentType:'Unknown'},options({employment})).match,false,employment);
 }
 assert.equal(evaluateJob({applicantCount:20,underTenApplicants:true},options({under:'true'})).match,false);
 assert.equal(evaluateJob({applicantCount:8},options({under:'true'})).match,true);
 assert.equal(evaluateJob({company:'TikTok',companyEvidence:'board-identifier'},options({company:'TikTok'})).match,false);
 assert.equal(evaluateJob({workplace:'remote or onsite'},options({workplace:'remote'})).match,false);
 assert.equal(evaluateJob({location:'Malaysia'},options({location:'LA'})).match,false);
 assert.equal(evaluateJob({postedAt:'2026-02-31',datePrecision:'day'},options({date:'7d'}),Date.parse('2026-03-05')).match,false);
 assert.equal(evaluateJob({postedAt:'2026-10-29',datePrecision:'instant'},options({date:'1d'}),stamp).match,false);
 assert.equal(evaluateJob({postedAt:'2026-10-29T10:00:00Z',datePrecision:'day'},options({date:'1d'}),stamp).match,false);
});
test('LinkedIn exact and detail caches preserve filter semantics without repeating requests',async()=> {
 const root=await mkdtemp(join(tmpdir(),'linkedin-filter-'));try {
  let requests=0;const http={get:async url=>{requests++;return url.includes('jobPosting/')?detail('Software Engineer'):card('100001','Software Engineer');}},cache=new CacheManager({root});
  const o=options({experience:'entry',employment:'full-time',company:'TikTok'});
  const first=await findJobs(o,http,{cache,now:()=>stamp}),before=requests;
  const repeat=await findJobs(o,http,{cache:new CacheManager({root}),now:()=>stamp});assert.equal(requests,before);assert.equal(repeat.stats.exactCacheHits,1);assert.deepEqual(repeat.jobs,first.jobs);
  const changed=await findJobs(options({experience:'entry',employment:'internship',company:'TikTok'}),http,{cache,now:()=>stamp});assert.equal(changed.jobs.length,0);assert.equal(requests,before+1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('details remain bounded and unknowns never fill the accepted-result limit',async()=> {
 let details=0;const html=Array.from({length:60},(_,index)=>card(String(200000+index),'Software Engineer')).join('');
 const result=await findJobs(options({experience:'entry',limit:2}),{get:async url=>{if(url.includes('jobPosting/')){details++;return detail('Software Engineer','Not applicable');}return html;}},{cache:false});
 assert.equal(details,25);assert.equal(result.jobs.length,0);assert.equal(result.stats.unknownExcluded,60);assert.equal(result.stats.providers.LinkedIn.complete,false);
});
test('title evidence is labeled in outputs, strict resolves it, and detail JSON-LD cannot change identity',async()=> {
 const http={get:async url=>url.includes('jobPosting/')?detail('Junior Software Engineer'):card('100001','Junior Software Engineer')};
 const normal=await findJobs(options({experience:'entry'}),http,{cache:false});assert.deepEqual(normal.jobs[0].inferredFilters,['experience']);assert.equal(normal.stats.detailRequests,0);assert.match(serializeJobs(normal.jobs),/title signals/);
 const strict=await findJobs(options({experience:'entry',strict:true}),http,{cache:false});assert.equal(strict.jobs.length,1);assert.deepEqual(strict.jobs[0].inferredFilters,[]);assert.equal(strict.stats.detailRequests,1);
 assert.throws(()=>parseJobDetail('<script type="application/ld+json">{"@type":"JobPosting","title":"Senior Software Engineer","url":"https://www.linkedin.com/jobs/view/100002/"}</script>',{id:'100001'}),/different posting/);
});
test('search evidence rejects unrelated occupations and resolves genuine description-only matches',async()=> {
 const html=card('100001','Senior Tax Accountant')+card('100002','Platform Specialist');
 const http={get:async url=>url.includes('/100002')?detail('Platform Specialist'):url.includes('jobPosting/')?'<h1 class="topcard__title">Senior Tax Accountant</h1><div class="description__text">Prepare annual tax statements.</div>':html};
 const result=await findJobs(options({limit:1}),http,{cache:false});assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].id,'100002');assert.equal(result.stats.rejected,1);
});
test('likely matches get detail capacity before unrelated cards, with only bounded exploration',async()=> {
 let details=0;const html=Array.from({length:40},(_,index)=>card(String(300000+index),'Accountant')).join('')+card('400001','Software Engineer');
 const result=await findJobs(options({experience:'entry'}),{get:async url=>{if(url.includes('jobPosting/')){details++;return url.endsWith('/400001')?detail('Software Engineer'):'<h1 class="topcard__title">Accountant</h1><div class="description__text">Prepare financial statements.</div>';}return html;}},{cache:false});
 assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].id,'400001');assert.equal(details,3);
});
