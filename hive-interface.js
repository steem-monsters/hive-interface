const fs = require('fs');
const utils = require('./utils');
const dhive = require('@hiveio/dhive');
const HiveEngine = require('./hive-engine');
class Hive {
	clients = [];
	tx_queue = [];
	last_block = 0;
	last_vop_block = 0;
	chain_props = null;
	_options = {
		logging_level: 3,
		rpc_error_limit: 10,
		rpc_nodes: ["https://api.hive.blog", "https://anyx.io", "https://api.openhive.network", "https://hived.privex.io", "https://api.hivekings.com"],
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
		this.clients[0].disabled = true;

		setInterval(() => { this.processTxQueue(); }, 1000);
	}

	getNodeList() {
		return this.clients.filter(c => !c.disabled).concat(this.clients.filter(c => c.disabled)).map(c => c.address);
	}

	async get_rc_mana(account_name) {
		return new Promise(async (resolve, reject) => {
			try {
				resolve(await this.rpcCall(client => client.rc.getRCMana(account_name), 'get_rc_mana', [account_name]));
			} catch(err) { 
				if(!utils.isTxError(err))
					utils.log(`All nodes failed making API call [rc_api.get_rc_mana].`, 1, 'Red');

				reject(err);
			}
		});
	}

	async api_call(api, method_name, params) {
		return new Promise(async (resolve, reject) => {
			try {
				resolve(await this.rpcCall(client => client.call(api, method_name, params), method_name, params));
			} catch(err) { 
				if(!utils.isTxError(err))
					utils.log(`All nodes failed making API call [${api}.${method_name}].`, 1, 'Red');

				reject(err);
			}
		});
	}

	async api(method_name, params) {
		return new Promise(async (resolve, reject) => {
			try {
				resolve(await this.rpcCall(client => client.database.call(method_name, params), method_name, params));
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
				resolve(await this.rpcCall(client => client.broadcast.sendOperations([[method_name, params]], dhive.PrivateKey.fromString(key)), 'broadcast', [method_name]));
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
				resolve(await this.rpcCall(client => client.broadcast.send(tx), 'send_signed_tx'));
			} catch(err) {
				utils.log(`All nodes failed sending signed tx [${op_name}]! ${err}`, err.is_tx_error ? 3 : 1, err.is_tx_error ? 'Yellow' : 'Red');
				reject(err);
			}
		});
	}

	async signTx(tx, key) {
		const chain_props = await this.loadChainProps();

		const prepared_tx = Object.assign({
			ref_block_num: chain_props.ref_block_num & 0xFFFF,
			ref_block_prefix: chain_props.ref_block_prefix,
			expiration: new Date(chain_props.time.getTime() + 600 * 1000).toISOString().split('.')[0],
			extensions: [],
		}, tx);

		const signed_tx = this.clients[0].broadcast.sign(prepared_tx, dhive.PrivateKey.fromString(key));
		return signed_tx;
	}

	async loadChainProps() {
		// Check if the chain properties need to be reloaded
		if(!this.chain_props || this.chain_props.time.getTime() < Date.now() - 60 * 1000) {
			const result = await this.api('get_dynamic_global_properties');
			const header = await this.api('get_block_header', [result.last_irreversible_block_num]);

			this.chain_props = {
				ref_block_num: result.last_irreversible_block_num,
				ref_block_id: header.previous,
				ref_block_prefix: Buffer.from(header.previous, 'hex').readUInt32LE(4),
				time: new Date(result.time + 'Z'),
			};
		}

		return this.chain_props;
	}

	async rpcCall(call, method_name, params) {
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
					err.is_tx_error = utils.isTxError(err);
					if(err.is_tx_error)
						return reject(err);

					// Record that this client had an error
					this.updateClientErrors(client);
					utils.log(`Error making RPC call to node [${client.address}], Method Name: [${method_name}], Params: [${JSON.stringify(params)}], Error: ${err}`, 2, 'Yellow');
					error = err;
				}
			}

			reject(error);
		});
	}

	updateClientErrors(client) {
		// Check if the client has had errors within the last 10 minutes
		if(client.last_error_date && client.last_error_date > Date.now() - 10 * 60 * 1000)
			client.errors++;	
		else
			client.errors = 1;

		client.last_error_date = Date.now();

		if(client.errors >= this._options.rpc_error_limit) {
			utils.log('Disabling node: ' + client.address + ' due to too many errors!', 1, 'Red');
			client.disabled = true;
		}

		// If all clients have been disabled, we're in trouble, but just try re-enabling them all
		if(!this.clients.find(c => !c.disabled)) {
			utils.log('All clients disabled!!! Re-enabling them...', 1, 'Red');
			this.clients.forEach(c => c.disabled = false);
		}
	}

	async customJson(id, json, account, key, use_active) {
		return this.custom_json(id, json, account, key, use_active);
	}

	// Left for backwards compatibility
	async custom_json(id, json, account, key, use_active) {
		var data = {
			id, 
			json: JSON.stringify(json),
			required_auths: use_active ? [account] : [],
			required_posting_auths: use_active ? [] : [account]
		}

		return new Promise((resolve, reject) => {
			this.queueTx(data, key, async (data, key) => {
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
		});
	}

	// Left for backwards compatibility
	async customJsonNoQueue(id, json, account, key, use_active) {
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

					if(err && err.message && err.message.indexOf('already submitted 5 custom json operation(s) this block') >= 0) {
						// If too many custom_json operations were submitted in this block, try again in the next block
						await utils.timeout(3000);
						this.custom_json(id, json, account, key, use_active).then(resolve).catch(reject);
						return;
					}

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
    try {
      var result = await this.api('get_dynamic_global_properties');

      if(!result) {
        setTimeout(() => this.getNextBlock(), 1000);
        return;
      }

      let cur_block_num = this._options.irreversible ? result.last_irreversible_block_num : (result.head_block_number - (this._options.blocks_behind_head || 0));

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
        await this.processBlock(this.last_block + 1, cur_block_num);

      if(this._options.on_virtual_op)
        await this.getVirtualOps(result.last_irreversible_block_num);
    } catch (err) { utils.log(`Error getting next block: ${err}`, 1, 'Red'); }

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
			await this._options.on_virtual_op(ops[i], block_num);

		this.last_vop_block = block_num;

		if(this._options.save_state)
			this._options.save_state({ last_block: this.last_block, last_vop_block: this.last_vop_block });
	}

	async processBlock(block_num, cur_block_num) {
		var block = await this.api('get_block', [block_num]);

		// Log every 1000th block loaded just for easy parsing of logs, or every block depending on logging level
		utils.log(`Processing block [${block_num}], Head Block: ${cur_block_num}, Blocks to head: ${cur_block_num - block_num}`, block_num % 1000 == 0 ? 1 : 4);

		if(!block || !block.transactions) {
			// Block couldn't be loaded...this is typically because it hasn't been created yet
			utils.log('Error loading block [' + block_num + ']', 4);
			await utils.timeout(1000);
			return;
		}

		if(this._options.on_block)
			await this._options.on_block(block_num, block, cur_block_num);

		if(this._options.on_op) {
			var block_time = new Date(block.timestamp + 'Z');

			// Loop through all of the transactions and operations in the block
			for(var i = 0; i < block.transactions.length; i++) {
				var trans = block.transactions[i];

				for(var op_index = 0; op_index < trans.operations.length; op_index++) {
					var op = trans.operations[op_index];

					try {
						await this._options.on_op(op, block_num, block.block_id, block.previous, block.transaction_ids[i], block_time, op_index);
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

	async queueTx(data, key, tx_call) {
		this.tx_queue.push({ data, key, tx_call });
	}

	async processTxQueue() {
		if(this.tx_queue.length <= 0) return;

		const item = this.tx_queue.shift();
		utils.log(`Processing queue item ${item.data.id}`, 3);
		item.tx_call(item.data, item.key);
	}
}

module.exports = { Hive, HiveEngine };