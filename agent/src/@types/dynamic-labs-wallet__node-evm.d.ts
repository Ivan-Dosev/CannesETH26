declare module "@dynamic-labs-wallet/node-evm" {
  export interface EvmWallet {
    walletId: string;
    accountAddress: string;
    chainName: string;
    externalServerKeyShares: any[];
    derivationPath: string;
    thresholdSignatureScheme: string;
  }

  export interface CreatedWallet {
    walletId: string;
    accountAddress: string;
    rawPublicKey: any;
    publicKeyHex: string;
    externalServerKeyShares: any[];
    externalKeySharesWithBackupStatus: any;
  }

  export interface DynamicEvmWalletClientOptions {
    environmentId: string;
    baseApiUrl?: string;
    enableMPCAccelerator?: boolean;
    debug?: boolean;
  }

  export class DynamicEvmWalletClient {
    constructor(options: DynamicEvmWalletClientOptions);
    authenticateApiToken(authToken: string): Promise<void>;
    getEvmWallets(): Promise<EvmWallet[]>;
    createWalletAccount(options: {
      thresholdSignatureScheme: string;
      password?: string;
      backUpToClientShareService?: boolean;
    }): Promise<CreatedWallet>;
    signTransaction(options: {
      senderAddress: string;
      transaction: Record<string, unknown>;
      password?: string;
      externalServerKeyShares?: any[];
    }): Promise<string>;
    signMessage(options: {
      message: string;
      accountAddress: string;
      password?: string;
      externalServerKeyShares?: any[];
    }): Promise<string>;
  }
}
