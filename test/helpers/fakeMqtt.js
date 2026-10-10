// -----------------------------------------------------------------------------
// Fake `mqtt.connect` and fake timers, so the links are tested without any
// broker, network or real delay.
//
// `createFakeMqtt(decide)`: `decide(url, options)` returns what the broker
// does with the connection attempt: 'connect' (accepted), 'error' (refused),
// or 'hang' (no answer, the link's own timeout has to fire).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

export class FakeMqttClient extends EventEmitter {
  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.published = [];
    this.subscriptions = [];
    this.ended = false;
    this.failPublish = false;
  }

  publish(topic, payload, options, callback) {
    if (this.failPublish) {
      callback(new Error('publish failed'));
      return;
    }
    this.published.push({ topic, payload: JSON.parse(payload), options });
    callback();
  }

  subscribe(topic, options) {
    this.subscriptions.push({ topic, options });
  }

  end() {
    if (!this.ended) {
      this.ended = true;
      this.emit('close');
    }
  }

  /** The device sends a message on its status topic. */
  receive(message) {
    this.emit('message', this.subscriptions[0]?.topic, Buffer.from(JSON.stringify(message)));
  }

  /** The broker drops the session. */
  drop() {
    this.ended = true;
    this.emit('close');
  }
}

export function createFakeMqtt(decide = () => 'connect') {
  const clients = [];
  const connect = (url, options) => {
    const client = new FakeMqttClient(url, options);
    clients.push(client);
    const outcome = decide(url, options);
    setImmediate(() => {
      if (outcome === 'connect') {
        client.emit('connect');
      } else if (outcome === 'error') {
        client.emit('error', new Error('Connection refused: Not authorized'));
      }
    });
    return client;
  };
  return { connect, clients };
}

export function createFakeTimers() {
  let nextId = 1;
  const timeouts = new Map();
  const intervals = new Map();
  return {
    timeouts,
    intervals,
    setTimeout(fn, ms) {
      const id = nextId++;
      timeouts.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    setInterval(fn, ms) {
      const id = nextId++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    /** Run (and forget) the pending timeouts whose delay is `ms`. */
    runTimeouts(ms) {
      for (const [id, timer] of [...timeouts]) {
        if (ms === undefined || timer.ms === ms) {
          timeouts.delete(id);
          timer.fn();
        }
      }
    },
  };
}

/** Let the pending promise callbacks and setImmediate run. */
export function flush() {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}
