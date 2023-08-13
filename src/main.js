import yargs from 'yargs'

import * as broadcast from './cmds/broadcast.js'
import * as createMintingNft from './cmds/create-minting-nft.js'
import * as escrow from './cmds/escrow.js'
import * as feePool from './cmds/fee-pool.js'
import * as getIndex from './cmds/get-index.js'
import * as parseSettlementTx from './cmds/parse-settlement-tx.js'
import * as test from './cmds/test.js'
import * as transferMintingNft from './cmds/transfer-minting-nft.js'
import * as utxos from './cmds/utxos.js'

yargs(process.argv.slice(2))
  .command(broadcast)
  .command(createMintingNft)
  .command(escrow)
  .command(feePool)
  .command(getIndex)
  .command(parseSettlementTx)
  .command(test)
  .command(transferMintingNft)
  .command(utxos)
  .demandCommand()
  .help()
  .argv
