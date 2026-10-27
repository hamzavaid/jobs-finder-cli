export async function mapConcurrent(items,concurrency,visit,{signal} = {}) {
  let index = 0;
  const results = new Array(items.length);
  const workers = await Promise.allSettled(Array.from({length:Math.min(concurrency,items.length)},async () => {
    while (index < items.length) {signal?.throwIfAborted();const current = index++;results[current] = await visit(items[current],current);}
  }));
  const failure = workers.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
}
export class RequestScheduler {
  constructor({concurrency = 4,perHost = 2,signal} = {}) {
    Object.assign(this,{concurrency,perHost,signal});this.active = 0;this.hosts = new Map();this.queue = [];
    signal?.addEventListener('abort',() => {for (const task of this.queue.splice(0)) task.reject(signal.reason);},{once:true});
  }
  run(host,work) {
    this.signal?.throwIfAborted();
    return new Promise((resolve,reject) => {this.queue.push({host,work,resolve,reject});this.drain();});
  }
  drain() {
    while (this.active < this.concurrency) {
      const index = this.queue.findIndex(task => (this.hosts.get(task.host) || 0) < (/archive|commoncrawl|urlscan/.test(task.host) ? 1 : this.perHost));
      if (index < 0) return;
      const task = this.queue.splice(index,1)[0];
      this.active++;this.hosts.set(task.host,(this.hosts.get(task.host) || 0) + 1);
      Promise.resolve().then(() => {this.signal?.throwIfAborted();return task.work();}).then(task.resolve,task.reject).finally(() => {
        this.active--;this.hosts.set(task.host,this.hosts.get(task.host) - 1);this.drain();
      });
    }
  }
}
