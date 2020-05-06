const hive = require('./hive-interface');

start();

async function start() { 
	let client = new hive.Hive();
	let steem_client = new hive.Hive({ rpc_nodes: ["https://api.steemit.com"] });

	// This should throw an error due to invalid key
	//client.custom_json('test', { test: 'test' }, 'test', 'abc123')
	//	.then(console.log)
	//	.catch(e => console.log(`Error: ${e}`));

	//client.stream({ on_block, state_file: 'hive_state.json' });
	//steem_client.stream({ on_block: on_steem_block, state_file: 'steem_state.json' });

	hive.hive_engine.init();
	hive.hive_engine.stream(process_hive_engine_op);
}

async function on_block(block_num, block) {
	console.log(`Hive block: ${block_num} - ${block.transactions.length}`);
}

async function on_steem_block(block_num, block) {
	console.log(`Steem block: ${block_num} - ${block.transactions.length}`);
}

async function on_virtual_op(op) {
	console.log(op);
	//console.log(`Virtual Op: ${op.op[0]} in block ${op.block}`);
}

async function process_hive_engine_op(op, ssc_block_num, ssc_block_time, block_num, block_id, prev_block_id, payload, events) {
	console.log(op);
}