export function parseExportUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['www.figma.com', 'figma.com'].includes(url.hostname) || url.username || url.password) throw new Error('Expected a Figma HTTPS design URL.');
  const match = url.pathname.match(/^\/(?:design|file)\/([a-zA-Z0-9]+)(?:\/|$)/);
  const node = url.searchParams.get('node-id');
  if (!match || !node || !/^\d+[-:]\d+$/.test(node)) throw new Error('URL must include a file key and node-id.');
  return { fileKey: match[1], nodeId: node.replace('-', ':') };
}
