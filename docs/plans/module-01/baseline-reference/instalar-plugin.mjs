import { execFile } from 'node:child_process';
import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const pluginName = 'peterson-carousel-suite';
const marketplaceEntry = {
  name: pluginName,
  source: { source: 'local', path: `./.codex/plugins/${pluginName}` },
  policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
  category: 'Productivity',
};

const exists = async (target) => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

const copyFilter = (source) => {
  const parts = source.split(path.sep);
  return !parts.some((part) => ['node_modules', 'output', '.git'].includes(part));
};

export const dependencyInstallCommand = (
  platform = process.platform,
  commandProcessor = process.env.ComSpec || 'cmd.exe',
) => platform === 'win32'
  ? {
    executable: commandProcessor,
    args: ['/d', '/s', '/c', 'npm.cmd', 'ci', '--omit=dev'],
  }
  : {
    executable: 'npm',
    args: ['ci', '--omit=dev'],
  };

const installNodeDependencies = async (pluginDir) => {
  const { executable, args } = dependencyInstallCommand();
  await execFileAsync(executable, args, { cwd: pluginDir, windowsHide: true });
};

export const installPlugin = async ({
  sourceDir,
  homeDir = os.homedir(),
  installDependencies = true,
}) => {
  const manifestPath = path.join(sourceDir, '.codex-plugin', 'plugin.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.name !== pluginName) throw new Error(`Pacote inválido: esperado ${pluginName}`);

  const pluginsRoot = path.join(homeDir, '.codex', 'plugins');
  const pluginDir = path.join(pluginsRoot, pluginName);
  const stagedDir = path.join(pluginsRoot, `.${pluginName}-installing`);
  const backupDir = path.join(pluginsRoot, `.${pluginName}-backup`);
  await mkdir(pluginsRoot, { recursive: true });
  await rm(stagedDir, { recursive: true, force: true });
  await cp(sourceDir, stagedDir, { recursive: true, filter: copyFilter });
  if (installDependencies) await installNodeDependencies(stagedDir);

  await rm(backupDir, { recursive: true, force: true });
  if (await exists(pluginDir)) await rename(pluginDir, backupDir);
  try {
    await rename(stagedDir, pluginDir);
    await rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (await exists(backupDir)) await rename(backupDir, pluginDir);
    throw error;
  }

  const marketplaceDir = path.join(homeDir, '.agents', 'plugins');
  const marketplacePath = path.join(marketplaceDir, 'marketplace.json');
  await mkdir(marketplaceDir, { recursive: true });
  let marketplace = {
    name: 'personal',
    interface: { displayName: 'Peterson — Plugins privados' },
    plugins: [],
  };
  if (await exists(marketplacePath)) {
    marketplace = JSON.parse(await readFile(marketplacePath, 'utf8'));
    await copyFile(marketplacePath, `${marketplacePath}.bak`);
  }
  if (!Array.isArray(marketplace.plugins)) marketplace.plugins = [];
  const existingIndex = marketplace.plugins.findIndex((plugin) => plugin?.name === pluginName);
  if (existingIndex >= 0) marketplace.plugins[existingIndex] = marketplaceEntry;
  else marketplace.plugins.push(marketplaceEntry);

  const temporaryMarketplace = `${marketplacePath}.tmp`;
  await writeFile(temporaryMarketplace, `${JSON.stringify(marketplace, null, 2)}\n`, 'utf8');
  await rename(temporaryMarketplace, marketplacePath);
  return { pluginDir, marketplacePath };
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    const siblingPackage = path.join(scriptDir, pluginName);
    const embeddedPackage = path.resolve(scriptDir, '..');
    const sourceDir = await exists(path.join(siblingPackage, '.codex-plugin', 'plugin.json'))
      ? siblingPackage
      : embeddedPackage;
    const result = await installPlugin({ sourceDir });
    console.log(`Plugin copiado para: ${result.pluginDir}`);
    console.log(`Marketplace atualizado: ${result.marketplacePath}`);
    console.log('Reinicie o ChatGPT Desktop e instale Peterson Carousel Suite em Plugins > Personal.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
