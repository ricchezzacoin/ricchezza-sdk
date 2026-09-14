import {
  generateWallet,
  importFromMnemonic,
  importFromPrivateKey,
  unlockKeystore,
  getMnemonic,
  changePassword,
  validateMnemonic,
  validatePrivateKey,
  validateAddress,
} from './index.js';

const PW = 'correct-horse-battery-staple';
const WRONG_PW = 'wrong-password-123';

const div = (title: string) => console.log('\n═══ ' + title + ' ═══');
const ok = (msg: string) => console.log('  ✓ ' + msg);
const fail = (msg: string) => { console.log('  ✗ ' + msg); process.exit(1); };

async function run() {
  // ── 1. Generate ──────────────────────────────────────
  div('1. generateWallet');
  const gen = await generateWallet(PW);
  console.log('  Address:  ', gen.address);
  console.log('  Mnemonic: ', gen.mnemonic);
  console.log('  Keystore: ', JSON.stringify(gen.encryptedKeystore).substring(0, 80), '...');
  if (!gen.address.startsWith('ricz1')) fail('address prefix wrong');
  if (gen.mnemonic.split(' ').length !== 12) fail('mnemonic not 12 words');
  ok('address is ricz1..., mnemonic is 12 words, keystore encrypted');

  // ── 2. Unlock (correct password) ─────────────────────
  div('2. unlockKeystore — correct password');
  const unlocked = await unlockKeystore(gen.encryptedKeystore, PW);
  console.log('  Unlocked address:', unlocked.address);
  console.log('  Unlocked PK:     ', unlocked.privateKey);
  console.log('  Unlocked VK:     ', unlocked.viewKey);
  if (unlocked.address !== gen.address) fail('address changed after unlock');
  if (!unlocked.privateKey.startsWith('RPrivateKey1')) fail('PK prefix wrong');
  if (!unlocked.viewKey.startsWith('RViewKey1')) fail('VK prefix wrong');
  ok('unlocked successfully; keys round-tripped');

  // ── 3. Unlock (wrong password) — should throw ────────
  div('3. unlockKeystore — wrong password');
  try {
    await unlockKeystore(gen.encryptedKeystore, WRONG_PW);
    fail('unlock succeeded with wrong password — SECURITY BUG');
  } catch (e: any) {
    ok(`throws as expected: ${e.message}`);
  }

  // ── 4. Import from mnemonic — deterministic ──────────
  div('4. importFromMnemonic — same mnemonic gives same address');
  const imp = await importFromMnemonic(gen.mnemonic, PW);
  console.log('  Imported address:', imp.address);
  if (imp.address !== gen.address) fail('same mnemonic → different address');
  ok('deterministic: same mnemonic → same address');

  // ── 5. Import from private key ───────────────────────
  div('5. importFromPrivateKey');
  const imp2 = await importFromPrivateKey(unlocked.privateKey, PW);
  console.log('  Imported address:', imp2.address);
  if (imp2.address !== gen.address) fail('same PK → different address');
  ok('same private key → same address');

  // ── 6. getMnemonic ───────────────────────────────────
  div('6. getMnemonic');
  const shownMnemonic = await getMnemonic(gen.encryptedKeystore, PW);
  console.log('  Retrieved mnemonic:', shownMnemonic);
  if (shownMnemonic !== gen.mnemonic) fail('mnemonic changed round-trip');
  ok('mnemonic round-trip clean');

  // ── 7. getMnemonic on PK-imported wallet → null ──────
  div('7. getMnemonic on PK-imported wallet');
  const pkOnly = await getMnemonic(imp2.encryptedKeystore, PW);
  console.log('  Mnemonic:', pkOnly);
  if (pkOnly !== null) fail('should be null for PK-import');
  ok('null (correct — no mnemonic exists)');

  // ── 8. changePassword ────────────────────────────────
  div('8. changePassword');
  const NEW_PW = 'brand-new-password-456';
  const rotated = await changePassword(gen.encryptedKeystore, PW, NEW_PW);
  const unlockOld = await unlockKeystore(rotated, NEW_PW);
  if (unlockOld.address !== gen.address) fail('rotated keystore has different address');
  ok('rotated keystore unlocks with new password');
  try {
    await unlockKeystore(rotated, PW);
    fail('old password still works — rotation broken');
  } catch {
    ok('old password rejected on rotated keystore');
  }

  // ── 9. Validation ────────────────────────────────────
  div('9. validation helpers');
  if (!validateMnemonic(gen.mnemonic)) fail('valid mnemonic rejected');
  if (validateMnemonic('foo bar baz')) fail('invalid mnemonic accepted');
  ok('validateMnemonic works');

  if (!validatePrivateKey(unlocked.privateKey)) fail('valid PK rejected');
  if (validatePrivateKey('APrivateKey1foo')) fail('Aleo PK accepted');
  if (validatePrivateKey('garbage')) fail('garbage accepted as PK');
  ok('validatePrivateKey works');

  if (!validateAddress(gen.address)) fail('valid address rejected');
  if (validateAddress('aleo1foo')) fail('Aleo address accepted');
  if (validateAddress('nonsense')) fail('garbage accepted as address');
  ok('validateAddress works');

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ✓✓✓  ALL TESTS PASSED');
  console.log('═══════════════════════════════════════════════════════════');
}

run().catch((e) => {
  console.error('\n✗ Test failed:', e);
  process.exit(1);
});
