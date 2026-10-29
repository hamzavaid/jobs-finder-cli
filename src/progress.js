import {stripVTControlCharacters} from 'node:util';

const safe = value => stripVTControlCharacters(String(value ?? '')).replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,' ');
const terminalState = message => /provider failed$/i.test(message) ? 'failed'
  : /cancel(?:ed|ing)$/i.test(message) ? 'canceled'
  : /matching jobs collected$/i.test(message) ? 'done' : 'active';
const finished = state => ['done','failed','canceled','stopped'].includes(state);

// Count wide characters conservatively so source text cannot wrap table rows.
function characterWidth(character) {
  if (/\p{Mark}|\u200d/u.test(character)) return 0;
  const point = character.codePointAt(0);
  return point >= 0x1100 && (point <= 0x115f || point >= 0x2e80 && point <= 0xa4cf || point >= 0xac00 && point <= 0xd7a3 || point >= 0xf900 && point <= 0xfaff || point >= 0xfe10 && point <= 0xfe6f || point >= 0xff01 && point <= 0xff60 || point >= 0x1f000) ? 2 : 1;
}
function cell(value,width) {
  let output = '',used = 0;
  for (const character of safe(value)) {
    const size = characterWidth(character);
    if (used + size > width) break;
    output += character;used += size;
  }
  return output + ' '.repeat(Math.max(0,width-used));
}

export class ProgressReporter {
  constructor({stderr = process.stderr,stdout = process.stdout,env = process.env,intervalMs = 120} = {}) {
    Object.assign(this,{stderr,intervalMs});
    this.enabled = !!stderr.isTTY && !!stdout.isTTY && !env.CI;
    this.frame = 0;this.timer = null;this.rows = new Map();this.renderedLines = 0;this.started = false;this.notice = '';
  }
  start(options) {
    if (!this.enabled) return;
    this.close();
    this.rows = new Map(options.websites.map(site => [site,{message:'Waiting to start',state:'waiting'}]));
    this.notice = '';this.frame = 0;this.started = true;
    this.stderr.write(`Searching: ${safe(options.search || options.company || options.location)}\n`);
    this.draw();
    // A very short terminal cannot redraw every selected site without scrolling.
    // Keep all rows as a static table there, then show their final state on close.
    this.animate = (this.stderr.rows || 24) >= this.rows.size + 5;
    if (this.animate) {this.timer = setInterval(() => this.draw(),this.intervalMs);this.timer.unref?.();}
  }
  update(provider,message) {
    if (!this.enabled || !this.started) return;
    const text = safe(message);
    if (this.rows.has(provider)) this.rows.set(provider,{message:text,state:terminalState(text)});
    else {
      this.notice = `${safe(provider)}: ${text}`;
      if (provider === 'Search' && /cancel/i.test(text)) {
        for (const row of this.rows.values()) if (!finished(row.state)) {row.state = 'canceled';row.message = 'Canceling';}
      }
    }
  }
  bar(row,width,index) {
    if (row.state === 'done') return '[' + '#'.repeat(width) + ']';
    if (row.state === 'failed') return '[!' + '-'.repeat(width-1) + ']';
    if (['canceled','stopped','waiting'].includes(row.state)) return '[' + '-'.repeat(width) + ']';
    const count = /fetching jobs:\s*(\d+)\s*\/\s*(\d+)\s*boards/i.exec(row.message);
    if (count && Number(count[2]) > 0) {
      const filled = Math.min(width,Math.floor(Number(count[1])/Number(count[2])*width));
      return '[' + '#'.repeat(filled) + '-'.repeat(width-filled) + ']';
    }
    const position = (this.frame+index) % width;
    return '[' + '-'.repeat(position) + '=' + '-'.repeat(width-position-1) + ']';
  }
  render() {
    const width = Math.max(1,(this.stderr.columns || 100)-1);
    if (width < 30) return [...this.rows].map(([site,row]) => cell(`${site}: ${row.message}`,width));
    const nameWidth = Math.min(Math.max(7,...[...this.rows.keys()].map(site => site.length)),Math.floor(width/3));
    const barWidth = Math.min(10,Math.max(4,Math.floor(width/6)));
    const activityWidth = width-nameWidth-barWidth-6;
    const lines = [cell('Website',nameWidth)+'  '+cell('Progress',barWidth+2)+'  Activity',
      '-'.repeat(nameWidth)+'  '+'-'.repeat(barWidth+2)+'  '+'-'.repeat(activityWidth)];
    let index = 0;
    for (const [site,row] of this.rows) lines.push(cell(site,nameWidth)+'  '+this.bar(row,barWidth,index++)+'  '+cell(row.message,activityWidth));
    if (this.notice) lines.push(cell(this.notice,width));
    return lines;
  }
  draw() {
    if (!this.enabled || !this.started) return;
    if (this.renderedLines) this.stderr.write(`\x1b[${this.renderedLines}A\r\x1b[0J`);
    const lines = this.render();
    this.stderr.write(lines.join('\n')+'\n');this.renderedLines = lines.length;this.frame++;
  }
  finish(count,{partial = false,duplicates = 0} = {}) {
    this.close();
    if (this.enabled) this.stderr.write(`Search ${partial ? 'completed with partial coverage' : 'completed'}: ${count} matching jobs${duplicates ? `; ${duplicates} duplicates removed` : ''}.\n`);
  }
  close() {
    if (this.timer) clearInterval(this.timer);this.timer = null;
    if (this.enabled && this.started) {
      if (this.animate === false) {this.renderedLines = 0;this.stderr.write('\n');}
      this.draw(); // Leave the last activity of every website visible above results.
    }
    this.started = false;this.renderedLines = 0;
  }
}
