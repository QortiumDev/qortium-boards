import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_PREFIX = 'QORTIUM_BOARDS';
const DEFAULT_NODE_API_URL = 'http://127.0.0.1:24891';
const DEFAULT_NAME = 'Boards';
const DEFAULT_IDENTIFIER = 'Boards';
const DEFAULT_TITLE = 'Boards';
const DEFAULT_DESCRIPTION = 'A QDN discussion board for Qortium communities.';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 180_000;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_BASE = BigInt(BASE58_ALPHABET.length);
const REGISTER_NAME_TRANSACTION_TYPE = 3;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnv(name) {
  return process.env[`${ENV_PREFIX}_${name}`];
}

const nodeApiUrl = (readEnv('NODE_API_URL') ?? DEFAULT_NODE_API_URL).replace(/\/+$/, '');
const publishName = readEnv('QDN_NAME') ?? DEFAULT_NAME;
const identifier = readEnv('QDN_IDENTIFIER') ?? DEFAULT_IDENTIFIER;
const publishTitle = readEnv('QDN_TITLE') ?? DEFAULT_TITLE;
const service = readEnv('QDN_SERVICE') ?? 'APP';
const distPath = path.resolve(repoRoot, readEnv('DIST_PATH') ?? 'dist');
const apiKeyPath = expandHomePath(
  readEnv('NODE_API_KEY_PATH') ?? '~/qortium/git/qortium-core/preview/apikey.txt',
);
const previewAccountsPath = expandHomePath(
  readEnv('PREVIEW_ACCOUNTS_PATH') ??
    '~/qortium/git/qortium-core/preview/secrets/initial-minting-accounts.json',
);

function expandHomePath(filePath) {
  if (filePath === '~') {
    return homedir();
  }

  if (filePath.startsWith('~/')) {
    return path.join(homedir(), filePath.slice(2));
  }

  return filePath;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return readFileSync(filePath, 'utf8').trim();
}

function getNodeApiPort() {
  try {
    const url = new URL(nodeApiUrl);

    if (url.port) {
      return Number(url.port);
    }

    return url.protocol === 'https:' ? 443 : 80;
  } catch {
    return null;
  }
}

function isLoopbackNodeApiUrl() {
  try {
    const url = new URL(nodeApiUrl);
    const hostname = url.hostname.toLowerCase();

    return (
      hostname === 'localhost' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname)
    );
  } catch {
    return false;
  }
}

function getQortiumCoreProcessPaths(args, cwd) {
  const jarIndex = args.findIndex((arg) => arg === '-jar');
  const jarPath = jarIndex >= 0 ? args[jarIndex + 1] ?? '' : '';
  const settingsPath = jarIndex >= 0 ? args[jarIndex + 2] ?? '' : '';
  const jarName = path.basename(jarPath).toLowerCase();

  if (!jarName.startsWith('qortium') || !jarName.endsWith('.jar') || !settingsPath) {
    return null;
  }

  return {
    jarPath: path.isAbsolute(jarPath) ? jarPath : path.resolve(cwd, jarPath),
    settingsPath: path.isAbsolute(settingsPath) ? settingsPath : path.resolve(cwd, settingsPath),
  };
}

function getConfiguredApiKeyPath(settings, cwd) {
  const configuredApiKeyPath =
    settings && typeof settings.apiKeyPath === 'string' ? settings.apiKeyPath.trim() : '';
  const apiKeyDirectory = configuredApiKeyPath
    ? path.isAbsolute(configuredApiKeyPath)
      ? configuredApiKeyPath
      : path.resolve(cwd, configuredApiKeyPath)
    : cwd;

  return path.join(apiKeyDirectory, 'apikey.txt');
}

function getRunningLocalCoreApiKeyPath() {
  if (process.platform !== 'linux' || !isLoopbackNodeApiUrl()) {
    return null;
  }

  const requestedApiPort = getNodeApiPort();
  const candidates = [];

  for (const entry of readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
      continue;
    }

    try {
      const procPath = path.join('/proc', entry.name);
      const args = readFileSync(path.join(procPath, 'cmdline'), 'utf8')
        .split('\0')
        .filter(Boolean);
      const cwd = readlinkSync(path.join(procPath, 'cwd'));
      const coreProcessPaths = getQortiumCoreProcessPaths(args, cwd);

      if (!coreProcessPaths) {
        continue;
      }

      const settings = readJson(coreProcessPaths.settingsPath);
      const apiPort = Number(settings?.apiPort);

      if (requestedApiPort && Number.isFinite(apiPort) && apiPort !== requestedApiPort) {
        continue;
      }

      const candidateApiKeyPath = getConfiguredApiKeyPath(settings, cwd);

      if (existsSync(candidateApiKeyPath) && readText(candidateApiKeyPath)) {
        candidates.push(candidateApiKeyPath);
      }
    } catch {
      // Processes can exit while /proc is being scanned.
    }
  }

  return candidates.length === 1 ? candidates[0] : null;
}

function getApiKeySource() {
  const explicitApiKey = readEnv('NODE_API_KEY')?.trim();

  if (explicitApiKey) {
    return {
      apiKey: explicitApiKey,
      label: `${ENV_PREFIX}_NODE_API_KEY`,
    };
  }

  if (readEnv('NODE_API_KEY_PATH')?.trim()) {
    return {
      apiKey: readText(apiKeyPath),
      label: apiKeyPath,
    };
  }

  const runningCoreApiKeyPath = getRunningLocalCoreApiKeyPath();

  if (runningCoreApiKeyPath) {
    return {
      apiKey: readText(runningCoreApiKeyPath),
      label: runningCoreApiKeyPath,
    };
  }

  return {
    apiKey: readText(apiKeyPath),
    label: apiKeyPath,
  };
}

function decodeBase58(value) {
  let decoded = 0n;

  for (const character of value) {
    const index = BASE58_ALPHABET.indexOf(character);

    if (index === -1) {
      throw new Error(`Invalid Base58 character: ${character}`);
    }

    decoded = decoded * BASE58_BASE + BigInt(index);
  }

  const bytes = [];

  while (decoded > 0n) {
    bytes.unshift(Number(decoded % 256n));
    decoded /= 256n;
  }

  for (const character of value) {
    if (character !== '1') {
      break;
    }

    bytes.unshift(0);
  }

  return Buffer.from(bytes);
}

function encodeBase58(bytes) {
  let value = 0n;

  for (const byte of bytes) {
    value = value * 256n + BigInt(byte);
  }

  let encoded = '';

  while (value > 0n) {
    const remainder = Number(value % BASE58_BASE);
    value /= BASE58_BASE;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }

  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }

    encoded = '1' + encoded;
  }

  return encoded || '1';
}

function intBytes(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(value);

  return bytes;
}

function longBytes(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigInt64BE(BigInt(value));

  return bytes;
}

function sizedStringBytes(value) {
  const stringBytes = Buffer.from(value, 'utf8');

  return Buffer.concat([intBytes(stringBytes.length), stringBytes]);
}

function buildRegisterNameRawBytes58({ account, data, name, timestamp }) {
  const publicKey = decodeBase58(account.accountPublicKey);

  if (publicKey.length !== 32) {
    throw new Error(`Local account public key must decode to 32 bytes, got ${publicKey.length}.`);
  }

  return encodeBase58(
    Buffer.concat([
      intBytes(REGISTER_NAME_TRANSACTION_TYPE),
      longBytes(timestamp),
      intBytes(0),
      publicKey,
      intBytes(0),
      sizedStringBytes(name),
      sizedStringBytes(data),
      longBytes(0),
    ]),
  );
}

function getLocalPreviewAccount() {
  const previewAccounts = readJson(previewAccountsPath);
  const account = previewAccounts.accounts?.find((item) => item.role === 'local');

  if (!account?.accountAddress || !account?.accountPrivateKey || !account?.accountPublicKey) {
    throw new Error(`Local preview account was not found in ${previewAccountsPath}.`);
  }

  return account;
}

function getHeaders(contentType) {
  const headers = {
    'X-API-KEY': apiKey,
  };

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return headers;
}

function appendQuery(pathname, query) {
  const queryParams = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    queryParams.set(key, String(value));
  }

  const queryString = queryParams.toString();

  return queryString ? `${pathname}?${queryString}` : pathname;
}

async function request(pathname, options = {}) {
  const response = await fetch(`${nodeApiUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `${options.method ?? 'GET'} ${pathname} failed with HTTP ${response.status}.`);
  }

  return text;
}

async function requestJson(pathname, options = {}) {
  const text = await request(pathname, options);

  return text ? JSON.parse(text) : null;
}

async function waitFor(label, predicate) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    try {
      const result = await predicate();

      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Timed out waiting for ${label}.${lastError instanceof Error ? ` Last error: ${lastError.message}` : ''}`,
  );
}

async function signAndProcess(rawUnsignedBytes58, privateKey58, computePath = '/arbitrary/compute') {
  const rawUnsignedWithNonce58 = await request(computePath, {
    method: 'POST',
    headers: getHeaders('text/plain'),
    body: rawUnsignedBytes58,
  });
  const signedBytes58 = await request('/transactions/sign', {
    method: 'POST',
    headers: getHeaders('application/json'),
    body: JSON.stringify({
      privateKey: privateKey58,
      transactionBytes: rawUnsignedWithNonce58,
    }),
  });
  const processResult = await request('/transactions/process', {
    method: 'POST',
    headers: getHeaders('text/plain'),
    body: signedBytes58,
  });

  if (processResult.trim() !== 'true' && !processResult.includes('"type"')) {
    throw new Error(`Transaction was not accepted: ${processResult}`);
  }

  return signedBytes58;
}

async function getNameInfo(name) {
  const response = await fetch(`${nodeApiUrl}/names/${encodeURIComponent(name)}`);

  if (response.status === 404) {
    return null;
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `Name lookup failed with HTTP ${response.status}.`);
  }

  return JSON.parse(text);
}

async function ensureNameRegistered(name, account) {
  const existingName = await getNameInfo(name);

  if (existingName) {
    if (existingName.owner !== account.accountAddress) {
      throw new Error(`${name} is already registered to ${existingName.owner}.`);
    }

    console.log(`Name already registered: ${name} (${existingName.owner})`);
    return;
  }

  console.log(`Registering name with mempow: ${name}`);

  const rawRegisterBytes58 = buildRegisterNameRawBytes58({
    account,
    timestamp: Date.now(),
    name,
    data: JSON.stringify({
      app: DEFAULT_TITLE,
      purpose: 'QDN app preview for Boards',
    }),
  });

  await signAndProcess(rawRegisterBytes58, account.accountPrivateKey, '/transactions/mempow/compute');
  await waitFor(`name ${name}`, async () => {
    const nameInfo = await getNameInfo(name);

    return nameInfo?.owner === account.accountAddress ? nameInfo : null;
  });

  console.log(`Name registered: ${name}`);
}

async function getResourceStatus() {
  return requestJson(
    `/arbitrary/resource/status/${service}/${encodeURIComponent(publishName)}/${encodeURIComponent(identifier)}?build=true`,
    {
      headers: getHeaders(),
    },
  );
}

async function publishResource(account) {
  const resourcePathname = `/arbitrary/${service}/${encodeURIComponent(publishName)}/${encodeURIComponent(identifier)}`;
  const rawUnsignedBytes58 = await request(
    appendQuery(resourcePathname, {
      title: publishTitle,
      description: DEFAULT_DESCRIPTION,
      fee: 0,
    }),
    {
      method: 'POST',
      headers: getHeaders('text/plain'),
      body: distPath,
    },
  );

  await signAndProcess(rawUnsignedBytes58, account.accountPrivateKey);
}

if (!existsSync(distPath)) {
  throw new Error(`Build output does not exist: ${distPath}. Run npm run build first.`);
}

const apiKeySource = getApiKeySource();
const apiKey = apiKeySource.apiKey;
const account = getLocalPreviewAccount();

console.log(`Node: ${nodeApiUrl}`);
console.log(`Owner: ${account.accountAddress}`);
console.log(`Resource: qdn://${service}/${publishName}/${identifier}`);
console.log(`Source: ${distPath}`);

const status = await requestJson('/admin/status');

if (!status || status.syncPercent !== 100 || status.isSynchronizing) {
  throw new Error(`Node is not synced: ${JSON.stringify(status)}`);
}

await ensureNameRegistered(publishName, account);
await publishResource(account);

const readyStatus = await waitFor(`${service}/${publishName}/${identifier}`, async () => {
  const resourceStatus = await getResourceStatus();

  if (resourceStatus?.status === 'READY') {
    return resourceStatus;
  }

  if (resourceStatus?.status === 'BLOCKED' || resourceStatus?.status === 'BUILD_FAILED') {
    throw new Error(`${service}/${publishName}/${identifier} status is ${resourceStatus.status}.`);
  }

  return null;
});

console.log(`Ready: qdn://${service}/${publishName}/${identifier}`);
console.log(`Status: ${readyStatus.status}${readyStatus.description ? ` - ${readyStatus.description}` : ''}`);
