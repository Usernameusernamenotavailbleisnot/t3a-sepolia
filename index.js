const fs = require('fs');
const path = require('path');
const ethers = require('ethers');
const yaml = require('js-yaml');
const winston = require('winston');

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
const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: `logs/swap_${new Date().toISOString().split('T')[0]}.log`,
      dirname: 'logs' 
    })
  ]
});

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
  constructor() {
    this.config = loadConfig();
    this.privateKeys = loadPrivateKeys();
    this.currentKeyIndex = 0;
    this.provider = new ethers.providers.JsonRpcProvider(NETWORK.rpcUrl);
    this.router = new ethers.Contract(
      NETWORK.routerAddress, 
      ROUTER_ABI, 
      this.provider
    );
    
    logger.info(`SwapManager initialized with ${this.privateKeys.length} wallet(s)`);
    
    // Calculate countdown duration in milliseconds (25 hours)
    this.countdownDuration = this.config.timeBetweenSwaps * 60 * 60 * 1000;
  }

  /**
   * Get current wallet based on rotation strategy
   * @returns {Object} Current wallet and signer
   */
  getCurrentWallet() {
    const privateKey = this.privateKeys[this.currentKeyIndex];
    const wallet = new ethers.Wallet(privateKey, this.provider);
    
    // Rotate to next wallet for next swap
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.privateKeys.length;
    
    return wallet;
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
      logger.error(`Error getting token info for ${tokenAddress}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check and approve token allowance if needed
   * @param {string} tokenAddress Token address
   * @param {ethers.BigNumber} amount Amount to approve
   * @param {ethers.Wallet} wallet Wallet to use for approval
   * @returns {Promise<void>}
   */
  async checkAllowance(tokenAddress, amount, wallet) {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    const allowance = await tokenContract.allowance(wallet.address, NETWORK.routerAddress);
    
    if (allowance.lt(amount)) {
      logger.info(`Approving router to spend ${tokenAddress} for wallet ${wallet.address.substring(0, 10)}...`);
      const tokenWithSigner = tokenContract.connect(wallet);
      const tx = await tokenWithSigner.approve(
        NETWORK.routerAddress,
        ethers.constants.MaxUint256 // Approve max amount
      );
      await tx.wait();
      logger.info(`Approval transaction confirmed: ${tx.hash}`);
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
      logger.error(`Error getting gas price: ${error.message}`);
      // Fallback gas price - 5 Gwei
      return ethers.utils.parseUnits('5', 'gwei');
    }
  }

  /**
   * Swap exact ETH for tokens
   * @param {string} tokenAddress Destination token address
   * @param {string} amountInEth Amount of ETH to swap
   * @param {number} swapIndex Current swap index in batch
   * @returns {Promise<boolean>} Success status
   */
  async swapETHForToken(tokenAddress, amountInEth, swapIndex) {
    const tokenInfo = await this.getTokenInfo(tokenAddress);
    const amountIn = ethers.utils.parseEther(amountInEth);
    const wallet = this.getCurrentWallet();
    
    logger.info(`Starting swap ${swapIndex}/${this.config.maxSwapsPerBatch}: ${amountInEth} TEA → ${tokenInfo.symbol} (${tokenInfo.name}) using wallet ${wallet.address.substring(0, 10)}...`);
    
    try {
      // Check wallet balance
      const balance = await this.provider.getBalance(wallet.address);
      if (balance.lt(amountIn)) {
        logger.error(`Insufficient balance: Required ${amountInEth} TEA, have ${ethers.utils.formatEther(balance)} TEA for wallet ${wallet.address.substring(0, 10)}`);
        return false;
      }
      
      // Calculate expected output and minimum output
      const path = [NETWORK.wethAddress, tokenAddress];
      const amountsOut = await this.router.getAmountsOut(amountIn, path);
      const expectedOutput = amountsOut[1];
      const slippage = this.config.transaction.slippage;
      const minOutput = expectedOutput.mul(1000 - Math.floor(slippage * 10)).div(1000);
      
      logger.info(`Expected output: ${ethers.utils.formatUnits(expectedOutput, tokenInfo.decimals)} ${tokenInfo.symbol}`);
      logger.info(`Minimum output (${slippage}% slippage): ${ethers.utils.formatUnits(minOutput, tokenInfo.decimals)} ${tokenInfo.symbol}`);
      
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
            logger.info(`Retry attempt ${attempt + 1}/${this.config.transaction.maxRetries}...`);
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
            logger.info(`Estimated gas: ${estimatedGas.toString()}, with buffer: ${txObject.gasLimit.toString()}`);
          } catch (gasEstimationError) {
            logger.error(`Gas estimation failed: ${gasEstimationError.message}`);
            // Fallback to a safe gas limit if estimation fails
            txObject.gasLimit = 300000;
            logger.info(`Using fallback gas limit: ${txObject.gasLimit}`);
          }
          
          // Random delay before sending transaction (2-5 seconds)
          const delayMs = generateRandomDelay(2, 5);
          logger.info(`Adding random delay of ${delayMs/1000} seconds before sending transaction...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          
          const tx = await routerWithSigner.swapExactETHForTokens(
            minOutput,
            path,
            wallet.address,
            deadline,
            txObject
          );
          
          logger.info(`Transaction submitted: ${tx.hash}`);
          const receipt = await tx.wait();
          
          logger.info(`Swap successful! Transaction confirmed in block ${receipt.blockNumber}`);
          success = true;
          
          // Log updated balances
          await this.logBalances(tokenAddress, tokenInfo, wallet);
        } catch (error) {
          lastError = error;
          const errorMessage = error.reason || error.message || 'Unknown error';
          logger.error(`Swap attempt ${attempt + 1} failed: ${errorMessage}`);
          attempt++;
          
          if (attempt < this.config.transaction.maxRetries) {
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, this.config.transaction.retryDelay));
          }
        }
      }
      
      if (!success) {
        logger.error(`All swap attempts failed after ${this.config.transaction.maxRetries} retries.`);
      }
      
      return success;
    } catch (error) {
      logger.error(`Error in swapETHForToken: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Log current wallet balances
   * @param {string} tokenAddress Token address to check balance
   * @param {Object} tokenInfo Token information
   * @param {ethers.Wallet} wallet Wallet to check balances for
   * @returns {Promise<void>}
   */
  async logBalances(tokenAddress, tokenInfo, wallet) {
    try {
      const ethBalance = await this.provider.getBalance(wallet.address);
      const formattedEthBalance = ethers.utils.formatEther(ethBalance);
      
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const tokenBalance = await tokenContract.balanceOf(wallet.address);
      const formattedTokenBalance = ethers.utils.formatUnits(tokenBalance, tokenInfo.decimals);
      
      logger.info(`Current balances for wallet ${wallet.address.substring(0, 10)}...:`);
      logger.info(`- TEA: ${formattedEthBalance}`);
      logger.info(`- ${tokenInfo.symbol}: ${formattedTokenBalance}`);
    } catch (error) {
      logger.error(`Error getting balances: ${error.message}`);
    }
  }
  
  /**
   * Execute a batch of swaps
   * @returns {Promise<number>} Number of successful swaps
   */
  async executeBatchSwaps() {
    let successfulSwaps = 0;
    
    for (let i = 0; i < this.config.maxSwapsPerBatch; i++) {
      try {
        // Generate random amount for this swap
        const randomAmount = generateRandomAmount(
          this.config.swap.minAmount, 
          this.config.swap.maxAmount
        );
        
        // Select random token
        const randomToken = selectRandomToken();
        
        logger.info(`Swap ${i + 1}/${this.config.maxSwapsPerBatch} in current batch initiated`);
        logger.info(`Random amount: ${randomAmount} TEA, Token: ${randomToken.symbol}`);
        
        // Execute the swap
        const success = await this.swapETHForToken(randomToken.address, randomAmount, i + 1);
        
        if (success) {
          successfulSwaps++;
        } else {
          logger.error(`Swap ${i + 1} in batch failed. Continuing with next swap...`);
          // Add a short delay before trying the next swap
          await new Promise(resolve => setTimeout(resolve, 30 * 1000)); // 30 second delay
        }
        
        // Add a short delay between swaps in the same batch
        if (i < this.config.maxSwapsPerBatch - 1) {
          const betweenSwapsDelay = generateRandomDelay(3, 10); // 3-10 seconds
          logger.info(`Waiting ${betweenSwapsDelay/1000} seconds before next swap in batch...`);
          await new Promise(resolve => setTimeout(resolve, betweenSwapsDelay));
        }
      } catch (error) {
        logger.error(`Error processing swap ${i + 1} in batch: ${error.message}`);
      }
    }
    
    return successfulSwaps;
  }
  
  /**
   * Start the swap loop with batches
   */
  async startSwapLoop() {
    logger.info('Starting the automated swap process...');
    
    // Run forever, in batches with delays between batches
    while (true) {
      try {
        logger.info(`Starting a new batch of swaps (max ${this.config.maxSwapsPerBatch} swaps)`);
        
        // Execute a batch of swaps
        const successfulSwaps = await this.executeBatchSwaps();
        
        logger.info(`Batch completed with ${successfulSwaps}/${this.config.maxSwapsPerBatch} successful swaps`);
        
        // Start countdown for next batch
        const nextBatchTime = new Date(Date.now() + this.countdownDuration);
        logger.info(`Next batch will occur in ${this.config.timeBetweenSwaps} hours (${nextBatchTime.toLocaleString()})`);
        
        // Wait for the configured time between batches
        await new Promise(resolve => setTimeout(resolve, this.countdownDuration));
      } catch (error) {
        logger.error(`Error in batch execution: ${error.message}`);
        // If there's an error in the batch execution, wait a bit before starting the next batch
        await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000)); // 10 minutes
      }
    }
  }
}

/**
 * Main function to start the application
 */
async function main() {
  logger.info('Initializing Auto Swap Script for Tea Sepolia');
  
  try {
    const swapManager = new SwapManager();
    await swapManager.startSwapLoop();
  } catch (error) {
    logger.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
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

// Start the application
main().catch(error => {
  logger.error(`Error in main execution: ${error.message}`);
  process.exit(1);
});
