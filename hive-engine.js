const fs = require('fs');
const utils = require('./utils');
const SSC = require('sscjs');
let ssc = null;

module.exports = class HiveEngine {
	ssc = null;
	_options = {
		rpc_url: "https://api.hive-engine.com/rpc",
		chain_id: "ssc-mainnet-hive",
		save_state: last_block => this.saveState(last_block),
		load_state: () => this.loadState(),
		state_file: 'state_he.json',
		on_op: null
	};

	constructor(options) {
		this._options = Object.assign(this._options, options);
		this.ssc = new SSC(this._options.rpc_url);
	}

	async stream(on_op) {
		this._options.on_op = on_op;
		let last_block = 0;

		// Load saved state (last block read)
		if(this._options.load_state)
			last_block = await this._options.load_state();

		// Start streaming blocks
		if(last_block > 0)
			this.ssc.streamFromTo(last_block + 1, null, (err, block) => this.processBlock(err, block));
		else
			this.ssc.stream((err, block) => this.processBlock(err, block));
	}

	async processBlock(err, block) {
		if(err)
			utils.log('Error processing block: ' + err);

		if(!block)
			return;
		
		utils.log('Processing block [' + block.blockNumber + ']...', block.blockNumber % 1000 == 0 ? 1 : 4);

		try {
			for(var i = 0; i < block.transactions.length; i++)
				await this.processTransaction(block.transactions[i], block.blockNumber, new Date(block.timestamp + 'Z'), block.refSteemBlockNumber, block.refSteemBlockId, block.prevRefSteemBlockId);
		} catch(err) { utils.log('Error processing block: ' + block.blockNumber + ', Error: ' + err.message); }

		if(this._options.save_state)
			this._options.save_state(block.blockNumber);
	}

	async processTransaction(tx, ssc_block_num, ssc_block_time, block_num, block_id, prev_block_id) {
		let logs = utils.tryParse(tx.logs);

		// The transaction was unsuccessful
		if(!logs || logs.errors || !logs.events || logs.events.length == 0)
			return;

		if(this._options.on_op) {
			try {
				await	this._options.on_op(tx, ssc_block_num, ssc_block_time, block_num, block_id, prev_block_id, utils.tryParse(tx.payload), logs.events);
			} catch(err) { utils.log(`Error processing Hive Engine transaction [${tx.transactionId}]: ${err}`, 1, 'Red'); }
		}
	}

	async loadState() {
		// Check if state has been saved to disk, in which case load it
		if (fs.existsSync(this._options.state_file)) {
			let state = JSON.parse(fs.readFileSync(this._options.state_file));
			utils.log('Restored saved state: ' + JSON.stringify(state));
			return state.last_block;
		}
	}

	saveState(last_block) {
		// Save the last block read to disk
		fs.writeFile(this._options.state_file, JSON.stringify({ last_block }), function (err) {
			if (err)
				utils.log(err);
		});
	}
}