import BCHJS from '@psf/bch-js';
import { Contract, ElectrumNetworkProvider, SignatureTemplate, Transaction } from 'cashscript';
import { compileFile } from 'cashc';
import { intToHexString, pkHashToCashAddr, toTokenAddress } from '../../utils.js';
import bitcoincash from 'bitcoincashjs-lib'
import { NETWORK } from '../../conf.js';
import { binToHex, cashAddressToLockingBytecode } from '@bitauth/libauth';

const bchjs = new BCHJS()
const TX_FEE = 1000
const P2PKH_DUST = 546
const CT_DUST = 1000


export class Escrow {
  /**
   * @param {Object} params
   * @param {String} params.buyerPkHash
   * @param {String} params.sellerPkHash
   * @param {String} params.servicerPkHash
   * @param {String} params.arbiterPkHash
   * @param {String} params.feePoolAddress
   * @param {Number} params.amount
   * @param {Number} params.serviceFee
   * @param {Number} params.arbitrationFee
   * @param {Number} params.deliveryFee
   * @param {Number} params.lockNftId
   * @param {Number} params.timestamp
   * @param {Object} opts
   * @param {'v1' | 'v2'} opts.version
   */
  constructor(params, opts) {
    this.params = {
      buyerPkHash: params?.buyerPkHash,
      sellerPkHash: params?.sellerPkHash,
      servicerPkHash: params?.servicerPkHash,
      arbiterPkHash: params?.arbiterPkHash,
      feePoolAddress: params?.feePoolAddress,
      amount: parseInt(params?.amount),
      serviceFee: parseInt(params?.serviceFee),
      arbitrationFee: parseInt(params?.arbitrationFee),
      deliveryFee: parseInt(params?.deliveryFee),
      lockNftId: parseInt(params?.lockNftId),
      timestamp: parseInt(params?.timestamp),
    }
    this.version = opts?.version
  }

  get fundingAmounts() {
    const data = {
      amount: Math.max(this.params.amount, P2PKH_DUST),
      serviceFee: Math.max(this.params.serviceFee, P2PKH_DUST),
      arbitrationFee: Math.max(this.params.arbitrationFee, P2PKH_DUST),
      deliveryFee: Math.max(this.params.deliveryFee, 0),
      txFee: TX_FEE,
    }

    if (data.deliveryFee > 0 && data.deliveryFee < CT_DUST) data.deliveryFee = 0
    return data
  }

  get contractCreationParams () {
    const response = {
      buyerPkHash: this.params.buyerPkHash,
      sellerPkHash: this.params.sellerPkHash,
      servicerPkHash: this.params.servicerPkHash,
      arbiterPkHash: this.params.arbiterPkHash,
      feePoolBytecode: '',

      amount: this.fundingAmounts.amount,
      serviceFee: this.fundingAmounts.serviceFee,
      arbitrationFee: this.fundingAmounts.arbitrationFee,
      deliveryFee: this.fundingAmounts.deliveryFee,
      lockNftId: 0,

      timestamp: this.params.timestamp,
    }

    if (response.deliveryFee && this.params.feePoolAddress) {
      response.feePoolBytecode = binToHex(cashAddressToLockingBytecode(this.params.feePoolAddress).bytecode)
      response.lockNftId = this.params.lockNftId
    }
    return response
  }

  get fundingSats() {
    return this.fundingAmounts.amount + 
           this.fundingAmounts.serviceFee +
           this.fundingAmounts.arbitrationFee +
           this.fundingAmounts.deliveryFee +
           this.fundingAmounts.txFee
  }

  getFundingOutputs(txHex='') {
    const contract = this.getContract()
    const lockingBytecode = Buffer.from(cashAddressToLockingBytecode(contract.address).bytecode).toString('hex')
    const tx = bitcoincash.Transaction.fromHex(txHex)

    return tx.outs.map((out, index) => {
      const script = Buffer.from(out.script).toString('hex');
      return { index: index, script, value: out.value }
    }).filter(output => output?.script == lockingBytecode)
  }

  validateFundingTx(txHex='') {
    const outputs = this.getFundingOutputs(txHex)
    if (outputs.length !== 1) {
      return { valid: false, error: `Found ${outputs.length} outputs for contract` }
    }

    if (outputs[0].value != this.fundingSats) {
      return { valid: false, error: `Expected ${this.fundingSats} satoshis but got ${outputs[0].value}`}
    }

    return { valid: true, utxo: outputs[0] }
  }

  validateRefundTx(txHex='') {
    const expectedOutputs = [
      {address: pkHashToCashAddr(this.params.buyerPkHash), value: parseInt(this.fundingAmounts.amount + this.fundingAmounts.deliveryFee) },
      {address: pkHashToCashAddr(this.params.servicerPkHash), value: parseInt(this.fundingAmounts.serviceFee) },
      {address: pkHashToCashAddr(this.params.arbiterPkHash), value: parseInt(this.fundingAmounts.arbitrationFee) },
    ]

    const tx = bitcoincash.Transaction.fromHex(txHex)
    const parsedOutputs = tx.outs.map((out, index) => {
      const script = bitcoincash.script.decompile(out.script);
      const address = bchjs.Address.toCashAddress(bitcoincash.address.fromOutputScript(script))
      return { index: index, address: address, value: out.value }
    })

    let error = ''
    if (parsedOutputs.length != expectedOutputs.length) error = `Transaction does not have exactly ${expectedOutputs.length} outputs`
    expectedOutputs.forEach((output, index) => {
      if (parsedOutputs[index]?.address != output.address) error = `Output ${index} must be ${output.address}`
      if (parsedOutputs[index]?.value != output.value) error = `Output ${index} must have ${output.value} sats`
    })
    if (error) return { valid: false, error: error }

    return { valid: true }
  }

  getContract() {
    // const provider = new ElectrumNetworkProvider('testnet4');
    const provider = new ElectrumNetworkProvider(NETWORK);
    const addressType = 'p2sh20';
    const opts = { provider, addressType }
    // opts.addressType = 'p2sh32'

    let contractFilename = ''
    if (this.version == 'v1') contractFilename = 'escrow.cash'
    else if (this.version == 'v2') contractFilename = 'escrow-v2.cash'

    const artifact = compileFile(new URL(contractFilename, import.meta.url));
    const contract = new Contract(artifact,[
      this.contractCreationParams.buyerPkHash,
      this.contractCreationParams.sellerPkHash,
      this.contractCreationParams.servicerPkHash,
      this.contractCreationParams.arbiterPkHash,
      this.contractCreationParams.feePoolBytecode,

      BigInt(this.contractCreationParams.amount),
      BigInt(this.contractCreationParams.serviceFee),
      BigInt(this.contractCreationParams.arbitrationFee),
      BigInt(this.contractCreationParams.deliveryFee),

      BigInt(this.contractCreationParams.lockNftId),
      BigInt(this.contractCreationParams.timestamp),
    ], opts);

    if (contract.opcount > 201) throw new Error(`Opcount must be at most 201. Got ${contract.opcount}`)
    if (contract.bytesize > 520) throw new Error(`Bytesize must be at most 520. Got ${contract.bytesize}`)
    return contract
  }

  get tokenAddress() {
    const contract = this.getContract()
    return toTokenAddress(contract.address)
  }

  async release(utxo, wif='') {
    const parsedUtxo = {
      txid: utxo?.txid,
      vout: utxo?.vout,
      satoshis: BigInt(utxo?.satoshis),
    }

    const keyPair = bchjs.ECPair.fromWIF(wif)
    const sig = new SignatureTemplate(keyPair)

    const pubkeyBytes = bchjs.ECPair.toPublicKey(keyPair)
    const pubkey = pubkeyBytes.toString('hex')
    const pkHash = bchjs.Crypto.hash160(pubkeyBytes).toString('hex')

    if (pkHash != this.params.arbiterPkHash && pkHash != this.params.buyerPkHash) {
      throw new Error('Private key must be from arbiter or buyer')
    }

    const outputs = [
      {to: pkHashToCashAddr(this.params.sellerPkHash), amount: BigInt(this.fundingAmounts.amount) },
      {to: pkHashToCashAddr(this.params.servicerPkHash), amount: BigInt(this.fundingAmounts.serviceFee) },
      {to: pkHashToCashAddr(this.params.arbiterPkHash), amount: BigInt(this.fundingAmounts.arbitrationFee) },
    ]

    if (this.fundingAmounts.deliveryFee) {
      const nftCommitment = intToHexString(this.params.lockNftId, 20) + intToHexString(this.fundingAmounts.deliveryFee, 20)
      const deliveryFeePoolTokenAddr = toTokenAddress(this.params.feePoolAddress)
      console.log('feepool:', this.params.feePoolAddress, deliveryFeePoolTokenAddr)
      outputs.push({
        to: deliveryFeePoolTokenAddr,
        amount: BigInt(this.fundingAmounts.deliveryFee),
        token: {
          category: parsedUtxo.txid,
          amount: 0n,
          nft: {
            capability: 'none',
            commitment: nftCommitment,
          }
        },
      })
    }

    const contract = this.getContract()
    // const tx = contract.functions.feePoolCheckOnly()
    const tx = contract.functions.release(pubkey, sig, BigInt(this.params.timestamp))
      .from(parsedUtxo)
      .withHardcodedFee(TX_FEE)
      .to(outputs)

    return tx
  }

  refund(utxo={txid: '', vout: 0, satoshis: 0}, wif='') {
    const parsedUtxo = {
      txid: utxo?.txid,
      vout: utxo?.vout,
      satoshis: BigInt(utxo?.satoshis),
    }

    const keyPair = bchjs.ECPair.fromWIF(wif)
    const sig = new SignatureTemplate(keyPair)

    const pubkeyBytes = bchjs.ECPair.toPublicKey(keyPair)
    const pubkey = pubkeyBytes.toString('hex')
    const pkHash = bchjs.Crypto.hash160(pubkeyBytes).toString('hex')
    if (pkHash != this.params.arbiterPkHash) throw new Error('Pubkey hash mismatch')

    const outputs = [
      {to: pkHashToCashAddr(this.params.buyerPkHash), amount: BigInt(this.fundingAmounts.amount + this.fundingAmounts.deliveryFee) },
      {to: pkHashToCashAddr(this.params.servicerPkHash), amount: BigInt(this.fundingAmounts.serviceFee) },
      {to: pkHashToCashAddr(this.params.arbiterPkHash), amount: BigInt(this.fundingAmounts.arbitrationFee) },
    ]
    const contract = this.getContract()
    const refundTx = contract.functions.refund(pubkey, sig, BigInt(this.params.timestamp))
      .from(parsedUtxo)
      .to(outputs)
      .withHardcodedFee(TX_FEE)
    return refundTx
  }

  async returnFunds(recipient='') {
    const contract = this.getContract()
    const utxos = await contract.getUtxos()

    const total = utxos.reduce((subtotal, utxo) => subtotal + utxo.satoshis, 0n)
    console.log('Total funds:', total, 'sats')

    const _transaction = contract.functions.doNothing()
      .from(utxos)
      .to(recipient, 546n)

    const hex = await _transaction.build()
    const fee = BigInt(Math.ceil(1.1 * hex.length / 2))
    console.log('Calculated fee:', fee, 'sats')
    console.log('Returning', total-fee, 'sats')

    const transaction = contract.functions.doNothing()
      .from(utxos)
      .to(recipient, total-fee)

    return transaction
  }
}


/**
 * @param {Object} opts
 * @param {String} opts.txid
 * @param {String} opts.txHex
 * @param {'mainnet' | 'chipnet'} opts.network
 */
export async function parseSettlementTransaction(opts={ txid:'', txHex: '', network: '' }) {
  let txHex = opts?.txHex
  if (!txHex) {
    const provider = new ElectrumNetworkProvider(opts?.network)
    txHex = await provider.getRawTransaction(opts?.txid)
  }
  const tx = bitcoincash.Transaction.fromHex(txHex)
  tx.ins.forEach(inp => {
    inp.hash.reverse()
    inp.hash = inp.hash.toString('hex')
    inp.script = inp.script.toString('hex')
  })

  tx.outs.forEach((out, index) => {
    const script = Buffer.from(out.script).toString('hex');
    const decompiled = bitcoincash.script.decompile(out.script)
    out.script = script
    out.decompiled = decompiled.map(b => typeof b === 'number' ? b : b.toString('hex'))
    out.index = index
    out.address 
    return { index: index, script, value: out.value }
  })

  return tx
}
