import BCHJS from '@psf/bch-js'
import bitcore from 'bitcore-lib'
import { mnemonic, derivationPath } from '../conf.js'
import { toTokenAddress } from '../utils.js'


const bchjs = new BCHJS()

async function _getMasterHDNode () {
  const seedBuffer = await bchjs.Mnemonic.toSeed(mnemonic)
  const masterHDNode = bchjs.HDNode.fromSeed(seedBuffer)
  return masterHDNode
}

async function _getChildNode() {
  const masterHDNode = await _getMasterHDNode()
  return masterHDNode.derivePath(derivationPath)
}

export async function getIndex(index=0) {
  const network = bitcore.Networks.testnet;

  const childNode = await _getChildNode()
  const receivingAddressNode = childNode.derivePath('0/' + index)
  const changeAddressNode = childNode.derivePath('1/' + index)

  const receivingAddress = bchjs.HDNode.toCashAddress(receivingAddressNode)
  const changeAddress = bchjs.HDNode.toCashAddress(changeAddressNode)

  const receivingPubkey = bchjs.HDNode.toPublicKey(receivingAddressNode).toString('hex')
  const changePubkey = bchjs.HDNode.toPublicKey(changeAddressNode).toString('hex')

  const receivingPrivkey = bchjs.HDNode.toWIF(receivingAddressNode).toString('hex')
  const changePrivkey = bchjs.HDNode.toWIF(changeAddressNode).toString('hex')

  const receivingTestnetAddress = new bitcore.Address(
    new bitcore.PublicKey(receivingPubkey),
    network,
  ).toString();
  const changeTestnetAddress = new bitcore.Address(
    new bitcore.PublicKey(changePubkey),
    network,
  ).toString();

  return {
    receiving: {
      testnetAddress: bchjs.Address.toCashAddress(receivingTestnetAddress),
      address: receivingAddress,
      legacyAddress: bchjs.Address.toLegacyAddress(receivingAddress),
      tokenAddress: toTokenAddress(receivingAddress),
      testnetTokenAddress: toTokenAddress(receivingTestnetAddress),
      pkHash: bchjs.Crypto.hash160(Buffer.from(receivingPubkey, 'hex')).toString('hex'),
      pubkey: receivingPubkey,
      privkey: receivingPrivkey,
    },
    change: {
      testnetAddress: bchjs.Address.toCashAddress(changeTestnetAddress),
      address: changeAddress,
      legacyAddress: bchjs.Address.toLegacyAddress(changeAddress),
      tokenAddress: toTokenAddress(changeAddress),
      testnetTokenAddress: toTokenAddress(changeTestnetAddress),
      pkHash: bchjs.Crypto.hash160(Buffer.from(changePubkey, 'hex')).toString('hex'),
      pubkey: changePubkey,
      privkey: changePrivkey,
    }
  }
}
