import BigInteger from 'bigi';
import BCHJS from '@psf/bch-js';
import { Contract, ElectrumNetworkProvider, SignatureTemplate } from 'cashscript';
import { compileFile } from 'cashc';
import { pkHashToCashAddr, wifToPriv, EscrowParameters } from '../../utils.js';
import bitcoincash from 'bitcoincashjs-lib'
import { NETWORK } from '../../conf.js';

const bchjs = new BCHJS()
const TX_FEE = 1000
const DUST = 546

export class Escrow {
  /**
   * @param {EscrowParameters} params
   */
  constructor(params) {
    this.params = new EscrowParameters(params)
  }

  get fundingAmounts() {
    const data = {
      amount: Math.max(this.params.amount, DUST),
      serviceFee: Math.max(this.params.serviceFee, DUST),
      arbitrationFee: Math.max(this.params.arbitrationFee, DUST),
      deliveryFee: Math.max(this.params.deliveryFee, 0),
      txFee: TX_FEE,
    }

    if (data.deliveryFee > 0 && data.deliveryFee < DUST) data.deliveryFee = 0
    return data
  }

  get contractCreationParams () {
    return {
      buyerPkHash: this.params.buyerPkHash,
      sellerPkHash: this.params.sellerPkHash,
      servicerPkHash: this.params.servicerPkHash,
      arbiterPkHash: this.params.arbiterPkHash,

      amount: this.fundingAmounts.amount,
      serviceFee: this.fundingAmounts.serviceFee,
      arbitrationFee: this.fundingAmounts.arbitrationFee,
      deliveryFee: this.fundingAmounts.deliveryFee,

      timestamp: this.params.timestamp,
    }
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
    const tx = bitcoincash.Transaction.fromHex(txHex)

    return tx.outs.map((out, index) => {
      const script = bitcoincash.script.decompile(out.script);
      const address = bchjs.Address.toCashAddress(bitcoincash.address.fromOutputScript(script))
      return { index: index, address: address, value: out.value }
    }).filter(output => output?.address == contract.address)
  }

  validateFundingTx(txHex='') {
    const outputs = this.getFundingOutputs(txHex)
    if (outputs.length !== 1) {
      return { valid: false, error: `Found ${outputs.length} outputs for contract` }
    }

    if (outputs[0].value != this.fundingSats) {
      return { valid: false, error: `Expected ${this.fundingSats} satoshis but got ${outputs[0].value}`}
    }

    return { valid: true }
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
    // const addressType = 'p2sh32';
    const addressType = 'p2sh20';
    const opts = { provider, addressType }

    const artifact = compileFile(new URL('escrow.cash', import.meta.url));
    const contract = new Contract(artifact,[
      this.contractCreationParams.buyerPkHash,
      this.contractCreationParams.sellerPkHash,
      this.contractCreationParams.servicerPkHash,
      this.contractCreationParams.arbiterPkHash,

      BigInt(this.contractCreationParams.amount),
      BigInt(this.contractCreationParams.serviceFee),
      BigInt(this.contractCreationParams.arbitrationFee),
      BigInt(this.contractCreationParams.deliveryFee),

      BigInt(this.contractCreationParams.timestamp),
    ], opts);


    if (contract.opcount > 201) throw new Error(`Opcount must be at most 201. Got ${contract.opcount}`)
    if (contract.bytesize > 520) throw new Error(`Bytesize must be at most 520. Got ${contract.bytesize}`)

    return contract
  }

  refund(utxo={txid: '', vout: 0, satoshis: 0}, arbiterWif='') {
    const parsedUtxo = {
      txid: utxo?.txid,
      vout: utxo?.vout,
      satoshis: BigInt(utxo?.satoshis),
    }

    const keyPair = bchjs.ECPair.fromWIF(arbiterWif)
    const sig = new SignatureTemplate(keyPair)
    console.log(sig)

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

  release(utxo={txid: '', vout: 0, satoshis: 0}, wif='') {
    const parsedUtxo = {
      txid: utxo?.txid,
      vout: utxo?.vout,
      satoshis: BigInt(utxo?.satoshis),
    }

    const outputs = [
      {to: pkHashToCashAddr(this.params.sellerPkHash), amount: BigInt(this.fundingAmounts.amount) },
      {to: pkHashToCashAddr(this.params.servicerPkHash), amount: BigInt(this.fundingAmounts.serviceFee) },
      {to: pkHashToCashAddr(this.params.arbiterPkHash), amount: BigInt(this.fundingAmounts.arbitrationFee) },
    ]

    const keyPair = bchjs.ECPair.fromWIF(wif)
    const sig = new SignatureTemplate(keyPair)

    const pubkeyBytes = bchjs.ECPair.toPublicKey(keyPair)
    const pubkey = pubkeyBytes.toString('hex')
    const pkHash = bchjs.Crypto.hash160(pubkeyBytes).toString('hex')

    if (pkHash != this.params.arbiterPkHash && pkHash != this.params.buyerPkHash) {
      throw new Error('Private key must be from arbiter or buyer')
    }

    let datasig = Buffer.from(new Array(64).fill(0x00)).toString('hex')
    let deliveryServicePkHash = Buffer.from(new Array(20).fill(0x00)).toString('hex')

    if (this.fundingAmounts.deliveryFee) {
      outputs.push({to: pkHashToCashAddr(this.params.deliveryServicePkHash), amount: BigInt(this.fundingAmounts.deliveryFee) })
      deliveryServicePkHash = this.params.deliveryServicePkHash
      const pkH256 = bchjs.Crypto.sha256(Buffer.from(deliveryServicePkHash, 'hex'))
      const privkey = wifToPriv(wif)
      const privkeyInt = BigInteger.fromHex(privkey)
      datasig = bchjs.Schnorr.sign(privkeyInt, pkH256)
    }

    const contract = this.getContract()
    const releaseTx = contract.functions.release(
      pubkey, sig,
      BigInt(this.params.timestamp),
      deliveryServicePkHash,
      datasig,
    )
      .from(parsedUtxo)
      .to(outputs)
      .withHardcodedFee(TX_FEE)
      .withTime(0);
    return releaseTx
  }
}
