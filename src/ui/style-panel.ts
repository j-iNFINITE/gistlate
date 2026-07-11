import { loadSettings, saveSettings, DEFAULTS, type SubtitleStyle } from '../settings'
import { createOverlay } from './overlay'

/**
 * Docked, live (WYSIWYG) subtitle style panel.
 *
 * A compact top-right card (does NOT cover the subtitle area) whose controls
 * restyle the real on-video overlay instantly via `overlay.applyStyle`. Unsaved
 * tweaks are reverted on Close; Save persists to GM storage.
 *
 * DOM is built with createElement/textContent only — YouTube enforces Trusted
 * Types, so `innerHTML` is never used here.
 */

const SP_ID = 'gistlate-style-panel'
const PANEL_CSS = `
  #${SP_ID} {
    position: fixed; top: 70px; right: 16px; z-index: 999998;
    width: 280px; max-height: 82vh; overflow-y: auto; box-sizing: border-box;
    background: #1a1a2e; color: #e0e0e0; border-radius: 10px;
    padding: 14px 16px; box-shadow: 0 8px 32px rgba(0,0,0,.5);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
  }
  #${SP_ID} h2 { margin: 0 0 10px; font-size: 15px; color: #fff; }
  #${SP_ID} .gl-field { margin: 8px 0; }
  #${SP_ID} label {
    display: block; margin-bottom: 3px; font-size: 11px; color: #9aa5b1; overflow: hidden;
  }
  #${SP_ID} .gl-val { float: right; color: #6cb6ff; }
  #${SP_ID} input[type="range"] { width: 100%; box-sizing: border-box; margin: 0; }
  #${SP_ID} input[type="color"] {
    width: 100%; height: 28px; padding: 0; box-sizing: border-box;
    border: 1px solid #333; border-radius: 5px; background: #16213e; cursor: pointer;
  }
  #${SP_ID} select {
    width: 100%; padding: 6px 8px; box-sizing: border-box; font-size: 13px;
    border: 1px solid #333; border-radius: 5px; background: #16213e; color: #e0e0e0; outline: none;
  }
  #${SP_ID} .gl-two { display: flex; gap: 8px; }
  #${SP_ID} .gl-two > * { flex: 1; min-width: 0; }
  #${SP_ID} .gl-actions { display: flex; gap: 6px; margin-top: 12px; }
  #${SP_ID} button {
    flex: 1; padding: 7px 0; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;
  }
  #${SP_ID} .gl-btn-primary { background: #4a9eff; color: #fff; }
  #${SP_ID} .gl-btn-primary:hover { background: #3a8eef; }
  #${SP_ID} .gl-btn-secondary { background: #333; color: #ccc; }
  #${SP_ID} .gl-btn-secondary:hover { background: #444; }
  #${SP_ID} .gl-status { min-height: 1.1em; margin-top: 6px; font-size: 11px; color: #4caf50; text-align: center; }
`

// ── DOM builder helpers (no innerHTML — YouTube enforces Trusted Types) ──

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: Node[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  Object.assign(el, props)
  for (const c of children) el.appendChild(c)
  return el
}

interface RangeControl {
  field: HTMLDivElement
  setValue(v: number): void
}

/** Labeled `<input type=range>` with a live numeric readout. */
function rangeField(
  labelText: string,
  min: number,
  max: number,
  step: number,
  value: number,
  format: (v: number) => string,
  onInput: (v: number) => void,
): RangeControl {
  const valEl = h('span', { className: 'gl-val', textContent: format(value) })
  const label = h('label', {}, [document.createTextNode(labelText), valEl])
  const input = h('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
  })
  input.addEventListener('input', () => {
    const v = Number(input.value)
    valEl.textContent = format(v)
    onInput(v)
  })
  const field = h('div', { className: 'gl-field' }, [label, input])
  return {
    field,
    setValue(v: number) {
      input.value = String(v)
      valEl.textContent = format(v)
    },
  }
}

interface SelectControl {
  field: HTMLDivElement
  setValue(v: string): void
}

/** Labeled `<select>`. */
function selectField(
  labelText: string,
  options: { value: string; label: string }[],
  value: string,
  onChange: (v: string) => void,
): SelectControl {
  const select = h(
    'select',
    {},
    options.map((o) => h('option', { value: o.value, textContent: o.label, selected: o.value === value })),
  )
  select.addEventListener('input', () => onChange(select.value))
  const field = h('div', { className: 'gl-field' }, [h('label', { textContent: labelText }), select])
  return {
    field,
    setValue(v: string) {
      select.value = v
    },
  }
}

interface ColorControl {
  field: HTMLDivElement
  input: HTMLInputElement
}

/** Labeled `<input type=color>`. */
function colorField(labelText: string, value: string, onInput: (v: string) => void): ColorControl {
  const input = h('input', { type: 'color', value })
  input.addEventListener('input', () => onInput(input.value))
  const field = h('div', { className: 'gl-field' }, [h('label', { textContent: labelText }), input])
  return { field, input }
}

export function openStylePanel(): void {
  if (document.getElementById(SP_ID)) return

  // Grab (or lazily mount) the live overlay so previews target the real subtitles.
  // Null when there is no player yet — controls then update state but no-op the preview.
  const overlay = createOverlay()

  const settings = loadSettings()
  // `saved` is the persisted baseline; `working` is the in-memory edit buffer.
  const saved: SubtitleStyle = { ...settings.style }
  const working: SubtitleStyle = { ...settings.style }

  const apply = () => overlay?.applyStyle(working)

  // Inject styles (idempotent)
  if (!document.getElementById(`${SP_ID}-style`)) {
    document.head.appendChild(h('style', { id: `${SP_ID}-style`, textContent: PANEL_CSS }))
  }

  // ── Controls (each live-previews as it changes) ───────
  const font = selectField(
    '字体',
    [
      { value: 'yt-noto', label: 'YouTube Noto' },
      { value: 'system-sans', label: '系统无衬线' },
      { value: 'serif', label: '衬线 Serif' },
      { value: 'mono', label: '等宽 Mono' },
    ],
    working.fontFamily,
    (v) => {
      working.fontFamily = v
      apply()
    },
  )

  const weight = selectField(
    '字重',
    [
      { value: '400', label: '常规' },
      { value: '700', label: '加粗' },
    ],
    String(working.fontWeight),
    (v) => {
      working.fontWeight = Number(v) === 700 ? 700 : 400
      apply()
    },
  )

  const oSize = rangeField('原文字号', 12, 48, 1, working.originalSize, (v) => `${v}px`, (v) => {
    working.originalSize = v
    apply()
  })
  const tSize = rangeField('译文字号', 12, 48, 1, working.translatedSize, (v) => `${v}px`, (v) => {
    working.translatedSize = v
    apply()
  })
  const outline = rangeField('描边/阴影', 0, 4, 1, working.outline, (v) => String(v), (v) => {
    working.outline = v
    apply()
  })
  const bgOpacity = rangeField('背景不透明度', 0, 0.8, 0.05, working.bgOpacity, (v) => v.toFixed(2), (v) => {
    working.bgOpacity = v
    apply()
  })
  const bottom = rangeField('底部位置', 0, 40, 1, working.bottomOffset, (v) => `${v}%`, (v) => {
    working.bottomOffset = v
    apply()
  })
  const gap = rangeField('行间距', 0, 24, 1, working.lineGap, (v) => `${v}px`, (v) => {
    working.lineGap = v
    apply()
  })

  const oColor = colorField('原文颜色', working.originalColor, (v) => {
    working.originalColor = v
    apply()
  })
  const tColor = colorField('译文颜色', working.translatedColor, (v) => {
    working.translatedColor = v
    apply()
  })

  // ── Actions ───────────────────────────────────────────
  const status = h('div', { className: 'gl-status' })
  const saveBtn = h('button', { className: 'gl-btn-primary', textContent: '保存' })
  const resetBtn = h('button', { className: 'gl-btn-secondary', textContent: '重置' })
  const closeBtn = h('button', { className: 'gl-btn-secondary', textContent: '关闭' })

  const panel = h('div', { id: SP_ID }, [
    h('h2', { textContent: 'Gistlate 字幕样式' }),
    font.field,
    h('div', { className: 'gl-two' }, [oSize.field, tSize.field]),
    h('div', { className: 'gl-two' }, [oColor.field, tColor.field]),
    weight.field,
    outline.field,
    bgOpacity.field,
    bottom.field,
    gap.field,
    h('div', { className: 'gl-actions' }, [saveBtn, resetBtn, closeBtn]),
    status,
  ])
  document.body.appendChild(panel)

  // Turn on the pinned-sample preview and paint the current working style.
  overlay?.setPreviewMode(true)
  apply()

  saveBtn.addEventListener('click', () => {
    saveSettings({ ...loadSettings(), style: { ...working } })
    Object.assign(saved, working) // new baseline so Close won't revert saved work
    status.textContent = '已保存'
    console.log('[Gistlate] Subtitle style saved')
  })

  resetBtn.addEventListener('click', () => {
    Object.assign(working, DEFAULTS.style)
    font.setValue(working.fontFamily)
    weight.setValue(String(working.fontWeight))
    oSize.setValue(working.originalSize)
    tSize.setValue(working.translatedSize)
    outline.setValue(working.outline)
    bgOpacity.setValue(working.bgOpacity)
    bottom.setValue(working.bottomOffset)
    gap.setValue(working.lineGap)
    oColor.input.value = working.originalColor
    tColor.input.value = working.translatedColor
    apply()
    status.textContent = '已重置为默认（未保存）'
  })

  closeBtn.addEventListener('click', () => {
    overlay?.applyStyle(saved) // discard unsaved working changes
    overlay?.setPreviewMode(false)
    panel.remove()
  })
}
