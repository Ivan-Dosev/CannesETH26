// Singleton deployer wallet with NonceManager.
// NonceManager tracks nonces in-process, atomically — prevents "nonce too low"
// when create-markets and resolve-pending fire simultaneously.
import { ethers } from "ethers";

const ARC_RPC      = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY!;

let _wallet: ethers.NonceManager | null = null;

export function getDeployerWallet(): ethers.NonceManager {
  if (!_wallet) {
    const provider = new ethers.JsonRpcProvider(ARC_RPC);
    const signer   = new ethers.Wallet(DEPLOYER_KEY, provider);
    _wallet        = new ethers.NonceManager(signer);
  }
  return _wallet;
}
