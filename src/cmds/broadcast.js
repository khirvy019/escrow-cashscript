import { ElectrumNetworkProvider } from "cashscript"
import { NETWORK } from "../conf.js"

export const command = 'broadcast'
export const desc = 'Broadcast a raw transaction'
export const builder = {
  txHex: {
    alias: 'h',
    desc: 'Transaction hex',
    type: 'number',
    default: 0
  },
}

export async function handler (argv) {
  const provider = new ElectrumNetworkProvider(NETWORK)
  const txDetails = await provider.sendRawTransaction(argv.txHex)
  console.log('Tx:', txDetails)
}
