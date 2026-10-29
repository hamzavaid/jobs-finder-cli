import {load} from 'cheerio';
import {assertBoard,posting,instant} from './shared.js';
export function personioUrl(board) {const id=assertBoard(board);if(!/^[a-z\d-]+$/i.test(board.id))throw new Error('Invalid Personio tenant.');return `https://${id}.jobs.personio.${board.domain === 'com' ? 'com' : 'de'}/xml?language=en`;}
export function parsePersonio(xml,board){
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Personio XML declarations are not supported.');
 const $=load(xml,{xmlMode:true});if(!$('workzag-jobs').length)throw new Error('Personio schema drift: missing feed root.');const jobs=[];let rejected=0;
 $('position').each((_,el)=>{const get=name=>$(el).children(name).first().text().trim()||null;const id=get('id');const postedAt=instant(get('createdAt'));
 const description=$(el).find('jobDescription').map((_,part)=>$(part).find('value').text().trim()).get().filter(Boolean).join('\n')||null;
 const job=posting('Personio',{...board,company:get('subcompany')||board.company},{id},{title:get('name'),url:id?`https://${board.id}.jobs.personio.${board.domain === 'com' ? 'com' : 'de'}/job/${encodeURIComponent(id)}`:null,description,descriptionCompleteness:description?'complete':'title-only',location:get('office'),employmentType:get('employmentType'),seniorityLevel:get('seniority'),boardDomain:board.domain || 'de',createdAt:postedAt,postedAt:null,datePrecision:null});if(job)jobs.push(job);else rejected++;
 });return {jobs,complete:!rejected,pages:1,reason:rejected?'malformed records quarantined':null};
}
export const personioProvider={name:'Personio',kind:'ats',domains:['*.jobs.personio.de','*.jobs.personio.com'],apiUrl:personioUrl,async fetchBoard(board,http){return parsePersonio(await http.text(personioUrl(board)),board);},async enrichJob(board,job){return job;},validationFormat:'xml'};
