import { ElectrumNetworkProvider } from 'cashscript'
import { getIndex } from '../funcs/get-index.js'
import { NETWORK } from '../conf.js'
import {
  toTokenAddress,
  utxoToInput,
  calculateTxFee,
} from '../utils.js'
import {
  importAuthenticationTemplate,
  authenticationTemplateP2pkhNonHd,
  authenticationTemplateToCompilerBCH,
  cashAddressToLockingBytecode,
  generateTransaction,
  encodeTransaction,
} from '@bitauth/libauth'

export const command = 'transfer-minting-nft'
export const desc = 'Transfer minting nft'
export const builder = {
  index: {
    alias: 'i',
    desc: 'Index of wallet',
    type: 'number',
    default: 0
  },
  category: {
    alias: 'c',
    desc: 'Category of minting nft',
    type: 'string',
  },
  recipient: {
    alias: 'r',
    desc: 'Recipient of minting nft',
    type: 'string',
  },

  broadcast: {
    alias: 'b',
    desc: 'Broadcast transaction',
  }
}

export async function handler (argv) {
  const index = argv.index
  const category = argv.category
  const recipient = argv.recipient
  const recipientTokenAddress = toTokenAddress(recipient)

  console.log('Wallet index:', index)
  console.log(`Transfering '${category}' to '${recipientTokenAddress}'`)
  const data = await getIndex(index)

  const provider = new ElectrumNetworkProvider(NETWORK)
  const utxos = await provider.getUtxos(data.receiving.address)
  const mintingUtxo = utxos.find(utxo => {
    if (utxo?.token?.category != category) return false
    if (utxo.token?.nft?.capability != 'minting') return false
    return true
  })

  if (!mintingUtxo) return console.log('No minting utxo found')
  console.log('Found minting UTXO:', mintingUtxo)

  const template = importAuthenticationTemplate(authenticationTemplateP2pkhNonHd);
  const compiler = authenticationTemplateToCompilerBCH(template);
  const transaction = {
    version: 2,
    locktime: 0,
    inputs: [],
    outputs: [],
  }

  const mintingUtxoInput = utxoToInput(mintingUtxo, data.receiving.privkey, compiler)
  console.log('adding input', mintingUtxoInput)
  transaction.inputs.push(mintingUtxoInput)

  console.log('Adding output to', recipient, 'with token', mintingUtxoInput.unlockingBytecode.token)
  transaction.outputs.push({
    lockingBytecode: cashAddressToLockingBytecode(recipient).bytecode,
    valueSatoshis: 1000n,
    token: mintingUtxoInput.unlockingBytecode.token,
  })

  let totalInput = 1000n
  let totalOutput = 1000n
  const fundingUtxos = utxos.filter(utxo => !utxo.token)
  for(var i = 0; i < fundingUtxos.length; i++) {
    const utxo = fundingUtxos[i]
    const txFee = calculateTxFee(transaction);
    const change = totalInput - totalOutput - txFee
    if (change < 0) {
      const input = utxoToInput(utxo, data.receiving.privkey, compiler)
      console.log('Adding input', input)
      transaction.inputs.push(input)
      totalInput += utxo.satoshis
    } else {
      break
    }
  }

  // we have minus fee per output since the change amount should also cover the fee
  // for the extra output for change
  const DUST = 546n
  const FEE_PER_OUTPUT = 40n
  const change = totalInput - totalOutput - calculateTxFee(transaction)
  if (change-FEE_PER_OUTPUT > DUST) {
    totalOutput += change-FEE_PER_OUTPUT
    console.log('Adding change of', change-FEE_PER_OUTPUT, 'sats to', data.receiving.testnetAddress)
    transaction.outputs.push({
      lockingBytecode: cashAddressToLockingBytecode(data.receiving.testnetAddress).bytecode,
      valueSatoshis: change-FEE_PER_OUTPUT,
    })
  }

  const txFee = calculateTxFee(transaction);
  const result = generateTransaction(transaction);
  const hex = Buffer.from(encodeTransaction(result.transaction)).toString('hex')

  console.log(transaction)
  console.log({
    totalInput,
    totalOutput,
    txFee,
  })
  console.log('tx:', hex)
  if (argv.broadcast) {
    console.log('Broadcasting transaction')
    const txid = await provider.sendRawTransaction(hex)
    console.log('TXID', txid)
  }
}
