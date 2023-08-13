import BCHJS from '@psf/bch-js';
import { compileFile } from 'cashc';
import { Contract, ElectrumNetworkProvider, SignatureTemplate } from 'cashscript';
import { intToHexString, reverseHex, parseUtxo } from '../../utils.js';
import { NETWORK, keyNftCategoryId } from '../../conf.js';

const bchjs = new BCHJS();

export class FeePool {
  constructor(opts={
    params: { keyNftCategoryId: keyNftCategoryId, ownerPkHash: '2b0bc6373394c5450abbb780c7455f66489bd177' },
    options: { network: NETWORK },
  }) {
    this.keyNftCategoryId = opts?.params?.keyNftCategoryId
    this.ownerPkHash = opts?.params?.ownerPkHash

    this.network = opts?.options?.network || 'mainnet'
  }

  get contractCreationParams() {
    return [
        this.ownerPkHash,
        reverseHex(this.keyNftCategoryId),
    ]
  }

  getContract() {
    const provider = new ElectrumNetworkProvider(this.network);
    const addressType = 'p2sh20';
    const opts = { provider, addressType }
    // opts.addressType = 'p2sh32'

    const artifact = compileFile(new URL('fee-pool.cash', import.meta.url));
    const contract = new Contract(artifact,this.contractCreationParams, opts);

    if (contract.opcount > 201) throw new Error(`Opcount must be at most 201. Got ${contract.opcount}`)
    if (contract.bytesize > 520) throw new Error(`Bytesize must be at most 520. Got ${contract.bytesize}`)

    return contract
  }

  async getMintingUtxo() {
    const provider = new ElectrumNetworkProvider(this.network)
    const contract = this.getContract()
    const utxos = await provider.getUtxos(contract.address)
    return utxos.find(utxo => 
      utxo.token?.category == this.keyNftCategoryId && utxo.token?.nft?.capability === "minting"
    )
  }

  /**
   * @param {Object} opts
   * @param {import('cashscript').Utxo} [opts.utxo]
   * @param {String} opts.nftRecipient
   * @param {Number} opts.amount
   * @param {import('cashscript').Utxo[]} opts.fundingUtxos
   * @param {String} opts.changeAddress
   * @returns {import('cashscript').Transaction}
   */
  async mint(opts={utxo, nftRecipient: '', amount: 0, fundingUtxos: [], changeAddress: ''}) {
    if (!opts?.utxo) {
      opts.utxo = await this.getMintingUtxo()
      if (!opts.utxo) throw new Error('No minting utxo found')
    }

    const inputCommitment = reverseHex(String(opts?.utxo?.token?.nft?.commitment)) || 0
    const lastId = parseInt(inputCommitment, 16)
    const nextId = lastId + 1
    const nextMinterCommitment = intToHexString(nextId, 40)

    const nftCommitment = intToHexString(nextId, 20) + intToHexString(opts?.amount, 20)
    console.log('nextMinterCommitment', nextMinterCommitment)
    console.log('nftCommitment', nftCommitment)

    if (opts?.utxo?.token?.category != this.keyNftCategoryId) {
      throw new Error(`Minter category does not match. Expected ${this.keyNftCategoryId}, got ${opts?.utxo?.token?.category}`)
    }
    const contract = this.getContract()
    const transaction = contract.functions.mintKeyNft()
      .from(opts?.utxo)
      .to(contract.tokenAddress, 1000n, {
          category: this.keyNftCategoryId,
          amount: 0n,
          nft: { capability: "minting", commitment: nextMinterCommitment },
      })
      .to(opts?.nftRecipient, 1000n, {
        category: this.keyNftCategoryId,
        amount: 0n,
        nft: { capability: "none", commitment: nftCommitment },
      })

    let fundingUtxos = opts?.fundingUtxos || await contract.getUtxos()
    fundingUtxos = fundingUtxos.filter(utxo => !utxo?.token)
    const changeAddress = opts?.changeAddress || contract.address

    // const fundedTransaction = transaction
    const fundedTransaction = fundTransaction(transaction, fundingUtxos, changeAddress)
    return fundedTransaction
  }


  /**
   * @param {Object} opts
   * @param {import('cashscript').Utxo} opts.lockNftUtxo 
   * @param {import('cashscript').Utxo} opts.keyNftUtxo 
   * @param {String} opts.keyNftOwnerWif
   * @param {String} opts.recipient
   */
  
  async claim(opts={keyNftUtxo, lockNftUtxo, keyNftOwnerWif: '', recipient: ''}) {
    const contract = this.getContract()

    const keyNftKeyPair = bchjs.ECPair.fromWIF(opts?.keyNftOwnerWif)
    const keyNftSig = new SignatureTemplate(keyNftKeyPair)
    const parsedKeyNftUtxo = parseUtxo(opts?.keyNftUtxo)

    let _lockNftUtxo = opts?.lockNftUtxo
    if(!_lockNftUtxo) {
      const keyNftCommitment = reverseHex(String(parsedKeyNftUtxo.token.nft.commitment)).substring(40) || 0
      const nftId = parseInt(keyNftCommitment, 16)

      const feePoolUtxos = await contract.getUtxos()
      _lockNftUtxo = feePoolUtxos.find(utxo => {
        if (utxo.token?.category != feePool.keyNftCategoryId) return false
        if (utxo.token?.nft?.capability != 'none') return false
        if (!utxo.token?.nft?.commitment) return false
        const commitmentNftIdHex = reverseHex(utxo.token?.nft?.commitment.substring(0, 40));
        const commitmentNftId = parseInt(commitmentNftIdHex, 16)
        return commitmentNftId == nftId
      })
    }
    if (!_lockNftUtxo) throw new Error('Unable to find lock nft utxo')    
    const parsedLockNftUtxo = parseUtxo(_lockNftUtxo)

    return contract.functions.claim()
      .from(parsedLockNftUtxo)
      .fromP2PKH(parsedKeyNftUtxo, keyNftSig)
      .to(opts?.recipient, parsedLockNftUtxo.satoshis)
      .withoutTokenChange()
      .withoutChange()
  }

  /**
   * @param {Object} opts
   * @param {String} opts.address
   * @param {import('cashscript').Utxo[]} opts.fundingUtxos
   * @param {String} opts.changeAddress
   * @param {String} opts.ownerWif
   */
  async returnMintingNft(opts = { address, fundingUtxos, changeAddress, ownerWif }) {
    const contract = this.getContract()
    // const mintingUtxo = await this.getMintingUtxo()
    // if (!mintingUtxo) throw new Error('Minting utxo not found')

    const bchUtxos = (await contract.getUtxos()).filter(utxo => !utxo.token)

    const keyPair = bchjs.ECPair.fromWIF(opts?.ownerWif)
    const sig = new SignatureTemplate(keyPair)

    const pubkeyBytes = bchjs.ECPair.toPublicKey(keyPair)
    const pubkey = pubkeyBytes.toString('hex')
    const pkHash = bchjs.Crypto.hash160(pubkeyBytes).toString('hex')
    if (pkHash != this.ownerPkHash) throw new Error('Private key does not belong to ownwer')

    const sats = bchUtxos.reduce((subtotal, utxo) => subtotal + utxo.satoshis, 0n) - 360n
    let transaction = contract.functions.owner(pubkey, sig)
      .from(mintingUtxo)
      .from(bchUtxos)
      .to(opts?.changeAddress, sats)
      .to(opts?.address, mintingUtxo.satoshis, {
        category: mintingUtxo.token?.category,
        amount: mintingUtxo.token?.amount,
        nft: {
          capability: mintingUtxo.token?.nft?.capability,
          commitment: mintingUtxo.token?.nft?.commitment
        },
      })

    try {
      transaction = await fundTransaction(transaction, [], bchjs.Address.toLegacyAddress(opts?.address))
    } catch {}

    let fundingUtxos = opts?.fundingUtxos || await contract.getUtxos()
    fundingUtxos = fundingUtxos.filter(utxo => !utxo?.token)
    const changeAddress = opts?.changeAddress || contract.address

    // const fundedTransaction = transaction
    const fundedTransaction = fundTransaction(transaction, fundingUtxos, changeAddress)
    return fundedTransaction
  }
}


/**
 * @param {import('cashscript').Transaction} transaction
 * @param {import('cashscript').Utxo[]} fundingUtxos
 * @param {String} changeAddress
 */
async function fundTransaction(transaction, fundingUtxos, changeAddress) {
  let temp = transaction.address
  transaction.address = changeAddress
  for (var i = 0; i < fundingUtxos?.length; i++) {
    const utxo = fundingUtxos?.[i]
    try {
      await transaction.setInputsAndOutputs()
      break
    } catch(error) {
      if (!error?.message?.startsWith?.('Insufficient funds')) throw error
      if (utxo.wif) {
        const keyPair = bchjs.ECPair.fromWIF(utxo.wif)
        const sig = new SignatureTemplate(keyPair)
        transaction.fromP2PKH(utxo, sig)
      } else {
        transaction.from(utxo)
      }
    }
  }

  await transaction.setInputsAndOutputs()
  transaction.address = temp
  return transaction
}
