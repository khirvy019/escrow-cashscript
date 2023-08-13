import { NETWORK } from '../conf.js'
import { parseSettlementTransaction } from '../contract/escrow-v2/manager.js'

export const command = 'parse-settlement-tx'
export const desc = 'Reads a settlement transaction'
export const builder = {
  txid: {
    alias: 't',
    desc: 'Transaction ID',
    type: 'string',
    default: ''
  },
  hex: {
    alias: 'h',
    desc: 'Transaction hex',
    type: 'string',
    default: ''
  },
}

export async function handler (argv) {
  const tx = await parseSettlementTransaction({
    txid: argv?.txid,
    txHex: argv.hex,
    network: NETWORK,
  })
  console.log(tx.ins)
  console.log(tx.outs)
}
