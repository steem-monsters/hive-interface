# Hive Interface

Hive Interface is a JavaScript library for interacting with the Hive blockchain. It is designed for high-availability applications that use the Hive platform.

## Installation & Setup

To install via NPM use:

`npm install @splinterlands/hive-interface`

Then add the following in your NodeJS project:

```
const { Hive } = require('@splinterlands/hive-interface');
const hive = new Hive();
```

## Configuration

The Hive class constructor can optionally take a configuration object as a parameter with the following options:

- **logging_level** - The "level" of logs to output, with 1 being only errors to 4 being everything. Default is 3.
- **rpc_error_limit** - The number of errors an RPC node can have in a 10 minute period before it is disabled for an hour. Default is 10.
- **rpc_nodes** - Array of RPC node URLs that should be used. Default is: `["https://api.hive.blog", "https://anyx.io", "https://api.openhive.network", "https://hived.privex.io", "https://api.hivekings.com"]`

## Methods

### api

The `api` method will make an RPC API call to a Hive blockchain RPC node. It takes the following parameters:

- `method_name` - the name of the RPC API method to call
- `params` - parameters to send to the RPC API endpoint

Example:
```
let accounts = await hive.api('get_accounts', [['account1', 'account2', ...]]);
```

You can find more information about the available RPC API calls here: https://developers.hive.io/apidefinitions/#apidefinitions-condenser-api

### broadcast

The `broadcast` method will sign and broadcast a transaction with a single operation to the blockchain. It takes the following parameters:

- `method_name` - the name of the operation
- `params` - the operation parameters
- `key` - the appropriate private key with which to sign the transaction

Example:
```
let transaction = await hive.broadcast('transfer', {
	from: "account1",
	to: "account2",
	amount: "1.000 HIVE",
	memo: "transfer memo"
}, "[private active key for @account1]");
```

You can find more information about the available operations and parameters here: https://developers.hive.io/apidefinitions/#apidefinitions-broadcast-ops

### customJson

The `customJson` method is a helper method to easily sign and broadcast a `custom_json` operation. It takes the following parameters:

- `id` - the "id" parameter of the custom_json operation
- `json` - the JSON object data to include in the operation
- `account` - the name of the blockchain account which will sign the transaction
- `key` - the appropriate private key for the specified account
- `use_active` - custom_json operations can be signed with either the posting or active keys. The posting key will be used by default unless `use_active` is set to `true`.

Example:
```
let transaction = await hive.customJson('my_id', { test: 123 }, 'account1', 'private posting key for @account1');
```

### transfer

The `transfer` method is a helper method to easily sign and broadcast a `transfer` operation. It takes the following parameters:

- `from` - the account from which the transfer will be sent
- `to` - the account to which the transfer will be sent
- `amount` - the amount of the transfer. Note that the amount must be a string in the format: `#.### [HIVE/HBD]`.
- `memo` - a memo to include with the transfer operation
- `key` - the private acive key for the `from` account

Example:
```
let transaction = await hive.transfer('account1', 'account2', '0.001 HIVE', 'test transfer', 'private active key for @account1');
```

### sendSignedTx

The `sendSignedTx` method will broadcast and already signed transaction to the blockchain. It takes the following parameters:

- `tx` - the complete, signed transaction to send

### stream

The `stream` method will stream blocks and/or operations from the blockchain. It takes an options object which may contain the following properties:

- **save_state** - Function that should be called to save the current state of streaming. By default this will save the last block streamed to a state.json file in the root directory of the application. It takes as a parameter a JSON object like `{ "last_block": 12345 }`.
- **load_state** - Function that will be called to load the last saved state of streaming when it starts. By default this will load the state from the state.json file in the root directory of the application. Returns the JSON object loaded from the state file.
- **state_file** - File name to use to save the state of the streaming process. Default is `state.json`.
- **on_block** - Function that will be called each time a new block is streamed from the Hive blockchain. Parameters are `block_num`, and `block`.
- **on_op** - Function that will be called each time a new operation is streamed from the Hive blockchain.
- **on_behind_blocks** - Function that will be called if the streaming process ever gets 20 or more blocks behind (~1 minute).
- **on_virtual_op** - Function that will be called each time a new virtual operation is streamed from the Hive blockchain.
- **irreversible** - If this is set to `true`, then the `stream()` method will stream the last irreversible block instead of the head block.
- **blocks_behind_head** - Set to stream from a certain number of blocks behind the head block.

Example:

```
hive.stream({ 
	on_block: onBlock, 
	on_op: onOperation,
	on_virtual_op: onVirtualOperation
});

function onBlock(block_num, block) {
	console.log(`Received Hive block: ${block_num} - ${block.transactions.length}`);
}

function onOperation(op, block_num, block_id, previous, transaction_id, block_time) {
	console.log(`Received operation [${op[0]}] in transaction [${transaction_id}], in block [${block_num}], at [${block_time}]`);
}

function onVirtualOperation(trx, block_num) {
	console.log(`Received virtual operation [${trx.op[0]}] in block [${block_num}]`);
}
```

## Hive Engine
 
Hive Interface also allows streaming transactions from the Hive Engine second layer side-chain. This can be set up as follows:

```
const { HiveEngine } = require('./hive-interface');
let hive_engine = new HiveEngine();
```

The `HiveEngine()` class constructor can optionally take an object with the following properties:

- `rpc_url` - the RPC URL of a Hive Engine node to connect to
- `save_state` - Function that should be called to save the current state of streaming. By default this will save the last block streamed to a state_he.json file in the root directory of the application. It takes as a parameter a JSON object like { "last_block": 12345 }.
- `load_state` - Function that will be called to load the last saved state of streaming when it starts. By default this will load the state from the state_he.json file in the root directory of the application. Returns the JSON object loaded from the state file.
- `state_file` - File name to use to save the state of the streaming process. Default is state_he.json.

You may then call the `stream` method to start streaming which takes as a parameter the function to call whenever a Hive Engine operation is received.

Example:

```
hive_engine.stream(tx => console.log(`Hive Engine transaction: ${tx.transactionId}, Sender: ${tx.sender}, Action: ${tx.action}`));
```