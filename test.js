const { Hive, HiveEngine } = require('./hive-interface');

let hive_client = new Hive({ rpc_nodes: ["https://api.hive.blog"], logging_level: 3 });

hive_client.stream({ 
	on_block: onBlock, 
	//on_op: onOperation,
	//on_virtual_op: onVirtualOperation
});

let he_client = new HiveEngine();
//he_client.stream(tx => console.log(`Hive Engine transaction: ${tx.transactionId}, Sender: ${tx.sender}, Action: ${tx.action}`));

function onBlock(block_num, block, head_block) {
	console.log(`Received Hive block: ${block_num} - ${block.transactions.length}, Head Block: ${head_block}`);
}

function onOperation(op, block_num, block_id, previous, transaction_id, block_time) {
	console.log(`Received operation [${op[0]}] in transaction [${transaction_id}], in block [${block_num}], at [${block_time}]`);
}

function onVirtualOperation(trx, block_num) {
	console.log(`Received virtual operation [${trx.op[0]}] in block [${block_num}]`);
}