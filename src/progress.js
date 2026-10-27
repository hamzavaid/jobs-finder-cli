const safe = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g,' ');
export class ProgressReporter {
  constructor({stderr = process.stderr,stdout = process.stdout,env = process.env,intervalMs = 120} = {}) {
    Object.assign(this,{stderr,intervalMs});this.enabled = !!stderr.isTTY && !!stdout.isTTY && !env.CI;
    this.frame = 0;this.current = '';this.timer = null;
  }
  start(options) {
    if (!this.enabled) return;
    this.stderr.write(`Searching: ${safe(options.search || options.company || options.location)}\nWebsites: ${options.websites.join(', ')}\n`);
    this.current = 'Preparing search';this.draw();
    this.timer = setInterval(() => this.draw(),this.intervalMs);this.timer.unref?.();
  }
  update(provider,message) {this.current = `${safe(provider)}: ${safe(message)}`;}
  draw() {
    if (!this.enabled || !this.current) return;
    const width = Math.max(20,(this.stderr.columns || 100) - 1);
    this.stderr.write(`\r\x1b[2K${['|','/','-','\\'][this.frame++ % 4]} ${this.current}`.slice(0,width + 6));
  }
  finish(count,{partial = false,duplicates = 0} = {}) {
    this.close();
    if (this.enabled) this.stderr.write(`Search ${partial ? 'completed with partial coverage' : 'completed'}: ${count} matching jobs${duplicates ? `; ${duplicates} duplicates removed` : ''}.\n`);
  }
  close() {
    if (this.timer) clearInterval(this.timer);this.timer = null;
    if (this.enabled && this.current) this.stderr.write('\r\x1b[2K');this.current = '';
  }
}
