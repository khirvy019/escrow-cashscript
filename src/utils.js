import BCHJS from "@psf/bch-js";
import base58 from 'bs58'
import {
  CashAddressNetworkPrefix,
  CashAddressType,
  encodeCashAddress,
  decodeCashAddress,

  decodePrivateKeyWif,
  generateTransaction,
  hexToBin,
  encodeTransaction,
} from '@bitauth/libauth'
import bitcoincash from 'bitcoincashjs-lib'

const bchjs = new BCHJS()

export function pubtoAddr(pubkey) {
  const ecPair = bchjs.ECPair.fromPublicKey(Buffer.from(pubkey, 'hex'))
  return bchjs.ECPair.toCashAddress(ecPair)
}

export function pkHashToCashAddr(pkHash='') {
  return bchjs.Address.toCashAddress(
    hash160ToLegacyAddress(Buffer.from(pkHash, 'hex'))
  )
}

export function cashAddrToPkHash(address='') {
  const legacyAddress = bchjs.Address.toLegacyAddress(address)
  return legacyAddressToHash160(legacyAddress)
}

export function p2shToLockingBytecode(address='') {
  const legacyAddress = bchjs.Address.toLegacyAddress(address)
  const decodedAddress = bitcoincash.address.fromBase58Check(legacyAddress);
  const scriptHash = decodedAddress.hash.toString('hex');
  return scriptHash;  
}

export function hash160ToLegacyAddress(hash160=Buffer.from([])) {
  const versionByte = Buffer.from([0x00]); // Version byte for legacy addresses

  // Step 2: Prepend version byte
  const data = Buffer.concat([versionByte, hash160]);

  // Step 3: Append checksum
  const checksum = bchjs.Crypto.sha256(bchjs.Crypto.sha256(data)).slice(0, 4);
  const dataWithChecksum = Buffer.concat([data, checksum]);

  // Step 5: Base58 encode the data with checksum
  const legacyAddress = base58.encode(dataWithChecksum);

  return legacyAddress;
}

export function legacyAddressToHash160(legacyAddress) {
  // Decode the Base58Check-encoded legacy address
  const decoded = base58.decode(legacyAddress);

  // Extract the hash160 value by removing the version byte and checksum
  const hash160 = decoded.slice(1, -4);

  return Buffer.from(hash160).toString('hex');
}


export function wifToPriv(wif='') {
  // Code is based on: https://en.bitcoin.it/wiki/Wallet_import_format
  const wifBytes = base58.decode(wif)
  const wifHex = Buffer.from(wifBytes).toString('hex')
  let privkey = wifHex.slice(2, -8)
  if (privkey.endsWith('01')) privkey = privkey.slice(0, -2)
  return privkey
}

/**
 * @param {String} address 
 * @returns {String}
 */
export function toTokenAddress(address) {
  let cashAddress
  try{
    cashAddress = bchjs.Address.toCashAddress(address)
  } catch {
    cashAddress = address
  }

  const isTestnet = cashAddress.split(':')[0].indexOf('test') >= 0
  const decodedAddress = decodeCashAddress(cashAddress)
  const prefix = isTestnet ? CashAddressNetworkPrefix.testnet : CashAddressNetworkPrefix.mainnet

  let _addressType
  // if (addressType == 'p2pkh') _addressType = CashAddressType.p2pkhWithTokens
  // if (addressType == 'p2sh') _addressType = CashAddressType.p2shWithTokens
  switch(decodedAddress.type) {
    case CashAddressType.p2pkh:
      _addressType = CashAddressType.p2pkhWithTokens;
      break;
    case CashAddressType.p2sh:
      _addressType = CashAddressType.p2shWithTokens;
      break;
    case CashAddressType.p2pkhWithTokens:
    case CashAddressType.p2shWithTokens:
      return cashAddress;
  }

  return encodeCashAddress(prefix, _addressType, decodedAddress.payload)
}

/**
 * @param {Object} params
 * @param {String} params.buyerPkHash
 * @param {String} params.sellerPkHash
 * @param {String} params.servicerPkHash
 * @param {String} params.arbiterPkHash
 * @param {String} params.deliveryServicePkHash
 * @param {Number} params.amount
 * @param {Number} params.serviceFee
 * @param {Number} params.arbitrationFee
 * @param {Number} params.deliveryFee
 * @param {Number} params.timestamp
 */
export function EscrowParameters(params) {
  this.buyerPkHash = params?.buyerPkHash
  this.sellerPkHash = params?.sellerPkHash
  this.servicerPkHash = params?.servicerPkHash
  this.arbiterPkHash = params?.arbiterPkHash
  this.deliveryServicePkHash = params?.deliveryServicePkHash

  this.amount = parseInt(params?.amount)
  this.serviceFee = parseInt(params?.serviceFee)
  this.arbitrationFee = parseInt(params?.arbitrationFee)
  this.deliveryFee = parseInt(params?.deliveryFee)
  this.timestamp = parseInt(params?.timestamp)

  return this
}


/**
 * @param {import('cashscript').Utxo} utxo
 */
export function parseUtxo(utxo) {
  return {
    txid: utxo?.txid,
    vout: utxo?.vout,
    satoshis: BigInt(utxo?.satoshis),
    token: !utxo?.token ? undefined : {
      category: utxo?.token?.category,
      amount: BigInt(utxo?.token?.amount),
      nft: !utxo?.token?.nft ? undefined : {
        capability: utxo?.token?.nft?.capability,
        commitment: utxo?.token?.nft?.commitment,
      }
    }
  }
}

export function reverseHex(hexString) {
  const bytes = Buffer.from(hexString, 'hex')
  bytes.reverse()
  return bytes.toString('hex')
}

export function intToHexString(num=20, bytelength=20) {
  let numHexBase = num.toString(16)
  if (numHexBase.length % 2 != 0) numHexBase = '0' + numHexBase
  let numBytes = Buffer.from(numHexBase, 'hex')
  numBytes = Buffer.concat([
    Buffer.from(new Array(bytelength - numBytes.length).fill(0)),
    numBytes,
  ])
  const numHex = reverseHex(numBytes.toString('hex'))

  return numHex
}

/**
 * @param {import('cashscript').Utxo} utxo 
 * @param {String} wif
 */
export function utxoToInput(utxo, wif='', compiler) {
  const decodedWif = decodePrivateKeyWif(wif)

  let txidBytes = hexToBin(utxo.txid)
  const data = {
    outpointIndex: utxo.vout,
    outpointTransactionHash: txidBytes,
    sequenceNumber: 0,
    unlockingBytecode: {
      compiler,
      data: {
        keys: { privateKeys: { key: decodedWif.privateKey } },
      },
      valueSatoshis: utxo.satoshis,
      script: "unlock",
      token: utxo?.token ? {
        ...utxo?.token,
        category: hexToBin(utxo?.token?.category),
        nft: {
          capability: utxo?.token?.nft?.capability,
          commitment: hexToBin(utxo?.token?.nft?.commitment),
        },
      } : undefined,
    },
  }
  return data
}

export function calculateTxFee(transaction, feePerByte=1.1) {
  const estimatedTransaction = generateTransaction(transaction)
  if (!estimatedTransaction.success) throw new Error(estimatedTransaction.errors)
  const estimatedTransactionBin = encodeTransaction(estimatedTransaction.transaction)
  const byteCount = estimatedTransactionBin.length;
  const txFee = BigInt(Math.ceil(byteCount * feePerByte)); 
  return txFee
}
