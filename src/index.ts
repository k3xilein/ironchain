import { startup, shutdown } from './core/lifecycle';

async function main() {
  let bot;
  
  try {
    // Start bot
    bot = await startup();
    await bot.start();
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    
    if (bot) {
      await shutdown(bot);
    }
    
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Shutdown signal received');
  process.exit(0);
});

main();