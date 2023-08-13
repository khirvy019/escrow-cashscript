import { ElectrumNetworkProvider } from 'cashscript'
import { getIndex } from '../funcs/get-index.js'
import { NETWORK } from '../conf.js'
import { calculateTxFee, utxoToInput } from '../utils.js'
import { authenticationTemplateP2pkhNonHd, authenticationTemplateToCompilerBCH, cashAddressToLockingBytecode, encodeTransaction, generateTransaction, hexToBin, importAuthenticationTemplate } from '@bitauth/libauth'

export const command = 'create-minting-nft'
export const desc = 'Create a minting nft'
export const builder = {
  index: {
    alias: 'i',
    desc: 'Index of wallet',
    type: 'number',
    default: 0
  },
  number: {
    alias: 'n',
    desc: 'Number of minting NFTs to create',
    default: 1
  },
  recipient: {
    alias: 'r',
    desc: 'Recipient of minting NFTs',
    type: 'string',
    default: ''
  },
  broadcast: {
    alias: 'b',
    desc: 'Broadcast transaction',
  }
}

export async function handler (argv) {
  const index = argv.index
  const number = parseInt(argv.number)
  const data = await getIndex(index)
  const recipient = argv.recipient || (NETWORK === 'mainnet' ? data.receiving.tokenAddress : data.receiving.testnetTokenAddress)
  const address = NETWORK === 'mainnet' ? data.receiving.address : data.receiving.testnetAddress
  console.log('Index', index, ':', address)
  console.log('Creating', number, 'minting NFT/s')
  console.log('Sending them to:', recipient)

  const provider = new ElectrumNetworkProvider(NETWORK)
  const _utxos = await provider.getUtxos(address)
  const utxos = _utxos.filter(utxo => !utxo.token)
  console.log('utxos:', utxos)

  let totalOutput = BigInt(number) * 1000n;
  let totalInput = 0n;

  const template = importAuthenticationTemplate(authenticationTemplateP2pkhNonHd);
  const compiler = authenticationTemplateToCompilerBCH(template);
  const transaction = {
    version: 2,
    locktime: 0,
    inputs: [].map(utxoToInput),
    outputs: [],
  }

  const utxosUsed = []
  for (var i = 0; i < utxos.length; i++) {
    const utxo = utxos[i]
    if (totalInput < totalOutput) {
      const input = utxoToInput(utxo, data.receiving.privkey, compiler)
      transaction.inputs.push(input)
      totalInput += utxo.satoshis
      utxosUsed.push(utxo)
    } else {
      break
    }
  }

  for (var i = 0; i < number; i++) {
    // console.log(transaction.inputs?.[i]?.outpointTransactionHash)
    const output = {
      lockingBytecode: cashAddressToLockingBytecode(recipient).bytecode,
      valueSatoshis: 1000n,
      token: {
        category: transaction.inputs?.[i]?.outpointTransactionHash.copyWithin() || hexToBin(generateRandomHexString(64)),
        amount: 0n,
        nft: {
          capability: 'minting',
          commitment: hexToBin(''),
        }
      },
    }
    // console.log(output)
    transaction.outputs.push(output)
  }

  const fundingUtxos = utxos.filter(utxo => utxosUsed.indexOf(utxo) < 0)
  for(var i = 0; i < fundingUtxos.length; i++) {
    const utxo = fundingUtxos[i]
    const txFee = calculateTxFee(transaction);
    const change = totalInput - totalOutput - txFee
    if (change < 0) {
      const input = utxoToInput(utxo, data.receiving.privkey, compiler)
      console.log('Adding input', utxo.txid, ':', utxo.vout, 'with', utxo.satoshis, 'sats')
      transaction.inputs.push(input)
      totalInput += utxo.satoshis
    } else {
      break
    }
  }

  const DUST = 546n
  const FEE_PER_OUTPUT = 40n
  const change = totalInput - totalOutput - calculateTxFee(transaction)
  if (change-FEE_PER_OUTPUT > DUST) {
    totalOutput += change-FEE_PER_OUTPUT
    console.log('Adding change of', change-FEE_PER_OUTPUT, 'sats to', address)
    transaction.outputs.push({
      lockingBytecode: cashAddressToLockingBytecode(address).bytecode,
      valueSatoshis: change-FEE_PER_OUTPUT,
    })
  }

  const txFee = calculateTxFee(transaction);
  const result = generateTransaction(transaction);
  const hex = Buffer.from(encodeTransaction(result.transaction)).toString('hex')

  console.log(transaction)
  console.log(transaction.outputs.map(out => out?.token))
  console.log({
    totalInput,
    totalOutput,
    txFee,
    actualFee: totalInput - totalOutput,
  })
  console.log('tx:', hex)
  if (argv.broadcast) {
    console.log('Broadcasting transaction')
    const txDetails = await provider.sendRawTransaction(hex)
    console.log('TX:', txDetails)
  }
}

function generateRandomHexString(length) {
  const characters = '0123456789abcdef';
  let result = '';

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters[randomIndex];
  }

  return result;
}
