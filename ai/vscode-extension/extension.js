/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MANIFOLD AI — VS Code Extension
 * z = x · y — Sidebar chat, file context, manifold-native
 * ═══════════════════════════════════════════════════════════════════════════
 */

const vscode = require('vscode');
const http = require('http');

// ─── Activation ─────────────────────────────────────────────────────────
function activate(context) {
  const provider = new ManifoldChatProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('manifold-ai.chat', provider),

    vscode.commands.registerCommand('manifold-ai.sendFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const filePath = vscode.workspace.asRelativePath(editor.document.uri);
      const content = editor.document.getText();
      provider.sendMessage(`Analyze this file: ${filePath}\n\n${content}`);
    }),

    vscode.commands.registerCommand('manifold-ai.askAbout', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.document.getText(editor.selection);
      const question = await vscode.window.showInputBox({ prompt: 'Ask about selection:' });
      if (question) provider.sendMessage(`${question}\n\nCode:\n${selection}`);
    }),

    vscode.commands.registerCommand('manifold-ai.setModel', async () => {
      const config = vscode.workspace.getConfiguration('manifold-ai');
      const serverUrl = config.get('serverUrl', 'http://localhost:3377');
      try {
        const models = await httpGet(`${serverUrl}/models`);
        const parsed = JSON.parse(models);
        const pick = await vscode.window.showQuickPick(parsed.models || []);
        if (pick) {
          await config.update('model', pick, true);
          await httpPost(`${serverUrl}/model`, { model: pick });
          vscode.window.showInformationMessage(`Manifold AI: Model set to ${pick}`);
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Manifold AI: ${e.message}`);
      }
    })
  );
}

function deactivate() {}

// ─── Chat Webview Provider ──────────────────────────────────────────────
class ManifoldChatProvider {
  constructor(extensionUri) {
    this._extensionUri = extensionUri;
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewHtml();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'chat') {
        const config = vscode.workspace.getConfiguration('manifold-ai');
        const serverUrl = config.get('serverUrl', 'http://localhost:3377');
        try {
          // Stream via SSE
          await this._streamChat(serverUrl, msg.message);
        } catch (e) {
          this._postMessage({ type: 'error', error: e.message });
        }
      }
    });
  }

  sendMessage(message) {
    if (this._view) {
      this._postMessage({ type: 'inject', message });
    }
  }

  _postMessage(msg) {
    if (this._view) this._view.webview.postMessage(msg);
  }

  async _streamChat(serverUrl, message) {
    const url = new URL(`${serverUrl}/chat/stream`);
    const body = JSON.stringify({ message }); // transport boundary
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        res.on('data', (chunk) => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line.startsWith('data: [DONE]')) {
              this._postMessage({ type: 'done' });
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                this._postMessage({ type: 'chunk', content: data.chunk });
              } catch { /* partial */ }
            }
          }
        });
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

// ─── HTTP Helpers ───────────────────────────────────────────────────────
function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    http.get({ hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}` }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function httpPost(urlStr, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const body = JSON.stringify(data);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Webview HTML ───────────────────────────────────────────────────────
function getWebviewHtml() {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    background: var(--vscode-sideBar-background, #0a0a1a);
    color: var(--vscode-foreground, #e0e0e0);
    height: 100vh; display: flex; flex-direction: column;
  }
  #header {
    padding: 8px 12px;
    background: linear-gradient(135deg, #1a0a2e, #0a1a2a);
    border-bottom: 1px solid rgba(0,212,255,0.2);
    font-size: 11px; color: #00d4ff; letter-spacing: 1px;
  }
  #messages {
    flex: 1; overflow-y: auto; padding: 8px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .msg { padding: 8px 12px; border-radius: 8px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .msg.user { background: rgba(178,77,255,0.15); border: 1px solid rgba(178,77,255,0.3); align-self: flex-end; max-width: 85%; }
  .msg.assistant { background: rgba(0,212,255,0.08); border: 1px solid rgba(0,212,255,0.15); max-width: 95%; }
  .msg.error { background: rgba(255,45,149,0.15); border: 1px solid rgba(255,45,149,0.3); color: #ff2d95; }
  .msg code { background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  .msg pre { background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; overflow-x: auto; margin: 4px 0; }
  #input-area { padding: 8px; border-top: 1px solid rgba(0,212,255,0.15); display: flex; gap: 6px; }
  #input {
    flex: 1; padding: 8px 12px; border-radius: 6px;
    background: rgba(255,255,255,0.05); border: 1px solid rgba(0,212,255,0.2);
    color: inherit; font-family: inherit; font-size: 13px; resize: none;
    outline: none; min-height: 36px; max-height: 120px;
  }
  #input:focus { border-color: #00d4ff; }
  #send {
    padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer;
    background: linear-gradient(135deg, #b24dff, #00d4ff);
    color: #fff; font-weight: 600; font-size: 13px;
  }
  #send:hover { filter: brightness(1.2); }
  #send:disabled { opacity: 0.4; cursor: not-allowed; }
  .typing { color: #00d4ff; font-style: italic; font-size: 12px; }
</style>
</head><body>
<div id="header">◆ MANIFOLD AI — z = x · y</div>
<div id="messages"></div>
<div id="input-area">
  <textarea id="input" placeholder="Ask the manifold..." rows="1"></textarea>
  <button id="send">⟩</button>
</div>
<script>
  const vscode = acquireVsCodeApi();
  const messages = document.getElementById('messages');
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  let currentAssistant = null;
  let streaming = false;

  function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.textContent = content;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function sendChat() {
    const text = input.value.trim();
    if (!text || streaming) return;
    addMessage('user', text);
    input.value = '';
    streaming = true;
    send.disabled = true;
    currentAssistant = addMessage('assistant', '');
    vscode.postMessage({ type: 'chat', message: text });
  }

  send.addEventListener('click', sendChat);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'chunk' && currentAssistant) {
      currentAssistant.textContent += msg.content;
      messages.scrollTop = messages.scrollHeight;
    }
    if (msg.type === 'done') {
      streaming = false;
      send.disabled = false;
      currentAssistant = null;
    }
    if (msg.type === 'error') {
      addMessage('error', msg.error);
      streaming = false;
      send.disabled = false;
    }
    if (msg.type === 'inject') {
      input.value = msg.message;
      sendChat();
    }
  });
</script>
</body></html>`;
}

module.exports = { activate, deactivate };

