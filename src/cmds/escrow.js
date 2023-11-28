import { ElectrumNetworkProvider } from "cashscript"
import { Escrow } from "../contract/escrow/manager.js"
import { FeePool } from "../contract/fee-pool-v2/manager.js"
import { getIndex } from "../funcs/get-index.js"
import { calculateTxFee, utxoToInput } from "../utils.js"
import { NETWORK } from "../conf.js"
import {
  importAuthenticationTemplate,
  authenticationTemplateP2pkhNonHd,
  authenticationTemplateToCompilerBCH,

  cashAddressToLockingBytecode,

  encodeTransaction,
  generateTransaction,
} from "@bitauth/libauth"
import BCHJS from "@psf/bch-js"

const bchjs = new BCHJS()


export const command = 'escrow'
export const desc = 'Escrow contract'
export const builder = {
  fund: {
    desc: 'Fund contract',
  },
  release: {
    desc: 'Release funds in contract',
  },
  refund: {
    desc: 'Refund funds in contract',
  },
  return: {
    desc: 'Returns all funds',
  },
  broadcast: {
    alias: 'b',
    desc: 'Broadcast transaction created',
  },
  contractVersion: {
    desc: 'Version of escrow contract',
    type: 'number',
    default: 2,
  }
}

export async function handler (argv) {
  const feePool = new FeePool()
  const feePoolAddr = feePool.getContract().address
  const data = await getIndex(0);
  const data1 = await getIndex(0);
  const data2 = await getIndex(0);
  const data3 = await getIndex(0);

  const params = {
    buyerPkHash: data.receiving.pkHash,
    sellerPkHash: data1.receiving.pkHash,
    servicerPkHash: data2.receiving.pkHash,
    arbiterPkHash: data3.receiving.pkHash,
    feePoolAddress: feePoolAddr,

    amount: 374763,
    serviceFee: 56214,
    arbitrationFee: 3000,
    deliveryFee: 529690,
    lockNftId: 1700110986385,

    timestamp: 1700110986385 // "2023-07-31T02:16:42.326536Z"
  }
  const opts = {
    version: `v${argv.contractVersion}`,
  }

  const escrow = new Escrow(params, opts);


  const contract = escrow.getContract();
  console.log('Version:', escrow.version);
  console.log('Contract size:', { opcount: contract.opcount, bytesize: contract.bytesize })
  console.log('Address:', contract.address);
  try {
    console.log('Legacy address:', bchjs.Address.toLegacyAddress(contract.address));
  } catch {}
  console.log('Token address:', contract.tokenAddress);
  console.log('Contract creation params:', escrow.contractCreationParams);
  console.log('Funding amounts:', escrow.fundingSats);

  let tx, txHex
  if (argv.fund) {
    console.log('Attempting to create funding transaction')
    txHex = await createFundingTransaction(escrow)
    console.log('hex:', txHex)
  } else if (argv.release) {
    console.log('Attempting to release funds in contract')
    const contract = escrow.getContract()
    const utxos = await contract.getUtxos()
    const fundingUtxo = utxos.find(utxo => utxo.satoshis == BigInt(escrow.fundingSats))
    if (!fundingUtxo) return console.log('Unable to find funding utxo')
    console.log('Found funding utxo:', fundingUtxo)

    tx = await escrow.release(fundingUtxo, data3.receiving.privkey)
    console.log('transaction:', tx)
    console.log('hex:', await tx.build())
  } else if (argv.refund) {
    console.log('Attempting to refund funds in contract')
    const contract = escrow.getContract()
    const utxos = await contract.getUtxos()
    const fundingUtxo = utxos.find(utxo => utxo.satoshis == BigInt(escrow.fundingSats))
    if (!fundingUtxo) return console.log('Unable to find funding utxo')
    console.log('Found funding utxo:', fundingUtxo)

    tx = await escrow.refund(fundingUtxo, data3.receiving.privkey)
    console.log('transaction:', tx)
    console.log('hex:', await tx.build())
  } else if (argv.return) {
    console.log('Attempting to return funds in contract')
    tx = await escrow.returnFunds(NETWORK === 'mainnet' ? data.receiving.address : data.receiving.testnetAddress, data3.receiving.privkey)
    console.log('transaction:', tx)
    console.log('hex:', await tx.build())
  }

  if (argv.broadcast && txHex) {
    console.log('Broadcasting transaction')
    const provider = new ElectrumNetworkProvider(NETWORK)
    const txDetails = await provider.sendRawTransaction(txHex)
    console.log('tx:', txDetails)
  } else if (argv.broadcast && tx) {
    console.log('Broadcasting transaction')
    const txDetails = await tx.send()
    console.log('tx:', txDetails)
  }
}

async function createFundingTransaction(escrow = new Escrow()) {
  const fundingSats = BigInt(escrow.fundingSats)
  const contract = escrow.getContract()
  const escrowAddress = contract.address
  const data = await getIndex()
  const address = NETWORK === 'mainnet' ? data.receiving.address : data.receiving.testnetAddress
  const provider = new ElectrumNetworkProvider(NETWORK)

  const template = importAuthenticationTemplate(authenticationTemplateP2pkhNonHd);
  const compiler = authenticationTemplateToCompilerBCH(template);
  const transaction = {
    version: 2,
    locktime: 0,
    inputs: [].map(utxoToInput),
    outputs: [],
  }

  const _utxos = await provider.getUtxos(address)
  const utxos = _utxos.filter(utxo => !utxo.token)

  let totalInput = 0n
  let totalOutput = 0n
  console.log('Adding output of', fundingSats, 'sats to', escrowAddress)
  transaction.outputs.push({
    lockingBytecode: cashAddressToLockingBytecode(escrowAddress).bytecode,
    valueSatoshis: fundingSats,
  })
  totalOutput += fundingSats

  for(var i = 0; i < utxos.length; i++) {
    const utxo = utxos[i]
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
  console.log({
    totalInput,
    totalOutput,
    txFee,
    actualFee: totalInput - totalOutput,
  })
  return hex
}
