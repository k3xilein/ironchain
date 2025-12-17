import { Connection } from '@solana/web3.js';

export async function testRPCConnection(rpcUrl: string): Promise<boolean> {
  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    const version = await connection.getVersion();
    console.log('✅ RPC connection successful:', version);
    return true;
  } catch (error) {
    console.error('❌ RPC connection failed:', error);
    return false;
  }
}

export function validatePositiveNumber(value: number, name: string): void {
  if (value <= 0 || isNaN(value)) {
    throw new Error(`${name} must be a positive number`);
  }
}

export function validatePercentage(value: number, name: string): void {
  if (value < 0 || value > 1 || isNaN(value)) {
    throw new Error(`${name} must be between 0 and 1`);
  }
}