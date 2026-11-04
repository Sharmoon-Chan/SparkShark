import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function safeOrigin(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('Use an HTTPS origin, or HTTP on localhost.');
  return url.origin;
}

async function secret(question) {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Administrator setup requires an interactive terminal to hide secrets.');
  stdout.write(question);
  stdin.setEncoding('utf8');
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      error ? reject(error) : resolve(value);
    };
    const onData = data => {
      for (const char of data) {
        if (char === '\u0003') return done(new Error('Cancelled.'));
        if (char === '\r' || char === '\n') return done();
        if (char === '\u007f' || char === '\b') value = [...value].slice(0, -1).join('');
        else if (char >= ' ' && [...value].length < 1024) value += char;
      }
    };
    stdin.on('data', onData);
  });
}

try {
  const origin = safeOrigin(argument('--origin') ?? process.env.APP_ORIGIN ?? 'http://127.0.0.1:5178');
  const api = safeOrigin(argument('--api') ?? origin);
  stdout.write(`Initialize one administrator at ${api}, for website ${origin}.\n`);
  const terminal = createInterface({ input: stdin, output: stdout });
  const username = (await terminal.question('Administrator username: ')).trim();
  const displayName = (await terminal.question('Display name (optional): ')).trim();
  terminal.close();
  const password = await secret('Administrator password (hidden, 12–128 characters): ');
  if (password !== await secret('Confirm password (hidden): ')) throw new Error('Passwords do not match.');
  const token = await secret('One-time BOOTSTRAP_TOKEN (hidden): ');
  const response = await fetch(`${api}/api/admin/bootstrap`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Bootstrap-Token': token },
    body: JSON.stringify({ username, displayName, password }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `Setup failed (${response.status}).`);
  stdout.write('Administrator initialized. Sign in through the website; remove BOOTSTRAP_TOKEN from production after setup.\n');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Administrator setup failed.');
  process.exitCode = 1;
}
