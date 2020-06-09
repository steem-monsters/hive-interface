const interface = require('./hive-interface');

stream();
//streamHiveEngine();

/* Stream blocks from Hive and Steem simultaneously */
async function stream() { 
	let hive_client = new interface.Hive();
	//let steem_client = new interface.Hive({ rpc_nodes: ["https://api.steemit.com"] });

	hive_client.stream({ 
		on_block: (block_num, block) => console.log(`Hive block: ${block_num} - ${block.transactions.length}`), 
		state_file: 'hive_state.json'
	});

  /*
	steem_client.stream({
		on_block: (block_num, block) => console.log(`Steem block: ${block_num} - ${block.transactions.length}`),
		state_file: 'steem_state.json'
	});*/
}

async function streamHiveEngine() {
	let he_client = new interface.HiveEngine();
	he_client.stream(tx => console.log(`Hive Engine transaction: ${tx.transactionId}, Sender: ${tx.sender}, Action: ${tx.action}`));
}