# Ricchezza Wallet

Monorepo for Ricchezza Network wallet packages.

## Packages

- `packages/wallet-core` — key management (generate, import, encrypt, unlock)
- More coming: `chain-client`, `tx-builder`, `record-scanner`

## Setup

Requires Node 20+ and the ricchezza-sdk to be built locally at
`/home/puneetsingh/ricchezza-sdk/`.

```bash
npm install
```

## Test wallet-core

```bash
cd packages/wallet-core
npm test
```

## Endpoints

- Chain RPC: https://rpc.testnet.riczscan.com
- Explorer:  https://explorer.testnet.riczscan.com

## Related repos

- `ricchezza-sdk` — cryptographic SDK (WASM)
- `richezza-snarkvm` — chain VM
- `richezza-snarkos` — chain node
- `ricz-explorer-v2` — block explorer
