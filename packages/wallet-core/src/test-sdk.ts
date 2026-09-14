import { PrivateKey } from '@provablehq/sdk';

console.log('===== SDK compatibility test =====\n');

try {
  const pk = new PrivateKey();
  console.log('  Private key:', pk.to_string());
  console.log('  View key:   ', pk.to_view_key().to_string());
  console.log('  Address:    ', pk.to_address().to_string());

  const addr = pk.to_address().to_string();
  console.log('\n===== Prefix analysis =====');
  console.log('  Address:', addr.substring(0, 5));
  console.log('  PrivKey:', pk.to_string().substring(0, 12));
  console.log('  ViewKey:', pk.to_view_key().to_string().substring(0, 8));

  if (addr.startsWith('ricz1')) {
    console.log('\n  ✓ COMPATIBLE — SDK works with Ricchezza');
  } else if (addr.startsWith('aleo1')) {
    console.log('\n  ✗ INCOMPATIBLE — SDK hardcoded for Aleo, need to fork');
  } else {
    console.log('\n  ? Unknown prefix');
  }
} catch (e: unknown) {
  const err = e as Error;
  console.log('  ERROR:', err.message);
  console.log('\nStack:', err.stack);
}
