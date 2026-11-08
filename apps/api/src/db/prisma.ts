import { PrismaClient } from '@prisma/client'

/**
 * Process-wide Prisma client. All services must use this instance so restore
 * can disconnect, swap the SQLite file, and reconnect without restarting Node.
 */
let client = new PrismaClient()

export async function reconnectPrisma(): Promise<PrismaClient> {
  try {
    await client.$disconnect()
  } catch {
    /* ignore */
  }
  client = new PrismaClient()
  await client.$connect()
  return client
}

export async function disconnectPrisma(): Promise<void> {
  try {
    await client.$disconnect()
  } catch {
    /* ignore */
  }
}

/** Live binding via Proxy so `import { prisma }` always hits the current client. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const value = Reflect.get(client, prop, client)
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(client) : value
  },
})
