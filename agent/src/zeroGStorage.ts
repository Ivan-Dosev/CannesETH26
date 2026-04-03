/**
 * 0G Storage integration.
 * Uploads market metadata JSON to 0G decentralized storage and returns
 * a root hash stored on-chain as immutable AI provenance.
 */

import { ethers } from "ethers";
import { config } from "./config";
import { logger } from "./logger";

export interface MarketMetadata {
  version:         "1";
  generatedAt:     string;
  modelId:         string;
  question:        string;
  options:         string[];
  expiry:          number;
  chainlinkJobId:  string;
  resolutionApi:   string;
  resolutionPath:  string;
  confidence:      number;
  reasoning:       string;
  sources:         string[];
}

export async function uploadMarketMetadata(metadata: MarketMetadata): Promise<string> {
  // Skip real upload if no 0G private key configured
  if (!config.zeroG.privateKey || !config.zeroG.evmRpcUrl) {
    return mockHash(metadata);
  }

  try {
    const { MemData, Indexer } = await import("@0glabs/0g-ts-sdk");

    const provider = new ethers.JsonRpcProvider(config.zeroG.evmRpcUrl);
    const wallet   = new ethers.Wallet(config.zeroG.privateKey, provider);

    const jsonBytes = Buffer.from(JSON.stringify(metadata, null, 2));
    const memData   = new MemData(jsonBytes);

    const indexer = new Indexer(config.zeroG.storageNodeUrl);
    const [result, err] = await indexer.upload(memData, config.zeroG.evmRpcUrl, wallet);

    if (err) throw new Error(String(err));

    const uri = `0g://${result.rootHash}`;
    logger.info(`Uploaded to 0G Storage: ${uri}`);
    return uri;
  } catch (err: any) {
    logger.warn(`0G Storage upload failed (using mock hash): ${err.message}`);
    return mockHash(metadata);
  }
}

function mockHash(metadata: MarketMetadata): string {
  const hash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(metadata)));
  const uri  = `0g://mock-${hash.slice(2, 34)}`;
  logger.info(`0G mock hash: ${uri}`);
  return uri;
}
