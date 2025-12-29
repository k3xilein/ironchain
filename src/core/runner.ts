import { startup, shutdown } from './lifecycle';
import { IronChainBot } from './bot';

let botInstance: IronChainBot | null = null;

export async function startBot(): Promise<void> {
  if (botInstance) return;
  botInstance = await startup();
  // start in background but don't await to allow caller to control
  botInstance.start().catch(err => {
    // Log to console as a last resort
    console.error('Bot runtime error:', err);
  });
}

export async function stopBot(): Promise<void> {
  if (!botInstance) return;
  try {
    await shutdown(botInstance);
  } finally {
    botInstance = null;
  }
}

export async function getStatus() {
  if (!botInstance) return { isRunning: false };
  return await botInstance.getStatus();
}

export async function getBalance() {
  if (!botInstance) return { sol: 0, usdc: 0 };
  return await botInstance.getBalance();
}

export function getActiveTrades() {
  if (!botInstance) return [];
  return botInstance.getActiveTrades();
}

// For CLI usage
if (require.main === module) {
  (async () => {
    console.log('Starting bot via runner...');
    await startBot();
  })();
}
