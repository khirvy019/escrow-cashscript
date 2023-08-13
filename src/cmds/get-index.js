import { getIndex } from '../funcs/get-index.js'

export const command = 'get-index'
export const desc = 'Show balance of wallet'
export const builder = {
  index: {
    alias: 'i',
    desc: 'Index of wallet',
    type: 'number',
    default: 0
  },
  change: {
    alias: 'c',
    desc: 'Include change',
  },
}

export async function handler (argv) {
  const index = argv.index
  const data = await getIndex(index)
  if (!argv.change) delete data.change
  console.log('Index:', index)
  console.log(data)
}
