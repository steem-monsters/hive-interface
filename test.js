const hive = require('./hive-interface');

start();

async function start() { 
	hive.init();
	hive.stream({ on_block });
}

async function on_block(block_num, block) {
	console.log(block_num + ' - ' + block.transactions.length);
}