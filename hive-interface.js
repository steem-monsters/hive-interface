const fs = require('fs');
const utils = require('./utils');
const dhive = require('@hivechain/dhive');

let _options = {
	logging_level: 3,
	rpc_error_limit: 5,
	rpc_nodes: ["https://anyx.io", "https://api.hive.blog"],
	save_state: saveState,
	load_state: loadState,
	on_block: null,
	on_op: null,
	on_behind_blocks: null
};
let clients = [];
let last_block = 0;

function init(options) {
	_options = Object.assign(_options, options);
	utils.set_options(_options);
	clients = _options.rpc_nodes.map(n => new dhive.Client(n, { timeout: 1000 }));
}

async function api(method_name, params) {
	var result = null;

	for(var i = 0; i < clients.length; i++) {
		if(clients[i].sm_disabled) {
			// Check how recently the node was disabled and re-enable if it's been over an hour
			if(clients[i].sm_last_error_date > Date.now() - 60 * 60 * 1000)
				continue;
			else
				clients[i].sm_disabled = false;
		}

		result = await tryDatabaseCall(clients[i], method_name, params);

		if(result.success)
			return result.result;
	}
	
	utils.log('All nodes failed calling [' + method_name + ']!', 1, 'Red');
	return result;
}

async function tryDatabaseCall(client, method_name, params) {
	return await client.database.call(method_name, params)
		.then(async result => { return { success: true, result: result } })
		.catch(async err => { 
			utils.log('Error calling [' + method_name + '] from node: ' + client.address + ', Error: ' + err, 1, 'Yellow');

			// Record that this client had an error
			updateClientErrors(client);

			return { success: false, error: err } 
		});
}

async function broadcast(method_name, params, key) {
	return new Promise(async (resolve, reject) => {
		for(let i = 0; i < clients.length; i++) {
			if(clients[i].sm_disabled) {
				// Check how recently the node was disabled and re-enable if it's been over an hour
				if(clients[i].sm_last_error_date > Date.now() - 60 * 60 * 1000)
					continue;
				else
					clients[i].sm_disabled = false;
			}

			try {
				let result = await tryBroadcast(clients[i], method_name, params, key);

				if(result.success)
					resolve(result.result);
				else
					reject(result.result);

				return;
			} catch(err) { }
		}
		
		utils.log(`All nodes failed broadcasting [${method_name}]!`, 1, 'Red');
		reject();
	});
}

async function tryBroadcast(client, method_name, params, key) {
	return new Promise(async (resolve, reject) => {
		client.broadcast.sendOperations([[method_name, params]], dhive.PrivateKey.fromString(key))
			.then(result => resolve({ success: true, result }))
			.catch(err => { 
				utils.log(`Error calling [${method_name}] from node: ${client.address}, Error: ${err}`, 1, 'Yellow');

				// Record that this client had an error
				updateClientErrors(client);
				reject(err);
			});
	});
}

function updateClientErrors(client) {
	// Check if the client has had errors within the last 10 minutes
	if(client.sm_last_error_date && client.sm_last_error_date > Date.now() - 10 * 60 * 1000)
		client.sm_errors++;	
	else
		client.sm_errors = 1;

	client.sm_last_error_date = Date.now();

	if(client.sm_errors >= _options.rpc_error_limit) {
		utils.log('Disabling node: ' + client.address + ' due to too many errors!', 1, 'Red');
		client.sm_disabled = true;
	}

	// If all clients have been disabled, we're in trouble, but just try re-enabling them all
	if(!clients.find(c => !c.sm_disabled)) {
		utils.log('All clients disabled!!! Re-enabling them...', 1, 'Red');
		clients.forEach(c => c.sm_disabled = false);
	}
}

let json_queue = [];
check_json_queue();

async function custom_json(id, json, account, key, use_active) {
	return new Promise(resolve => json_queue.push({ id, json, account, key, use_active, resolve }));
}

async function check_json_queue() {
	while(json_queue.length > 0) {
		let op = json_queue.shift();
		op.resolve(await send_custom_json(op.id, op.json, op.account, op.key, op.use_active));
	}

	setTimeout(check_json_queue, 3000);
}

async function send_custom_json(id, json, account, key, use_active, retries) {
	if(!retries)
		retries = 0;

	var data = {
		id: id, 
		json: JSON.stringify(json),
		required_auths: use_active ? [account] : [],
		required_posting_auths: use_active ? [] : [account]
	}

	return await broadcast('custom_json', data, key)
		.then(r => {
			utils.log(`Custom JSON [${id}] broadcast successfully.`, 3);
			return r;
		})
		.catch(async err => {
			utils.log(`Error broadcasting custom_json [${id}]. Error: ${err}`, 2, 'Yellow');

			if(retries < 3) {
				await utils.timeout(3000);
				return await send_custom_json(id, json, account, key, use_active, retries + 1);
			} else
				utils.log(`Broadcasting custom_json [${id}] failed! Error: ${err}`, 1, 'Red');
		});
}

async function transfer(from, to, amount, memo, key) {
	return await broadcast('transfer', { amount, from, memo, to }, key);
}

async function stream(options) {
	_options = Object.assign(_options, options);

	// Load saved state (last block read)
	if(_options.load_state)
		last_block = await _options.load_state();

	// Start streaming blocks
	getNextBlock();
}

async function getNextBlock() {
	var result = await api('get_dynamic_global_properties');

	if(!result) {
		setTimeout(getNextBlock, 1000);
		return;
	}

	if(!last_block || isNaN(last_block))
		last_block = result.head_block_number - 1;

	// We are 20+ blocks behind!
	if(result.head_block_number >= last_block + 20) {
		utils.log('Streaming is ' + (result.head_block_number - last_block) + ' blocks behind!', 1, 'Red');

		if(_options.on_behind_blocks)
			_options.on_behind_blocks(result.head_block_number - last_block);
	}

	// If we have a new block, process it
	while(result.head_block_number > last_block)
		await processBlock(last_block + 1);

	// Attempt to load the next block after a 1 second delay (or faster if we're behind and need to catch up)
	setTimeout(getNextBlock, 1000);
}

async function processBlock(block_num) {
	var block = await api('get_block', [block_num]);

	// Log every 1000th block loaded just for easy parsing of logs, or every block depending on logging level
	utils.log('Processing block [' + block_num + ']...', block_num % 1000 == 0 ? 1 : 4);

	if(!block || !block.transactions) {
		// Block couldn't be loaded...this is typically because it hasn't been created yet
		utils.log('Error loading block [' + block_num + ']', 4);
		await utils.timeout(1000);
		return;
	}

	if(_options.on_block)
		await _options.on_block(block_num, block);

	if(_options.on_op) {
		var block_time = new Date(block.timestamp + 'Z');

		// Loop through all of the transactions and operations in the block
		for(var i = 0; i < block.transactions.length; i++) {
			var trans = block.transactions[i];

			for(var op_index = 0; op_index < trans.operations.length; op_index++) {
				var op = trans.operations[op_index];

				try {
					await _options.on_op(op, block_num, block.block_id, block.previous, block.transaction_ids[i], block_time);
				} catch(err) { utils.log(`Error processing transaction [${block.transaction_ids[i]}]: ${err}`, 1, 'Red'); }
			}
		}
	}

	last_block = block_num;

	if(_options.save_state)
		_options.save_state(last_block);
}

async function loadState() {
	// Check if state has been saved to disk, in which case load it
	if (fs.existsSync('state.json')) {
		let state = JSON.parse(fs.readFileSync("state.json"));
    utils.log('Restored saved state: ' + JSON.stringify(state));
    return state.last_block;
	}
}

function saveState(last_block) {
  // Save the last block read to disk
  fs.writeFile('state.json', JSON.stringify({ last_block }), function (err) {
    if (err)
      utils.log(err);
  });
}

module.exports = {
	init,
	api,
	broadcast,
	custom_json,
	transfer,
	stream
}