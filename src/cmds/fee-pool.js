import BCHJS from "@psf/bch-js"
import { FeePool } from "../contract/fee-pool-v2/manager.js"
import { binToHex, cashAddressToLockingBytecode } from "@bitauth/libauth"
import { ElectrumNetworkProvider } from "cashscript"
import { getIndex } from "../funcs/get-index.js"
import { NETWORK } from "../conf.js"
import { reverseHex, toTokenAddress } from "../utils.js"

const bchjs = new BCHJS()

export const command = 'fee-pool'
export const desc = 'Fee pool contract'
export const builder = {
  claim: {
    desc: 'Claim a token',
  },
  mint: {
    desc: 'Mint new key NFT',
  },
  return: {
    desc: 'Return minting nft',
  },
  nftId: {
    desc: 'NFT ID in commitment',
    type: 'number',
  },
  amount: {
    alias: 'a',
    desc: 'Amount in sats embeded as data to the minted KeyNFT\'s commitment',
  },
  recipient: {
    alias: 'r',
    desc: 'Recipient of NFT. Minting nft if --return is invoked, KeyNFT if --mint is invoked',
  },
  broadcast: {
    alias: 'b',
    desc: 'Broadcast transaction',
  }
}

export async function handler (argv) {
  const feePool = new FeePool();

  const data = await getIndex();
  feePool.ownerPkHash = data.receiving.pkHash;

  const contract = feePool.getContract();
  let legacyAddress;
  try{
    legacyAddress = bchjs.Address.toLegacyAddress(contract.address);
  } catch {}
  const lockingBytecode = binToHex(cashAddressToLockingBytecode(contract.address).bytecode)

  console.log('Address:', contract.address);
  console.log('Token address:', contract.tokenAddress);
  if (legacyAddress) console.log('Legacy address:', legacyAddress);
  console.log('Locking bytecode:', lockingBytecode);
  console.log('KeyNFT category:', feePool.keyNftCategoryId);
  console.log('Owner pkhash:', feePool.ownerPkHash);

  let tx = null;
  if (argv.mint) {
    console.log('Attempting to mint')
    const amount = parseFloat(argv.amount)
    const nftId = parseInt(argv.nftId);
    if (!isNaN(nftId) && nftId > 0) console.log('Minting KeyNFT with id:', nftId)
    if (isNaN(amount) || amount<= 0) throw new Error(`Invalid amount: ${amount}`)
    tx = await mint({ feePool, amount, nftId: nftId })
    console.log('transaction:', await tx.build());
  } else if (argv.claim) {
    const nftId = parseInt(argv.nftId);
    console.log('Attempting to claim:', nftId)
    tx = await claim(feePool, nftId);
    console.log('transaction:', await tx.build());
  } else if (argv.return) {
    console.log('Attempting to return minting nft') 
    tx = await returnMintingNft(feePool)
    console.log('transaction:', await tx.build());
  }

  if (tx && argv.broadcast) {
    console.log('Broadcasting transaction')
    const txDetails = await tx.send()
    console.log('tx:', txDetails)
  }
}


async function mint(opts={ feePool: new FeePool(), amount: -1, nftId: 0 }) {
  const feePool = opts?.feePool
  const provider = new ElectrumNetworkProvider(feePool.network)

  const data = await getIndex()
  const address = feePool.network === 'mainnet' ? data.receiving.tokenAddress : data.receiving.testnetTokenAddress
  const changeAddress = feePool.network === 'mainnet' ? data.receiving.address : data.receiving.testnetAddress
  const funderUtxos = await provider.getUtxos(address)
  const fundingUtxos = funderUtxos.filter(utxo => !utxo?.token && utxo?.satoshis)
    .map(utxo => {
      utxo.wif = data.receiving.privkey
      return utxo
    })

  const tx = await feePool.mint({
    newNftId: opts?.nftId,
    nftRecipient: address,
    amount: opts?.amount,

    fundingUtxos: fundingUtxos,
    changeAddress: changeAddress,
  })
  return tx
}


async function claim(feePool = new FeePool(), nftId=0) {
  const data = await getIndex();
  const address = NETWORK === 'mainnet' ? data.receiving.address : data.receiving.testnetAddress;
  const provider = new ElectrumNetworkProvider(NETWORK);
  const utxos = await provider.getUtxos(address);
  const keyNftUtxo = utxos.find(utxo => {
    if (utxo.token?.category != feePool.keyNftCategoryId) return false
    if (utxo.token?.nft?.capability != 'none') return false
    if (!utxo.token?.nft?.commitment) return false
    const commitmentNftIdHex = reverseHex(utxo.token?.nft?.commitment.substring(0, 40));
    const commitmentNftId = parseInt(commitmentNftIdHex, 16)
    return commitmentNftId == nftId
  })

  if (!keyNftUtxo) throw new Error('Unable to find KeyNFT utxo')
  console.log('Found KeyNFT utxo:', keyNftUtxo);

  // const contract = feePool.getContract();
  // const feePoolUtxos = await contract.getUtxos()
  // const lockNftUtxo = feePoolUtxos.find(utxo => {
  //   // if (utxo.token?.category != feePool.keyNftCategoryId) return false
  //   if (utxo.token?.nft?.capability != 'none') return false
  //   if (!utxo.token?.nft?.commitment) return false
  //   const commitmentNftIdHex = reverseHex(utxo.token?.nft?.commitment.substring(0, 40));
  //   const commitmentNftId = parseInt(commitmentNftIdHex, 16)
  //   return commitmentNftId == nftId
  // })

  // if (!lockNftUtxo) throw new Error('Unable to find LockNFT utxo')
  // console.log('Found LockNFT utxo:', lockNftUtxo);

  return feePool.claim({
    // lockNftUtxo: lockNftUtxo,
    keyNftUtxo: keyNftUtxo,
    keyNftOwnerWif: data.receiving.privkey,
    recipient: address
  });
}


async function returnMintingNft(feePool= new FeePool()) {
  const provider = new ElectrumNetworkProvider(feePool.network)
  const data = await getIndex()
  const address = feePool.network === 'mainnet' ? data.receiving.address : data.receiving.testnetAddress
  const funderUtxos = await provider.getUtxos(address)
  const fundingUtxos = funderUtxos.filter(utxo => !utxo?.token && utxo?.satoshis)
    .map(utxo => {
      utxo.wif = data.receiving.privkey
      return utxo
    })

  const tokenAddress = toTokenAddress(address)
  const tx = await feePool.returnMintingNft({
    address: tokenAddress,
    fundingUtxos: fundingUtxos,
    changeAddress: address,
    ownerWif: data.receiving.privkey,
  })
  return tx
}
