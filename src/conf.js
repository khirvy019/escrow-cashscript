import dotenv from 'dotenv'
dotenv.config()

export const NETWORK = process.env.NETWORK // chipnet | mainnet
export const mnemonic = process.env.MNEMONIC
export const derivationPath =  "m/44'/145'/0'"

// default fee pool category
export const keyNftCategoryId = process.env.KEY_NFT_CATEGORY
