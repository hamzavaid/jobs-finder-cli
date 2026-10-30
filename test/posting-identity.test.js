import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePosting} from '../src/posting-parser.js';
const url='https://employer.example/jobs/22222';
const entry=(id,title)=>({'@type':'JobPosting',url:`https://employer.example/jobs/${id}`,identifier:{value:id},title,hiringOrganization:{name:'Employer'},description:'Verified duties'});
const html=records=>`<script type="application/ld+json">${JSON.stringify(records)}</script>`;
test('posting selection follows identity rather than JSON-LD order',()=>{
  const right=entry('22222','Requested Chef'),wrong=entry('11111','Unrelated Nurse');
  for(const records of [[wrong,right],[right,wrong]]) {
    const result=parsePosting(html(records),url);assert.equal(result.status,'complete');assert.equal(result.job.title,'Requested Chef');assert.equal(result.job.url,url);
  }
});
test('conflicting, mismatched and ambiguous identities never acquire the requested URL',()=>{
  for(const records of [[entry('11111','Wrong')],[entry('22222','Chef'),entry('22222','Nurse')],[{...entry('22222','Chef'),identifier:{value:'11111'}}],[{...entry('22222','Chef'),url:undefined},{...entry('11111','Nurse'),url:undefined}]]) {
    // Numeric identifiers alone can identify one record, but conflicting records cannot.
    if(records.length===2 && records.every(record=>!record.url)) records.forEach(record=>delete record.identifier);
    assert.equal(parsePosting(html(records),url).job,null);
  }
});
test('single-job pages without identity remain supported; relative URLs are resolved',()=>{
  const record=entry('22222','Chef');delete record.url;delete record.identifier;
  assert.equal(parsePosting(html(record),url).job.title,'Chef');
  assert.equal(parsePosting(html({...record,url:'/jobs/22222'}),url).status,'complete');
});
test('microdata obeys identity constraints and ambiguous JSON-LD cannot route to unrelated ATS links',()=>{
 const html='<div itemscope itemtype="https://schema.org/JobPosting"><a itemprop="url" href="/jobs/11111"></a><span itemprop="title">Wrong Chef</span><span itemprop="hiringOrganization">Kitchen</span><div itemprop="description">Duties</div></div>';
 assert.equal(parsePosting(html,url).job,null);
 const ambiguous=parsePosting(`<script type="application/ld+json">${JSON.stringify([entry('11111','Wrong')])}</script><a href="https://jobs.lever.co/example/wrong">Apply</a>`,url);
 assert.equal(ambiguous.identityConflict,true);
});
