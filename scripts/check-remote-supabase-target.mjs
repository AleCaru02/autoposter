const FORBIDDEN_PROJECT_REFS = new Set([
  'ipazbzctivqquwndifxh',
  'lcrmqklqtkmufqbwfkhh',
]);
const REQUIRED_PROJECT_NAME = 'autoposter-production';

function fail(message) {
  throw new Error(`[remote-supabase-guard] ${message}`);
}

export function validateTarget({ ref, name, url }) {
  if (!ref) fail('SUPABASE_TARGET_PROJECT_REF is required');
  if (!/^[a-z0-9]{20}$/.test(ref)) fail(`invalid Supabase project ref format: ${ref}`);
  if (FORBIDDEN_PROJECT_REFS.has(ref)) fail(`ref ${ref} belongs to an existing protected project and is forbidden for Autoposter`);
  if (name !== REQUIRED_PROJECT_NAME) fail(`project name must be exactly ${REQUIRED_PROJECT_NAME}`);

  if (url) {
    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch {
      fail('SUPABASE_URL is not a valid URL');
    }
    const expected = `${ref}.supabase.co`;
    if (hostname !== expected) fail(`SUPABASE_URL hostname ${hostname} does not match target ref ${ref}`);
  }

  return { ref, name };
}

async function verifyRemote({ ref, name, accessToken }) {
  if (!accessToken) fail('SUPABASE_ACCESS_TOKEN is required with --verify-remote');
  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) fail(`Management API verification failed with HTTP ${response.status}`);
  const project = await response.json();
  const remoteRef = String(project.ref ?? project.id ?? '');
  const remoteName = String(project.name ?? '');
  if (remoteRef && remoteRef !== ref) fail(`remote project ref mismatch: ${remoteRef}`);
  if (remoteName !== name) fail(`remote project name mismatch: ${remoteName || '<empty>'}`);
  const status = String(project.status ?? project.state ?? 'unknown');
  console.log(`[remote-supabase-guard] REMOTE_PROJECT_VERIFIED ref=${ref} name=${name} status=${status}`);
}

function runSelfTest() {
  const good = validateTarget({
    ref: 'abcdefghijklmnopqrst',
    name: REQUIRED_PROJECT_NAME,
    url: 'https://abcdefghijklmnopqrst.supabase.co',
  });
  if (good.ref !== 'abcdefghijklmnopqrst') fail('self-test good target failed');

  for (const ref of FORBIDDEN_PROJECT_REFS) {
    let rejected = false;
    try { validateTarget({ ref, name: REQUIRED_PROJECT_NAME }); } catch { rejected = true; }
    if (!rejected) fail(`self-test failed to reject protected ref ${ref}`);
  }

  let wrongNameRejected = false;
  try { validateTarget({ ref: 'abcdefghijklmnopqrst', name: 'wrong-project' }); } catch { wrongNameRejected = true; }
  if (!wrongNameRejected) fail('self-test failed to reject wrong project name');

  let wrongUrlRejected = false;
  try {
    validateTarget({
      ref: 'abcdefghijklmnopqrst',
      name: REQUIRED_PROJECT_NAME,
      url: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co',
    });
  } catch { wrongUrlRejected = true; }
  if (!wrongUrlRejected) fail('self-test failed to reject mismatched project URL');

  console.log('[remote-supabase-guard] SELF_TEST_PASS');
}

const args = new Set(process.argv.slice(2));
if (args.has('--self-test')) {
  runSelfTest();
} else {
  const ref = process.env.SUPABASE_TARGET_PROJECT_REF ?? process.env.SUPABASE_PROJECT_REF ?? '';
  const name = process.env.SUPABASE_TARGET_PROJECT_NAME ?? process.env.SUPABASE_PROJECT_NAME ?? '';
  const url = process.env.SUPABASE_URL ?? '';
  const target = validateTarget({ ref, name, url });
  console.log(`[remote-supabase-guard] TARGET_OK ref=${target.ref} name=${target.name}`);
  if (args.has('--verify-remote')) {
    await verifyRemote({ ref: target.ref, name: target.name, accessToken: process.env.SUPABASE_ACCESS_TOKEN ?? '' });
  }
}
