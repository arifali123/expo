import MockWebSocket from './MockWebSocket';
import { DevToolsPluginClient } from '../DevToolsPluginClient';
import { createDevToolsPluginClient } from '../DevToolsPluginClientFactory';

// @ts-expect-error - We don't mock all properties from WebSocket
globalThis.WebSocket = MockWebSocket;

describe(`DevToolsPluginClient`, () => {
  let appClient: DevToolsPluginClient;
  let testCaseCounter = 0;
  let devServer;
  const pluginName = 'testPlugin';

  beforeEach(async () => {
    // Connect to different devServer for each test case to avoid jest parallel test issues.
    testCaseCounter += 1;
    devServer = `localhost:${8000 + testCaseCounter}`;
    appClient = await createDevToolsPluginClient({ devServer, sender: 'app', pluginName });
  });

  afterEach(async () => {
    await appClient.closeAsync();
  });

  it('should connect to the WebSocket server', async () => {
    expect(appClient.isConnected()).toBe(true);
  });

  it('should throw errors when sending a message in a disconnected state', async () => {
    await appClient.closeAsync();
    expect(appClient.isConnected()).toBe(false);
    expect(() => appClient.sendMessage('testMethod', {})).toThrow();
  });
});

describe(`DevToolsPluginClient (browser <> app)`, () => {
  let testCaseCounter = 0;
  let devServer;
  const pluginName = 'testPlugin';
  let appClient: DevToolsPluginClient;
  let browserClient: DevToolsPluginClient;

  beforeEach(() => {
    // Connect to different devServer for each test case to avoid jest parallel test issues.
    testCaseCounter += 1;
    devServer = `localhost:${8000 + testCaseCounter}`;
  });

  afterEach(async () => {
    await appClient?.closeAsync();
    await browserClient?.closeAsync();
  });

  it('should send and receive messages', async () => {
    const method = 'testMethod';
    const message = { foo: 'bar' };

    appClient = await createDevToolsPluginClient({ devServer, sender: 'app', pluginName });
    browserClient = await createDevToolsPluginClient({ devServer, sender: 'browser', pluginName });

    const receivedPromise = new Promise((resolve) => {
      appClient.addMessageListener(method, (params) => {
        resolve(params);
      });
    });

    browserClient.sendMessage(method, message);
    const received = await receivedPromise;
    expect(received).toEqual(message);
  });

  it('should support ping-pong messages', async () => {
    appClient = await createDevToolsPluginClient({ devServer, sender: 'app', pluginName });
    browserClient = await createDevToolsPluginClient({ devServer, sender: 'browser', pluginName });

    const appPromise = new Promise((resolve) => {
      appClient.addMessageListener('ping', (params) => {
        appClient.sendMessage('pong', { from: 'app' });
        resolve(params);
      });
    });
    const browserPromise = new Promise((resolve) => {
      browserClient.addMessageListener('pong', (params) => {
        resolve(params);
      });
    });

    browserClient.sendMessage('ping', { from: 'browser' });
    const receivedPing = await appPromise;
    expect(receivedPing).toEqual({ from: 'browser' });
    const receivedPong = await browserPromise;
    expect(receivedPong).toEqual({ from: 'app' });
  });

  it('should not receive messages from differnet plugin', async () => {
    const method = 'testMethod';
    const message = { foo: 'bar' };

    appClient = await createDevToolsPluginClient({ devServer, sender: 'app', pluginName });
    browserClient = await createDevToolsPluginClient({
      devServer,
      sender: 'browser',
      pluginName: 'pluginB',
    });

    const receivedPromise = new Promise((resolve) => {
      appClient.addMessageListener(method, (params) => {
        resolve(params);
      });
    });

    browserClient.sendMessage(method, message);
    expect(receivedPromise).rejects.toThrow();
  });

  it('should only allow the latest connected client with the same plugin name to receive messages', async () => {
    const method = 'testMethod';

    appClient = await createDevToolsPluginClient({ devServer, sender: 'app', pluginName });
    const receivedMessages: any[] = [];
    appClient.addMessageListener(method, (params) => {
      receivedMessages.push(params);
    });

    browserClient = await createDevToolsPluginClient({ devServer, sender: 'browser', pluginName });
    const browserClient2 = await createDevToolsPluginClient({
      devServer,
      sender: 'browser',
      pluginName,
    });

    await waitUntilAsync(() => !browserClient.isConnected() && browserClient2.isConnected());
    expect(() => browserClient.sendMessage(method, { from: 'browserClient' })).toThrow();
    browserClient2.sendMessage(method, { from: 'browserClient2' });

    expect(receivedMessages.length).toBe(1);
    expect(receivedMessages[0]).toEqual({ from: 'browserClient2' });
    await browserClient2.closeAsync();
  });
});

function waitUntilAsync(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    function check() {
      if (fn()) {
        resolve();
      } else if (Date.now() - startTime > timeoutMs) {
        reject(new Error('Timed out'));
      } else {
        setTimeout(check, 100);
      }
    }
    check();
  });
}
