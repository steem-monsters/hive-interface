const fs = require('fs');
const utils = require('./utils');
const dhive = require('@hivechain/dhive');
const hive_engine = require('./hive-engine');

class Hive {
	clients = [];
	last_block = 0;
	last_vop_block = 0;
	_options = {
		logging_level: 3,
		rpc_error_limit: 10,
		rpc_nodes: ["https://anyx.io", "https://api.hive.blog"],
		save_state: state => this.saveState(state),
		load_state: () => this.loadState(),
		state_file: 'state.json',
		on_block: null,
		on_op: null,
		on_behind_blocks: null
	};

	constructor(options) {
		this._options = Object.assign(this._options, options);
		utils.set_options(this._options);
		this.clients = this._options.rpc_nodes.map(n => new dhive.Client(n, { timeout: 1000 }));
	}

	async api(method_name, params) {
		return new Promise(async (resolve, reject) => {
			try {
				resolve(await this.rpcCall(client => client.database.call(method_name, params)));
			} catch(err) { 
				if(!utils.isTxError(err))
					utils.log(`All nodes failed making API call [${method_name}].`, 1, 'Red');

				reject(err);
			}
		});
	}

	async broadcast(method_name, params, key) {
		return new Promise(async (resolve, reject) => {
			try {
				resolve(await this.rpcCall(client => client.broadcast.sendOperations([[method_name, params]], dhive.PrivateKey.fromString(key))));
			} catch(err) {
				if(!utils.isTxError(err))
					utils.log(`All nodes failed broadcasting operation [${method_name}].`, 1, 'Red');
					
				reject(err);
			}
		});
	}

	async sendSignedTx(tx) {
		return new Promise(async (resolve, reject) => {
			let op_name = tx.operations && tx.operations.length > 0 ? tx.operations[0][0] : null;

			try {
				resolve(await this.rpcCall(client => client.broadcast.send(tx)));
			} catch(err) {
				utils.log(`All nodes failed sending signed tx [${op_name}]!`, 1, 'Red');
				reject(err);
			}
		});
	}

	async rpcCall(call) {
		return new Promise(async (resolve, reject) => {
			let error = null;

			for(let i = 0; i < this.clients.length; i++) {
				let client = this.clients[i];

				if(client.disabled) {
					// Check how recently the node was disabled and re-enable if it's been over an hour
					if(client.last_error_date > Date.now() - 60 * 60 * 1000)
						continue;
					else
						client.disabled = false;
				}

				try {
					return resolve(await call(client));
				} catch(err) { 
					if(utils.isTxError(err))
						return reject(err);

					// Record that this client had an error
					this.updateClientErrors(client);
					utils.log(`Error making RPC call to node [${client.address}], Error: ${err}`, 1, 'Yellow');
					error = err;
				}
			}

			reject(error);
		});
	}

	updateClientErrors(client) {
		// Check if the client has had errors within the last 10 minutes
		if(client.sm_last_error_date && client.sm_last_error_date > Date.now() - 10 * 60 * 1000)
			client.sm_errors++;	
		else
			client.sm_errors = 1;

		client.sm_last_error_date = Date.now();

		if(client.sm_errors >= this._options.rpc_error_limit) {
			utils.log('Disabling node: ' + client.address + ' due to too many errors!', 1, 'Red');
			client.sm_disabled = true;
		}

		// If all clients have been disabled, we're in trouble, but just try re-enabling them all
		if(!this.clients.find(c => !c.sm_disabled)) {
			utils.log('All clients disabled!!! Re-enabling them...', 1, 'Red');
			this.clients.forEach(c => c.sm_disabled = false);
		}
	}

	async custom_json(id, json, account, key, use_active) {
		var data = {
			id: id, 
			json: JSON.stringify(json),
			required_auths: use_active ? [account] : [],
			required_posting_auths: use_active ? [] : [account]
		}

		return new Promise((resolve, reject) => {
			this.broadcast('custom_json', data, key)
				.then(r => {
					utils.log(`Custom JSON [${id}] broadcast successfully - Tx: [${r.id}].`, 3);
					resolve(r);
				})
				.catch(async err => {
					utils.log(`Error broadcasting custom_json [${id}]. Error: ${err}`, 1, 'Red');
					reject(err);
				});
		});
	}

	async transfer(from, to, amount, memo, key) {
		return new Promise((resolve, reject) => {
			this.broadcast('transfer', { amount, from, memo, to }, key)
				.then(r => {
					utils.log(`Transferred ${amount} to ${to} - Tx: [${r.id}].`, 3);
					resolve(r);
				})
				.catch(async err => {
					utils.log(`Error transferring ${amount} to ${to}. Error: ${err}`, 1, 'Red');
					reject(err);
				});
		});
	}

	async stream(options) {
		this._options = Object.assign(this._options, options);

		// Load saved state (last block read)
		if(this._options.load_state) {
			let state = await this._options.load_state();

			if(state) {
				this.last_block = state.last_block;
				this.last_vop_block = state.last_vop_block;
			}
		}

		// Start streaming blocks
		this.getNextBlock();
	}

	async getNextBlock() {
		var result = await this.api('get_dynamic_global_properties');

		if(!result) {
			setTimeout(() => this.getNextBlock(), 1000);
			return;
		}

		let cur_block_num = this._options.irreversible ? result.last_irreversible_block_num : result.head_block_number;

		if(!this.last_block || isNaN(this.last_block))
			this.last_block = cur_block_num - 1;

		// We are 20+ blocks behind!
		if(cur_block_num >= this.last_block + 20) {
			utils.log('Streaming is ' + (cur_block_num - this.last_block) + ' blocks behind!', 1, 'Red');

			if(this._options.on_behind_blocks)
				this._options.on_behind_blocks(cur_block_num - this.last_block);
		}

		// If we have a new block, process it
		while(cur_block_num > this.last_block)
			await this.processBlock(this.last_block + 1);

		if(this._options.on_virtual_op)
			await this.getVirtualOps(result.last_irreversible_block_num);

		// Attempt to load the next block after a 1 second delay (or faster if we're behind and need to catch up)
		setTimeout(() => this.getNextBlock(), 1000);
	}

	async getVirtualOps(last_irreversible_block_num) {
		if(last_irreversible_block_num <= this.last_vop_block)
			return;

		let block_num = (!this.last_vop_block || isNaN(this.last_vop_block)) ? last_irreversible_block_num : this.last_vop_block + 1;
		let result = await this.api('get_ops_in_block', [block_num]);

		if(!result || !Array.isArray(result))
			return;

		let ops = result.filter(op => op.virtual_op > 0);

		utils.log(`Loading virtual ops in block ${block_num}, count: ${ops.length}`, 4);

		for(var i = 0; i < ops.length; i++)
			await this._options.on_virtual_op(ops[i]);

		this.last_vop_block = block_num;

		if(this._options.save_state)
			this._options.save_state({ last_block: this.last_block, last_vop_block: this.last_vop_block });
	}

	async processBlock(block_num) {
		var block = await this.api('get_block', [block_num]);

		// Log every 1000th block loaded just for easy parsing of logs, or every block depending on logging level
		utils.log('Processing block [' + block_num + ']...', block_num % 1000 == 0 ? 1 : 4);

		if(!block || !block.transactions) {
			// Block couldn't be loaded...this is typically because it hasn't been created yet
			utils.log('Error loading block [' + block_num + ']', 4);
			await utils.timeout(1000);
			return;
		}

		if(this._options.on_block)
			await this._options.on_block(block_num, block);

		if(this._options.on_op) {
			var block_time = new Date(block.timestamp + 'Z');

			// Loop through all of the transactions and operations in the block
			for(var i = 0; i < block.transactions.length; i++) {
				var trans = block.transactions[i];

				for(var op_index = 0; op_index < trans.operations.length; op_index++) {
					var op = trans.operations[op_index];

					try {
						await this._options.on_op(op, block_num, block.block_id, block.previous, block.transaction_ids[i], block_time);
					} catch(err) { utils.log(`Error processing transaction [${block.transaction_ids[i]}]: ${err}`, 1, 'Red'); }
				}
			}
		}

		this.last_block = block_num;

		if(this._options.save_state)
			this._options.save_state({ last_block: this.last_block, last_vop_block: this.last_vop_block });
	}

	async loadState() {
		// Check if state has been saved to disk, in which case load it
		if (fs.existsSync(this._options.state_file)) {
			let state = JSON.parse(fs.readFileSync(this._options.state_file));
			utils.log('Restored saved state: ' + JSON.stringify(state));
			return state;
		}
	}

	saveState(state) {
		// Save the last block read to disk
		fs.writeFile(this._options.state_file, JSON.stringify(state), function (err) {
			if (err)
				utils.log(err);
		});
	}
}

module.exports = { Hive, hive_engine };