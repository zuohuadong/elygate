/**
 * Cluster Mode Entry Point
 * Forks multiple workers based on available CPU cores for multi-threaded performance.
 * Each worker runs an independent Elysia server instance.
 * On Linux (Docker), Bun enables SO_REUSEPORT so all workers can share port 3000.
 *
 * @see https://elysiajs.com/patterns/deploy.html#cluster-mode
 */
import cluster from 'node:cluster'
import os from 'node:os'
import process from 'node:process'

if (cluster.isPrimary) {
  const numWorkers = Number(process.env.CLUSTER_WORKERS) || os.availableParallelism()
  console.log(`🚀 Primary ${process.pid} starting ${numWorkers} worker(s)...`)

  for (let i = 0; i < numWorkers; i++)
    cluster.fork()

  cluster.on('exit', (worker, code, signal) => {
    console.log(`⚠️ Worker ${worker.process.pid} died (${signal || code}). Restarting...`)
    cluster.fork()
  })
} else {
  await import('./server')
  console.log(`🦊 Worker ${process.pid} started`)
}
