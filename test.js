const hive = require('./hive-interface');

start();

async function start() { 
	hive.init();

	// This should throw an error due to invalid key
	hive.custom_json('test', { test: 'test' }, 'test', 'abc123')
		.then(console.log)
		.catch(e => console.log(`Error: ${e}`));

	//hive.stream({ on_block, on_virtual_op });

	hive.hive_engine.init();
	hive.hive_engine.stream(process_hive_engine_op);
}

async function on_block(block_num, block) {
	console.log(block_num + ' - ' + block.transactions.length);
}

async function on_virtual_op(op) {
	console.log(op);
	//console.log(`Virtual Op: ${op.op[0]} in block ${op.block}`);
}

async function process_hive_engine_op(op, ssc_block_num, ssc_block_time, block_num, block_id, prev_block_id, payload, events) {
	console.log(op);
}