const fs = require('fs');
const path = require('path');
const ethers = require('ethers');
const yaml = require('js-yaml');
const winston = require('winston');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// Network constants - hardcoded instead of in config
const NETWORK = {
  rpcUrl: 'https://tea-sepolia.g.alchemy.com/public',
  chainId: 10218,
  routerAddress: '0xE15efbaA098AA81BaB70c471FeA760684dc776ae',
  wethAddress: '0x7752dBd604a5C43521408ee80486853dCEb4cceB'
};

// ABIs - Only including the functions we need to minimize unnecessary data
const ROUTER_ABI = [
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'
];

const ERC20_ABI = [
  'function balanceOf(address owner) external view returns (uint)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function approve(address spender, uint amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint)'
];

// Setup logger
const createLogger = (threadId = 'main') => {
  return winston.createLogger({
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] ${message}`;
      })
    ),
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({ 
        filename: `logs/swap_${new Date().toISOString().split('T')[0]}_thread_${threadId}.log`,
        dirname: 'logs' 
      })
    ]
  });
};

// Create main logger
const logger = createLogger();

// Ensure log directory exists
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs', { recursive: true });
}

/**
 * Token list for Tea Sepolia
 */
const TOKEN_LIST = [
  {
    address: '0xdf1aAdF0FdFb14Ae4Cbe9bF550E1716Ed901b41C',
    name: 'NotAScam',
    symbol: 'NSCM',
    decimals: 18
  },
  {
    address: '0xD89455C62BeC95820cE048fbE0f2Ae900F18A2DC',
    name: 'Fresh Tea',
    symbol: 'FTEA',
    decimals: 18
  },
  {
    address: '0xb1885A41876ff1BcB107a80A352A800b3D394f6F',
    name: 'Daun Tea',
    symbol: 'DAUN',
    decimals: 18
  },
  {
    address: '0x0281e0e9Df9920E994051fC3798fd1565F6d28BF',
    name: 'Tea Leaf',
    symbol: 'LEAF',
    decimals: 18
  },
  {
    address: '0x7d7D20Ea5afb64Fc7beC15ba4670FF08B5E838b6',
    name: 'Herbal Tea',
    symbol: 'HBRL',
    decimals: 18
  },
  {
    address: '0xdbCb51116b426F67a727dA75EE7119fb88D1069A',
    name: 'AAA Token',
    symbol: 'AAA',
    decimals: 18
  },
  {
    address: '0xE8976C1873dD34B1262f8096E63a95AdE4d88997',
    name: 'Tea Anget',
    symbol: 'TEAA',
    decimals: 18
  },
  {
    address: '0xd2325fB82bb3122D9656D87F4aCF01e4D535d7Ea',
    name: 'Matcha',
    symbol: 'MATCHA',
    decimals: 18
  },
  {
    address: '0x5E5613bAEE77215c6781635e48E7fcc4B3d02790',
    name: 'Project Nomad',
    symbol: 'P0N',
    decimals: 18
  },
  {
    address: '0x8e7Ae8eb29FbF68fdEea6ef0daBEb2C9F7fAB366',
    name: 'Candy',
    symbol: 'CANDY',
    decimals: 18
  },
  {
    address: '0xbBb017586E75C465Cc52cBE4c6b2B71d4baED5c6',
    name: 'Mommycoin',
    symbol: 'MOM',
    decimals: 18
  },
  {
    address: '0x09bA156Aaf3505d07b6F82872b35D75b7A7d5032',
    name: 'sTEA Token',
    symbol: 'sTEA',
    decimals: 18
  },
  {
    address: '0x615a02020b4cd1171551e3379491B825315ce77B',
    name: 'AssamBTC',
    symbol: 'BTC',
    decimals: 18
  },
  {
    address: '0x2b3aBf76D9D2eD4Eb2975D5DBb6981B77DF06E5A',
    name: 'MeowTea Token',
    symbol: 'MTN',
    decimals: 18
  },
  {
    address: '0xE1b512683cb5c3d56D462dB326a6632EeEbb60BB',
    name: 'TeaDogs Inu',
    symbol: 'TGS',
    decimals: 18
  },
  {
    address: '0xF3b6ebeA3B46694a76e760B8970EFfC76Ee8b96A',
    name: 'Diontea Token V1',
    symbol: 'DTT1',
    decimals: 18
  }
];

/**
 * Load configuration from config.yaml
 * @returns {Object} Configuration object
 */
function loadConfig() {
  try {
    if (!fs.existsSync('./config.yaml')) {
      logger.error('Configuration file not found. Please create config.yaml');
      process.exit(1);
    }
    
    const configFile = fs.readFileSync('./config.yaml', 'utf8');
    return yaml.load(configFile);
  } catch (error) {
    logger.error(`Error loading configuration: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Generate a random swap amount between min and max with 5 decimal places
 * @param {number} min Minimum swap amount
 * @param {number} max Maximum swap amount
 * @returns {string} Random amount as string with 5 decimal places
 */
function generateRandomAmount(min, max) {
  const randomAmount = Math.random() * (max - min) + min;
  return randomAmount.toFixed(5);
}

/**
 * Generate a random delay between min and max seconds
 * @param {number} min Minimum delay in seconds
 * @param {number} max Maximum delay in seconds
 * @returns {number} Random delay in milliseconds
 */
function generateRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min) * 1000;
}

/**
 * Select a random token from the token list
 * @returns {Object} Randomly selected token object
 */
function selectRandomToken() {
  const randomIndex = Math.floor(Math.random() * TOKEN_LIST.length);
  return TOKEN_LIST[randomIndex];
}

/**
 * Load private keys from pk.txt file
 * @returns {Array} List of private keys
 */
function loadPrivateKeys() {
  try {
    if (!fs.existsSync('./pk.txt')) {
      logger.error('Private key file (pk.txt) not found. Please create it with one private key per line.');
      process.exit(1);
    }
    
    const content = fs.readFileSync('./pk.txt', 'utf8');
    const keys = content.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')); // Remove empty lines and comments
    
    if (keys.length === 0) {
      logger.error('No private keys found in pk.txt. Please add at least one private key.');
      process.exit(1);
    }
    
    return keys;
  } catch (error) {
    logger.error(`Error loading private keys: ${error.message}`);
    process.exit(1);
  }
}

/**
 * SwapManager class - Handles all swap operations
 */
class SwapManager {
  constructor(threadId = 'main', walletIndices = []) {
    this.threadId = threadId;
    this.walletIndices = walletIndices;
    this.config = loadConfig();
    this.privateKeys = loadPrivateKeys();
    this.filteredKeys = walletIndices.map(index => this.privateKeys[index]);
    this.currentKeyIndex = 0;
    this.provider = new ethers.providers.JsonRpcProvider(NETWORK.rpcUrl);
    this.router = new ethers.Contract(
      NETWORK.routerAddress, 
      ROUTER_ABI, 
      this.provider
    );
    
    // Create thread-specific logger
    this.logger = createLogger(threadId);
    
    this.logger.info(`SwapManager initialized with ${this.filteredKeys.length} wallet(s) on thread ${threadId}`);
    this.logger.info(`Managing wallets with indices: ${walletIndices.join(', ')}`);
    
    // Calculate countdown duration in milliseconds
    this.countdownDuration = this.config.timeBetweenSwaps * 60 * 60 * 1000;
  }

  /**
   * Get current wallet based on rotation strategy
   * @returns {Object} Current wallet and signer
   */
  getCurrentWallet() {
    const privateKey = this.filteredKeys[this.currentKeyIndex];
    const walletIndex = this.walletIndices[this.currentKeyIndex];
    const wallet = new ethers.Wallet(privateKey, this.provider);
    
    // Rotate to next wallet for next swap
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.filteredKeys.length;
    
    this.logger.info(`[Wallet ${walletIndex}] Using wallet ${this.currentKeyIndex === 0 ? this.filteredKeys.length : this.currentKeyIndex}/${this.filteredKeys.length}, address: ${wallet.address.substring(0, 10)}...`);
    
    return { wallet, walletIndex };
  }

  /**
   * Get token information
   * @param {string} tokenAddress Token contract address
   * @returns {Promise<Object>} Token info (symbol, name, decimals)
   */
  async getTokenInfo(tokenAddress) {
    // First, check if we already have this token in our list
    const tokenInfo = TOKEN_LIST.find(token => token.address.toLowerCase() === tokenAddress.toLowerCase());
    if (tokenInfo) {
      return tokenInfo;
    }
    
    // If not in our list, fetch from the contract
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    
    try {
      const [symbol, name, decimals] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.name(),
        tokenContract.decimals()
      ]);
      
      return { symbol, name, decimals, address: tokenAddress };
    } catch (error) {
      this.logger.error(`Error getting token info for ${tokenAddress}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check and approve token allowance if needed
   * @param {string} tokenAddress Token address
   * @param {ethers.BigNumber} amount Amount to approve
   * @param {ethers.Wallet} wallet Wallet to use for approval
   * @param {number} walletIndex Index of the wallet
   * @returns {Promise<void>}
   */
  async checkAllowance(tokenAddress, amount, wallet, walletIndex) {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    const allowance = await tokenContract.allowance(wallet.address, NETWORK.routerAddress);
    
    if (allowance.lt(amount)) {
      this.logger.info(`[Wallet ${walletIndex}] Approving router to spend ${tokenAddress} for wallet ${wallet.address.substring(0, 10)}...`);
      const tokenWithSigner = tokenContract.connect(wallet);
      const tx = await tokenWithSigner.approve(
        NETWORK.routerAddress,
        ethers.constants.MaxUint256 // Approve max amount
      );
      await tx.wait();
      this.logger.info(`[Wallet ${walletIndex}] Approval transaction confirmed: ${tx.hash}`);
    }
  }

  /**
   * Get current gas price with multiplier for faster confirmation
   * @returns {Promise<ethers.BigNumber>} Gas price
   */
  async getGasPrice() {
    try {
      // Get current gas price and add configured percentage
      const gasPrice = await this.provider.getGasPrice();
      const multiplier = Math.floor(this.config.transaction.gasPriceMultiplier * 100);
      return gasPrice.mul(multiplier).div(100);
    } catch (error) {
      this.logger.error(`Error getting gas price: ${error.message}`);
      // Fallback gas price - 5 Gwei
      return ethers.utils.parseUnits('5', 'gwei');
    }
  }

  /**
   * Perform a swap with a specific wallet
   * @param {ethers.Wallet} wallet Wallet to use for the swap
   * @param {number} walletIndex Index of the wallet
   * @param {string} tokenAddress Token to swap to
   * @param {string} amountInEth Amount of ETH to swap
   * @param {number} swapIndex Current swap index
   * @returns {Promise<boolean>} Success status
   */
  async performSwap(wallet, walletIndex, tokenAddress, amountInEth, swapIndex) {
    const tokenInfo = await this.getTokenInfo(tokenAddress);
    const amountIn = ethers.utils.parseEther(amountInEth);
    
    this.logger.info(`[Wallet ${walletIndex}] Starting swap ${swapIndex}: ${amountInEth} TEA → ${tokenInfo.symbol} (${tokenInfo.name}) using wallet ${wallet.address}`);
    
    try {
      // Check wallet balance
      const balance = await this.provider.getBalance(wallet.address);
      if (balance.lt(amountIn)) {
        this.logger.error(`[Wallet ${walletIndex}] Insufficient balance: Required ${amountInEth} TEA, have ${ethers.utils.formatEther(balance)} TEA for wallet ${wallet.address}`);
        return false;
      }
      
      // Calculate expected output and minimum output
      const path = [NETWORK.wethAddress, tokenAddress];
      const amountsOut = await this.router.getAmountsOut(amountIn, path);
      const expectedOutput = amountsOut[1];
      const slippage = this.config.transaction.slippage;
      const minOutput = expectedOutput.mul(1000 - Math.floor(slippage * 10)).div(1000);
      
      this.logger.info(`[Wallet ${walletIndex}] Expected output: ${ethers.utils.formatUnits(expectedOutput, tokenInfo.decimals)} ${tokenInfo.symbol}`);
      this.logger.info(`[Wallet ${walletIndex}] Minimum output (${slippage}% slippage): ${ethers.utils.formatUnits(minOutput, tokenInfo.decimals)} ${tokenInfo.symbol}`);
      
      // Prepare transaction parameters
      const deadline = Math.floor(Date.now() / 1000) + (60 * this.config.transaction.timeoutMinutes);
      const gasPrice = await this.getGasPrice();
      
      // Execute swap with retry logic
      let attempt = 0;
      let success = false;
      let lastError;
      
      while (attempt < this.config.transaction.maxRetries && !success) {
        try {
          if (attempt > 0) {
            this.logger.info(`[Wallet ${walletIndex}] Retry attempt ${attempt + 1}/${this.config.transaction.maxRetries}...`);
          }
          
          const routerWithSigner = this.router.connect(wallet);
          
          // Create transaction object for gas estimation
          const txObject = {
            value: amountIn,
            gasPrice
          };
          
          // Estimate gas instead of using a fixed limit
          try {
            const estimatedGas = await routerWithSigner.estimateGas.swapExactETHForTokens(
              minOutput,
              path,
              wallet.address,
              deadline,
              txObject
            );
            
            // Add 20% buffer to estimated gas
            txObject.gasLimit = estimatedGas.mul(120).div(100);
            this.logger.info(`[Wallet ${walletIndex}] Estimated gas: ${estimatedGas.toString()}, with buffer: ${txObject.gasLimit.toString()}`);
          } catch (gasEstimationError) {
            this.logger.error(`[Wallet ${walletIndex}] Gas estimation failed: ${gasEstimationError.message}`);
            // Fallback to a safe gas limit if estimation fails
            txObject.gasLimit = 300000;
            this.logger.info(`[Wallet ${walletIndex}] Using fallback gas limit: ${txObject.gasLimit}`);
          }
          
          // No delay before sending transaction
          
          const tx = await routerWithSigner.swapExactETHForTokens(
            minOutput,
            path,
            wallet.address,
            deadline,
            txObject
          );
          
          this.logger.info(`[Wallet ${walletIndex}] Transaction submitted: ${tx.hash}`);
          const receipt = await tx.wait();
          
          this.logger.info(`[Wallet ${walletIndex}] Swap successful! Transaction confirmed in block ${receipt.blockNumber}`);
          success = true;
          
          // Log updated balances
          await this.logBalances(tokenAddress, tokenInfo, wallet, walletIndex);
        } catch (error) {
          lastError = error;
          const errorMessage = error.reason || error.message || 'Unknown error';
          this.logger.error(`[Wallet ${walletIndex}] Swap attempt ${attempt + 1} failed: ${errorMessage}`);
          attempt++;
          
          if (attempt < this.config.transaction.maxRetries) {
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, this.config.transaction.retryDelay));
          }
        }
      }
      
      if (!success) {
        this.logger.error(`[Wallet ${walletIndex}] All swap attempts failed after ${this.config.transaction.maxRetries} retries.`);
      }
      
      return success;
    } catch (error) {
      this.logger.error(`[Wallet ${walletIndex}] Error in performSwap: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Log current wallet balances
   * @param {string} tokenAddress Token address to check balance
   * @param {Object} tokenInfo Token information
   * @param {ethers.Wallet} wallet Wallet to check balances for
   * @param {number} walletIndex Index of the wallet
   * @returns {Promise<void>}
   */
  async logBalances(tokenAddress, tokenInfo, wallet, walletIndex) {
    try {
      const ethBalance = await this.provider.getBalance(wallet.address);
      const formattedEthBalance = ethers.utils.formatEther(ethBalance);
      
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const tokenBalance = await tokenContract.balanceOf(wallet.address);
      const formattedTokenBalance = ethers.utils.formatUnits(tokenBalance, tokenInfo.decimals);
      
      this.logger.info(`[Wallet ${walletIndex}] Current balances for wallet ${wallet.address.substring(0, 10)}...:`);
      this.logger.info(`[Wallet ${walletIndex}] - TEA: ${formattedEthBalance}`);
      this.logger.info(`[Wallet ${walletIndex}] - ${tokenInfo.symbol}: ${formattedTokenBalance}`);
    } catch (error) {
      this.logger.error(`[Wallet ${walletIndex}] Error getting balances: ${error.message}`);
    }
  }
  
  /**
   * Execute swaps for assigned wallets in this thread
   * @returns {Promise<number>} Total number of successful swaps
   */
  async executeSwapsForAssignedWallets() {
    let totalSuccessfulSwaps = 0;
    
    // For each wallet assigned to this thread
    for (let i = 0; i < this.walletIndices.length; i++) {
      const walletIndex = this.walletIndices[i];
      const wallet = new ethers.Wallet(this.privateKeys[walletIndex], this.provider);
      
      this.logger.info(`[Wallet ${walletIndex}] Processing wallet ${i + 1}/${this.walletIndices.length}: ${wallet.address}`);
      
      // Perform configured number of swaps with this wallet
      for (let swapIndex = 0; swapIndex < this.config.swapsPerWallet; swapIndex++) {
        try {
          // Generate random amount for this swap
          const randomAmount = generateRandomAmount(
            this.config.swap.minAmount, 
            this.config.swap.maxAmount
          );
          
          // Select random token
          const randomToken = selectRandomToken();
          
          this.logger.info(`[Wallet ${walletIndex}] Swap ${swapIndex + 1}/${this.config.swapsPerWallet} initiated`);
          this.logger.info(`[Wallet ${walletIndex}] Random amount: ${randomAmount} TEA, Token: ${randomToken.symbol}`);
          
          // Execute the swap with this specific wallet
          const success = await this.performSwap(wallet, walletIndex, randomToken.address, randomAmount, swapIndex + 1);
          
          if (success) {
            totalSuccessfulSwaps++;
          } else {
            this.logger.error(`[Wallet ${walletIndex}] Swap failed for wallet ${wallet.address}. Continuing with next swap...`);
            // Add a short delay before trying the next swap
            await new Promise(resolve => setTimeout(resolve, 30 * 1000)); // 30 second delay
          }
          
          // Add a short delay between swaps for the same wallet
          if (swapIndex < this.config.swapsPerWallet - 1) {
            const betweenSwapsDelay = generateRandomDelay(3, 10); // 3-10 seconds
            this.logger.info(`[Wallet ${walletIndex}] Waiting ${betweenSwapsDelay/1000} seconds before next swap...`);
            await new Promise(resolve => setTimeout(resolve, betweenSwapsDelay));
          }
        } catch (error) {
          this.logger.error(`[Wallet ${walletIndex}] Error processing swap for wallet ${wallet.address}: ${error.message}`);
        }
      }
      
      // Add delay between processing different wallets
      if (i < this.walletIndices.length - 1) {
        const betweenWalletsDelay = generateRandomDelay(10, 30); // 10-30 seconds
        this.logger.info(`[Wallet ${walletIndex}] All swaps completed for wallet ${wallet.address}. Waiting ${betweenWalletsDelay/1000} seconds before processing next wallet...`);
        await new Promise(resolve => setTimeout(resolve, betweenWalletsDelay));
      }
    }
    
    return totalSuccessfulSwaps;
  }
  
  /**
   * Start the swap loop for this thread
   */
  async startSwapLoop() {
    this.logger.info(`Starting the automated swap process...`);
    
    // Run forever, processing assigned wallets then waiting for next cycle
    while (true) {
      try {
        this.logger.info(`Starting a new cycle for assigned wallets`);
        
        // Execute swaps for all wallets
        const totalSuccessfulSwaps = await this.executeSwapsForAssignedWallets();
        
        this.logger.info(`Cycle completed with ${totalSuccessfulSwaps} successful swaps`);
        
        // Start countdown for next cycle
        const nextCycleTime = new Date(Date.now() + this.countdownDuration);
        this.logger.info(`Next cycle will occur in ${this.config.timeBetweenSwaps} hours (${nextCycleTime.toLocaleString()})`);
        
        // Wait for the configured time between cycles
        await new Promise(resolve => setTimeout(resolve, this.countdownDuration));
      } catch (error) {
        this.logger.error(`Error in cycle execution: ${error.message}`);
        // If there's an error in the cycle execution, wait a bit before starting the next cycle
        await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000)); // 10 minutes
      }
    }
  }
}

/**
 * Worker thread function - handles individual wallets
 */
if (!isMainThread) {
  const { threadId, walletIndices } = workerData;
  
  // Create worker-specific logger
  const workerLogger = createLogger(threadId);
  workerLogger.info(`Starting with wallets: ${walletIndices.join(', ')}`);
  
  // Create a SwapManager for the subset of wallets assigned to this thread
  const swapManager = new SwapManager(threadId, walletIndices);
  
  // Start the swap loop for this thread
  swapManager.startSwapLoop()
    .catch(error => {
      workerLogger.error(`Fatal error: ${error.message}`);
      process.exit(1);
    });
}

/**
 * Main function to start the application and distribute wallets to threads
 */
async function main() {
  if (!isMainThread) return; // Only run in the main thread
  
  logger.info('Initializing Auto Swap Script for Tea Sepolia with threading support');
  
  try {
    const config = loadConfig();
    const privateKeys = loadPrivateKeys();
    const numWallets = privateKeys.length;
    
    // Default to 1 thread if not specified in config
    const numThreads = config.threads || 1;
    
    logger.info(`Configuration loaded: ${numWallets} wallets, ${numThreads} threads`);
    
    if (numThreads <= 1) {
      // Single-threaded mode
      logger.info('Running in single-threaded mode');
      const walletIndices = Array.from({ length: numWallets }, (_, i) => i);
      const swapManager = new SwapManager('main', walletIndices);
      await swapManager.startSwapLoop();
    } else {
      // Multi-threaded mode
      logger.info(`Running in multi-threaded mode with ${numThreads} threads`);
      
      // Distribute wallets among threads as evenly as possible
      const walletIndices = Array.from({ length: numWallets }, (_, i) => i);
      const walletDistribution = distributeWallets(walletIndices, numThreads);
      
      // Start worker threads
      for (let i = 0; i < numThreads; i++) {
        const threadId = `thread-${i + 1}`;
        const threadWallets = walletDistribution[i];
        
        logger.info(`Starting with wallets: ${threadWallets.join(', ')}`);
        
        // Create and start worker thread
        const worker = new Worker(__filename, {
          workerData: {
            threadId,
            walletIndices: threadWallets
          }
        });
        
        // Handle worker messages and errors
        worker.on('error', (error) => {
          logger.error(`Worker ${threadId} error: ${error.message}`);
        });
        
        worker.on('exit', (code) => {
          if (code !== 0) {
            logger.error(`Worker ${threadId} exited with code ${code}`);
          }
        });
      }
      
      logger.info('All worker threads started successfully');
    }
  } catch (error) {
    logger.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Distribute wallets evenly among threads
 * @param {Array} walletIndices Array of wallet indices to distribute
 * @param {number} numThreads Number of threads to distribute to
 * @returns {Array} Array of arrays, each containing wallet indices for a thread
 */
function distributeWallets(walletIndices, numThreads) {
  const distribution = Array.from({ length: numThreads }, () => []);
  
  for (let i = 0; i < walletIndices.length; i++) {
    const threadIndex = i % numThreads;
    distribution[threadIndex].push(walletIndices[i]);
  }
  
  return distribution;
}

// Handle termination signals
process.on('SIGINT', () => {
  logger.info('\nService is shutting down gracefully...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

// Only start the application from the main thread
if (isMainThread) {
  main().catch(error => {
    logger.error(`Error in main execution: ${error.message}`);
    process.exit(1);
  });
}
