/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { IronfishCommand } from '../../command'
import { PromiseUtils } from 'ironfish'
import { RemoteFlags } from '../../flags'
import { RpcBlock } from 'ironfish'
import blessed from 'blessed'

const STALE_THRESHOLD = 45000

export default class ForksCommand extends IronfishCommand {
  static description = 'Try to detect forks that are being mined'

  static flags = {
    ...RemoteFlags,
  }

  async start(): Promise<void> {
    this.parse(ForksCommand)
    this.logger.pauseLogs()

    let connected = false
    const forks = new Map<string, { block: RpcBlock; time: number; mined: number }>()

    const screen = blessed.screen({ smartCSR: true })
    screen.focusNext()

    screen.key('q', () => {
      screen.destroy()
      process.exit(0)
    })

    const status = blessed.text({
      parent: screen,
      content: 'STATUS:',
    })

    const list = blessed.textbox({
      top: 1,
      alwaysScroll: true,
      scrollable: true,
      parent: screen,
    })

    const footer = blessed.text({
      bottom: 0,
      parent: screen,
      content: 'Press Q to quit',
    })

    setInterval(() => {
      const now = Date.now()

      footer.clearBaseLine(0)
      status.clearBaseLine(0)
      list.clearBaseLine(0)
      list.setContent('')

      const values = [...forks.values()].sort((a, b) => b.block.sequence - a.block.sequence)
      let count = 0

      let highest = 0
      for (const { block } of values) {
        highest = Math.max(highest, block.sequence)
      }

      for (const { block, time, mined } of values) {
        const age = now - time
        if (age >= STALE_THRESHOLD) continue

        const renderedAge = (age / 1000).toFixed(0).padStart(2, ' ')
        const renderdDiff = (highest - block.sequence).toString().padStart(6)

        list.pushLine(`${block.hash} | ${renderdDiff} | ${renderedAge}s | ${mined}`)
        count++
      }

      status.setContent(`Node: ${String(connected)}, Forks: ${count.toString().padEnd(2, ' ')}`)

      screen.render()
    }, 1000)

    function handleGossip(block: RpcBlock) {
      const prev = forks.get(block.previousBlockHash)
      const mined = prev ? prev.mined + 1 : 0

      forks.delete(block.previousBlockHash)
      forks.set(block.hash, { block: block, time: Date.now(), mined: mined })
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      connected = await this.sdk.client.tryConnect()

      if (!connected) {
        await PromiseUtils.sleep(1000)
        continue
      }

      const response = this.sdk.client.onGossipStream()

      for await (const value of response.contentStream()) {
        handleGossip(value.block)
      }
    }
  }
}
