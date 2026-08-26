export class BackendSocket {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.open = false;
    this.handlers = new Map();
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, data = {}) {
    if (this.open) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  sendAudio(buf) {
    if (this.open) this.ws.send(buf);
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        this.open = true;
        resolve();
      };
      ws.onerror = (e) => {
        reject(new Error('Could not connect to the local AI backend.'));
      };
      ws.onclose = () => {
        this.open = false;
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        const fns = this.handlers.get(msg.type) || [];
        for (const fn of fns) fn(msg);
      };
      this.ws = ws;
    });
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.open = false;
  }
}