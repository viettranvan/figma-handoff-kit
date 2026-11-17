import { readFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function shouldPublish(version, versions) {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stable.test(version)) throw new Error('Only stable x.y.z releases are supported.');
  if (!Array.isArray(versions) || !versions.every(v => typeof v === 'string')) throw new Error('Invalid registry version list.');
  if (versions.includes(version)) return false;
  const current = version.split('.').map(Number);
  for (const published of versions.filter(v => stable.test(v))) {
    const other = published.split('.').map(Number);
    const difference = current.map((n, i) => n - other[i]).find(n => n !== 0);
    if (difference < 0) throw new Error(`Version ${version} is older than published ${published}.`);
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  // A registry/network/auth error must fail the job, never imply an unpublished version.
  const versions = JSON.parse(execFileSync('npm', ['view', pkg.name, 'versions', '--json', '--registry=https://registry.npmjs.org'], { encoding: 'utf8' }));
  const publish = shouldPublish(pkg.version, versions);
  console.log(publish ? `Publish ${pkg.name}@${pkg.version}` : `Skip: ${pkg.version} already exists on npm.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
}
