import { ElectrumNetworkProvider } from "cashscript"
import {
  authenticationTemplateP2pkhNonHd,
  importAuthenticationTemplate,
  authenticationTemplateToCompilerBCH,
  cashAddressToLockingBytecode,
  generateTransaction,
  encodeTransaction,
} from '@bitauth/libauth'
import { getIndex } from "../funcs/get-index.js"
import { NETWORK } from "../conf.js"
import { calculateTxFee, utxoToInput } from "../utils.js"

export const command = 'utxos'
export const desc = 'List UTXOS of wallet'
export const builder = {
  index: {
    alias: 'i',
    desc: 'Index of wallet',
    type: 'number',
    default: 0
  },
  address: {
    alias: 'a',
    desc: 'Address of utxos to fetch',
    type: 'string',
  },
  consolidate: {
    alias: 'c',
    desc: 'Consolidate utxos',
  },
  broadcast: {
    alias: 'b',
    desc: 'Broadcast consolidate transaction'
  }
}

export async function handler (argv) {
  const index = argv.index
  let address
  if (argv.address) {
    address = argv.address
  } else {
    console.log('Getting UTXOS for index:', index)
    const data = await getIndex(index)
    address = NETWORK === 'mainnet' ? data.receiving.address : data.receiving.testnetAddress
  }

  console.log('Address:', address)
  const provider = new ElectrumNetworkProvider(NETWORK)
  const utxos = await provider.getUtxos(address)
  console.log('Found', utxos.length, 'UTXO/s')
  printUtxos(utxos)

  if (argv.consolidate) {
    const data = await getIndex(index)
    const bchUtxos = utxos.filter(utxo => !utxo.token)
      .map(utxo => {
        utxo.wif = data.receiving.privkey
        return utxo
      })
    const utxosChange = await getUtxos({index: 0, includeWif: true, change: true})
    printUtxos(bchUtxos)
    bchUtxos.push(...utxosChange)

    // const utxos1 = await getUtxos({index: 1, includeWif: true})
    // printUtxos(utxos1)
    // bchUtxos.push(...utxos1)
    // const utxos2 = await getUtxos({index: 2, includeWif: true})
    // printUtxos(utxos2)
    // bchUtxos.push(...utxos2)
    // const utxos3 = await getUtxos({index: 3, includeWif: true})
    // printUtxos(utxos3)
    // bchUtxos.push(...utxos3)
    // const utxos4 = await getUtxos({index: 4, includeWif: true})
    // printUtxos(utxos4)
    // bchUtxos.push(...utxos4)

    console.log('Sending bch utxos to', address)
    const transaction = await sendUtxos(bchUtxos, address)
    console.log(transaction)
    const result = generateTransaction(transaction);
    const hex = Buffer.from(encodeTransaction(result.transaction)).toString('hex')
    console.log('hex:', hex)
    if (argv.broadcast) {
      console.log('Broadcasting transaction')
      const txDetails = await provider.sendRawTransaction(hex)
      console.log(txDetails)
    }
  }
}

async function getUtxos(opts={index: null, includeWif: true, change: false}) {
  const provider = new ElectrumNetworkProvider(NETWORK)
  const data = await getIndex(opts?.index)
  const addressData = opts?.change ? data.change : data.receiving
  const address = NETWORK == 'chipnet' ? addressData.testnetAddress : addressData.address

  const utxos = (await provider.getUtxos(address))
    .filter(utxo => !utxo.token)
    .map(utxo => {
      if (opts?.includeWif) utxo.wif = addressData.privkey
      return utxo
    })
  return utxos
}

/**
 * @param {import('cashscript').Utxo[]} utxos
 * @param {String} address
 */
async function sendUtxos(utxos, address) {
  const transaction = {
    version: 2,
    locktime: 0,
    inputs: [],
    outputs: [],
  }
  const template = importAuthenticationTemplate(authenticationTemplateP2pkhNonHd);
  const compiler = authenticationTemplateToCompilerBCH(template);

  let total = 0n
  for (var i = 0; i < utxos.length; i++) {
    const utxo = utxos[i]
    if (utxo.token) throw new Error('Utxo has token')
    total += utxo.satoshis
    transaction.inputs.push(utxoToInput(utxo, utxo.wif, compiler))
  }

  const output = {
    lockingBytecode: cashAddressToLockingBytecode(address).bytecode,
    valueSatoshis: total,
  }
  transaction.outputs.push(output)
  const txFee = calculateTxFee(transaction)
  output.valueSatoshis -= txFee
  console.log({ total, txFee, output: output.valueSatoshis })
  return transaction
}

/**
 * @param {import('cashscript').Utxo[]} utxos 
 */
function printUtxos(utxos=[]) {
  utxos.forEach(utxo => {
    console.log('UTXO', utxo.vout, ':', utxo.txid)
    console.log('\tValue:', utxo.satoshis, 'sats')
    if (utxo.token) {
      console.log('\tToken:', utxo.token.category)
      console.log('\t\tAmount:', utxo.token.amount)
      if (utxo.token.nft) {
        console.log('\t\tNFT:')
        console.log('\t\t\tcapability:', utxo.token.nft?.capability)
        console.log('\t\t\tcommitment:', utxo.token.nft?.commitment)
      }
    }
    console.log('\n')
  })
}