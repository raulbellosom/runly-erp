import { test } from 'node:test'
import assert from 'node:assert/strict'
import { replaceModernColors } from '../exportColorCompatibility.js'

test('leaves legacy colors and geometry intact', () => {
  const css = '0 4px 24px rgba(0, 0, 0, 0.15), inset 1px 1px #fff'
  assert.equal(replaceModernColors(css, () => assert.fail('unexpected conversion')), css)
})

test('resolves nested color-mix as one color in gradients and preserves stops', () => {
  const color = 'color-mix(in oklab, oklch(70% 0.2 40 / .5) 25%, rgb(0 0 0))'
  const seen = []
  const converted = replaceModernColors(`linear-gradient(90deg, ${color} 20%, oklch(90% 0.1 20) 80%)`, value => {
    seen.push(value)
    return 'rgba(12, 34, 56, 0.5)'
  })
  assert.deepEqual(seen, [color, 'oklch(90% 0.1 20)'])
  assert.equal(converted, 'linear-gradient(90deg, rgba(12, 34, 56, 0.5) 20%, rgba(12, 34, 56, 0.5) 80%)')
})

test('resolves each modern color in multiple shadows without changing offsets', () => {
  assert.equal(
    replaceModernColors('0 0 5px oklab(0.5 0.1 0.1), inset 2px 4px color(display-p3 1 0 0)', () => '#123456'),
    '0 0 5px #123456, inset 2px 4px #123456',
  )
})
