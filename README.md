# T3a Sepolia Auto Swap

An automated token swap script for the T3a Sepolia network that performs batches of swaps between T3a and random tokens at configured intervals. The script features configurable swap amounts, supports multiple wallets, and includes comprehensive error handling and logging.

## Features

- 🔄 Automated swapping of T3a for random tokens in batches
- ⏱️ Configurable countdown between batches (default 25 hours)
- 🎲 Random amount generation with 5 decimal precision
- 👛 Multi-wallet support (rotate through multiple private keys)
- 🎯 Random token selection from available tokens on T3a Sepolia
- 📝 Detailed logging with Winston
- ⏲️ Random delays between 2-5 seconds before transactions
- ⛽ Automatic gas estimation
- 💰 Balance checking before swaps

## How It Works

1. The script runs multiple swaps (configurable) as a batch
2. Each swap in the batch:
   - Uses a random amount within your configured range
   - Selects a random token from the available tokens
   - Uses the next wallet in the rotation sequence
   - Adds random delays between transactions
3. After completing a batch, waits 25 hours (configurable)
4. Runs another batch of swaps
5. Continues this cycle indefinitely until manually stopped

## Prerequisites

- Node.js (v14 or newer)
- npm (v6 or newer)

## Installation

1. Clone the repository or download the script:

```bash
git clone https://github.com/Usernameusernamenotavailbleisnot/t3a-sepolia.git
cd t3a-sepolia
```

2. Install dependencies:

```bash
npm install ethers@5.7.2 js-yaml winston
```

3. Configure your settings in `config.yaml`:

```bash
cp config.yaml.example config.yaml
```

4. Create a `pk.txt` file with your private keys (one key per line):

```bash
echo "YOUR_PRIVATE_KEY_1" > pk.txt
echo "YOUR_PRIVATE_KEY_2" >> pk.txt
```

⚠️ **IMPORTANT**: Make sure to secure this file and never share it. Add `pk.txt` to your `.gitignore` if using version control.

## Configuration

The script uses a YAML configuration file for swap settings. The network settings are hardcoded in the script.

### Transaction Settings

```yaml
transaction:
  slippage: 0.5  # 0.5% slippage tolerance
  gasPriceMultiplier: 1.1  # Add 10% to current gas price
  timeoutMinutes: 20
  maxRetries: 3
  retryDelay: 5000  # 5 seconds between retries
```

### Swap Settings

```yaml
swap:
  minAmount: 0.1  # Minimum amount of T3a to swap
  maxAmount: 0.2  # Maximum amount of T3a to swap

timeBetweenSwaps: 25  # Hours between batches
maxSwapsPerBatch: 2   # Number of swaps to perform in each batch
```

### Private Keys Format

Create a file named `pk.txt` with one private key per line:

```
0x123abc...  # Wallet 1
0x456def...  # Wallet 2
# This is a comment and will be ignored
0x789ghi...  # Wallet 3
```

## Available Tokens

The script automatically selects from these tokens on T3a Sepolia network:

| Token Name | Symbol | Address |
|------------|--------|---------|
| NotAScam | NSCM | 0xdf1aAdF0FdFb14Ae4Cbe9bF550E1716Ed901b41C |
| Fresh T3a | FT3a | 0xD89455C62BeC95820cE048fbE0f2Ae900F18A2DC |
| Daun T3a | DAUN | 0xb1885A41876ff1BcB107a80A352A800b3D394f6F |
| T3a Leaf | LEAF | 0x0281e0e9Df9920E994051fC3798fd1565F6d28BF |
| Herbal T3a | HBRL | 0x7d7D20Ea5afb64Fc7beC15ba4670FF08B5E838b6 |
| AAA Token | AAA | 0xdbCb51116b426F67a727dA75EE7119fb88D1069A |
| T3a Anget | T3aA | 0xE8976C1873dD34B1262f8096E63a95AdE4d88997 |
| Matcha | MATCHA | 0xd2325fB82bb3122D9656D87F4aCF01e4D535d7Ea |
| Project Nomad | P0N | 0x5E5613bAEE77215c6781635e48E7fcc4B3d02790 |
| Candy | CANDY | 0x8e7Ae8eb29FbF68fdEea6ef0daBEb2C9F7fAB366 |
| Mommycoin | MOM | 0xbBb017586E75C465Cc52cBE4c6b2B71d4baED5c6 |
| sT3a Token | sT3a | 0x09bA156Aaf3505d07b6F82872b35D75b7A7d5032 |
| AssamBTC | BTC | 0x615a02020b4cd1171551e3379491B825315ce77B |
| MeowT3a Token | MTN | 0x2b3aBf76D9D2eD4Eb2975D5DBb6981B77DF06E5A |
| T3aDogs Inu | TGS | 0xE1b512683cb5c3d56D462dB326a6632EeEbb60BB |
| DionT3a Token V1 | DTT1 | 0xF3b6ebeA3B46694a76e760B8970EFfC76Ee8b96A |

## Usage

Run the script to start the automated swap process:

```bash
node index.js
```

The script will:
1. Load configuration from `config.yaml`
2. Read private keys from `pk.txt`
3. Execute a batch of swaps (default: 2 swaps)
   - Each swap uses random amounts and random tokens
   - Random delays between transactions
4. Wait 25 hours after the batch is complete
5. Execute another batch of swaps
6. Continue this cycle indefinitely

## Logs

Logs are saved to the `./logs` directory with filenames based on the current date (`swap_YYYY-MM-DD.log`). The log format is:

```
[YYYY-MM-DD HH:mm:ss] Log message
```

## Security Notes

- **IMPORTANT**: Keep your private keys secure. Never share them or commit them to version control.
- Consider using separate wallets with limited funds for automated trading.
- The script only performs swaps from T3a to tokens, not the reverse.

## Advanced Usage

### Customizing the Token List

You can modify the `TOKEN_LIST` in the script to add or remove tokens as needed.

### Gas Price Strategy

You can adjust the gas price strategy by modifying the `gasPriceMultiplier` value in the config. The default is 1.1 (10% above the current network gas price).

### Error Handling

The script includes retry logic for failed transactions, which can be configured in the YAML file:
- `maxRetries`: Maximum number of retry attempts
- `retryDelay`: Delay between retry attempts in milliseconds

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Disclaimer

This software is provided for educational and testing purposes only. Use at your own risk. Always review the code before running automated crypto transactions.
