const fs = require('fs');
const utils = require('./utils');
const SSC = require('sscjs');
let ssc = null;

let _options = {
	rpc_url: "https://api.hive-engine.com/rpc",
	chain_id: "ssc-mainnet-hive",
	save_state: saveState,
	load_state: loadState,
	on_op: null
};

function init(options) {
	_options = Object.assign(_options, options);
	ssc = new SSC(_options.rpc_url);
}

async function stream(on_op) {
	_options.on_op = on_op;
	let last_block = 0;

	// Load saved state (last block read)
	if(_options.load_state)
		last_block = await _options.load_state();

	// Start streaming blocks
	if(last_block > 0)
		ssc.streamFromTo(last_block + 1, null, processBlock);
	else
		ssc.stream(processBlock);
}

async function processBlock(err, block) {
	if(err)
		utils.log('Error processing block: ' + err);

	if(!block)
		return;
	
	utils.log('Processing block [' + block.blockNumber + ']...', block.blockNumber % 1000 == 0 ? 1 : 4);

	try {
		for(var i = 0; i < block.transactions.length; i++)
			await processTransaction(block.transactions[i], block.blockNumber, new Date(block.timestamp + 'Z'), block.refSteemBlockNumber, block.refSteemBlockId, block.prevRefSteemBlockId);
	} catch(err) { utils.log('Error processing block: ' + block.blockNumber + ', Error: ' + err.message); }

	if(_options.save_state)
		_options.save_state(block.blockNumber);
}

async function processTransaction(tx, ssc_block_num, ssc_block_time, block_num, block_id, prev_block_id) {
	let logs = utils.tryParse(tx.logs);

	// The transaction was unsuccessful
	if(!logs || logs.errors || !logs.events || logs.events.length == 0)
		return;

	if(_options.on_op) {
		try {
			await	_options.on_op(tx, ssc_block_num, ssc_block_time, block_num, block_id, prev_block_id, utils.tryParse(tx.payload), logs.events);
		} catch(err) { utils.log(`Error processing Steem Engine transaction [${tx.id}]: ${err}`, 1, 'Red'); }
	}
}

async function loadState() {
	// Check if state has been saved to disk, in which case load it
	if (fs.existsSync('state_se.json')) {
		let state = JSON.parse(fs.readFileSync("state_se.json"));
    utils.log('Restored saved state: ' + JSON.stringify(state));
    return state.last_block;
	}
}

function saveState(last_block) {
  // Save the last block read to disk
  fs.writeFile('state_se.json', JSON.stringify({ last_block }), function (err) {
    if (err)
      utils.log(err);
  });
}

module.exports = {
	init,
	stream
}