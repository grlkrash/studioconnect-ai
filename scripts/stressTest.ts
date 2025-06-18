import autocannon from 'autocannon'

async function run() {
  const target = process.env.STRESS_TEST_URL || 'http://localhost:3000/api/health'
  console.log('[StressTest] Starting load test on', target)

  const instance = autocannon({
    url: target,
    connections: 50,
    duration: 30,
    pipelining: 1,
  })

  autocannon.track(instance)

  instance.on('done', (res) => {
    console.log('[StressTest] Completed', res)
  })
}

run().catch((e) => {
  console.error('[StressTest] Error', e)
  process.exit(1)
}) 