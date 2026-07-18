import {
  loadSettings,
  saveSettings,
  loadOpenAIKey,
  saveOpenAIKey,
  loadGitHubPat,
  saveGitHubPat,
  type Settings,
} from '../settings'
import { translateBatch } from '../translate/openai'
import { gmFetch } from '../net/gm'

const PANEL_ID = 'gistlate-panel'
const PANEL_CSS = `
  #${PANEL_ID}-backdrop {
    position: fixed; inset: 0; z-index: 999999;
    background: rgba(0,0,0,.6);
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px; color: #e0e0e0;
  }
  #${PANEL_ID}-modal {
    background: #1a1a2e; border-radius: 12px; padding: 24px 28px;
    min-width: 420px; max-width: 520px; max-height: 85vh; overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0,0,0,.5);
  }
  #${PANEL_ID}-modal h2 { margin: 0 0 16px; font-size: 18px; color: #fff; }
  #${PANEL_ID}-modal h3 {
    margin: 16px 0 8px; font-size: 12px; color: #aaa;
    text-transform: uppercase; letter-spacing: .5px;
  }
  #${PANEL_ID}-modal label {
    display: block; margin: 8px 0 2px; font-size: 12px; color: #888;
  }
  #${PANEL_ID}-modal input, #${PANEL_ID}-modal select {
    width: 100%; padding: 8px 10px; border: 1px solid #333; border-radius: 6px;
    background: #16213e; color: #e0e0e0; font-size: 13px; box-sizing: border-box; outline: none;
  }
  #${PANEL_ID}-modal input:focus { border-color: #4a9eff; }
  #${PANEL_ID}-modal input[type="password"] { letter-spacing: 1px; }
  #${PANEL_ID}-modal .gl-row { display: flex; gap: 8px; align-items: end; }
  #${PANEL_ID}-modal .gl-row input { flex: 1; }
  #${PANEL_ID}-modal .gl-row button { flex-shrink: 0; white-space: nowrap; }
  #${PANEL_ID}-modal button {
    padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;
  }
  #${PANEL_ID}-modal .gl-btn-primary { background: #4a9eff; color: #fff; }
  #${PANEL_ID}-modal .gl-btn-primary:hover { background: #3a8eef; }
  #${PANEL_ID}-modal .gl-btn-secondary { background: #333; color: #ccc; }
  #${PANEL_ID}-modal .gl-btn-secondary:hover { background: #444; }
  #${PANEL_ID}-modal .gl-btn-test {
    background: transparent; border: 1px solid #555; color: #aaa; font-size: 12px; padding: 6px 12px;
  }
  #${PANEL_ID}-modal .gl-btn-test:hover { border-color: #888; color: #ddd; }
  #${PANEL_ID}-modal .gl-btn-test:disabled { opacity: .5; cursor: wait; }
  #${PANEL_ID}-modal .gl-actions { display: flex; gap: 8px; justify-content: end; margin-top: 20px; }
  #${PANEL_ID}-modal .gl-status { font-size: 12px; margin-top: 4px; min-height: 1.2em; }
  #${PANEL_ID}-modal .gl-hint { font-size: 12px; color: #888; line-height: 1.5; margin: 5px 0 8px; }
  #${PANEL_ID}-modal .gl-ok { color: #4caf50; }
  #${PANEL_ID}-modal .gl-err { color: #ef5350; }
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

function labeledInput(
  labelText: string,
  id: string,
  type: string,
  value: string,
  placeholder: string,
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = h('label', { textContent: labelText, htmlFor: id })
  const input = h('input', { id, type, value, placeholder })
  return { label, input }
}

export function openSettingsPanel(): void {
  if (document.getElementById(`${PANEL_ID}-backdrop`)) return

  const settings = loadSettings()
  const openaiKey = loadOpenAIKey()
  const githubPat = loadGitHubPat()

  // Inject styles (idempotent)
  if (!document.getElementById(`${PANEL_ID}-style`)) {
    const style = h('style', { id: `${PANEL_ID}-style`, textContent: PANEL_CSS })
    document.head.appendChild(style)
  }

  // ── Fields ─────────────────────────────────
  const tgtF = labeledInput('目标语言 (BCP-47)', 'gl-tgt', 'text', settings.tgt, 'zh-Hans')

  const displaySelect = h('select', { id: 'gl-display' }, [
    h('option', {
      value: 'bilingual',
      textContent: '双语 (原文+译文)',
      selected: settings.displayMode === 'bilingual',
    }),
    h('option', {
      value: 'translation-only',
      textContent: '仅译文',
      selected: settings.displayMode === 'translation-only',
    }),
  ])
  const displayLabel = h('label', { textContent: '显示模式', htmlFor: 'gl-display' })

  const strategySelect = h('select', { id: 'gl-translation-mode' }, [
    h('option', {
      value: 'sentence',
      textContent: '一句一次（最稳、最早显示）',
      selected: settings.translation.mode === 'sentence',
    }),
    h('option', {
      value: 'batch',
      textContent: 'N 句一次（平衡速度与可靠性）',
      selected: settings.translation.mode === 'batch',
    }),
    h('option', {
      value: 'whole',
      textContent: '全量一次（请求最少、完成后显示）',
      selected: settings.translation.mode === 'whole',
    }),
  ])
  const strategyLabel = h('label', { textContent: '翻译请求模式', htmlFor: 'gl-translation-mode' })
  const batchSizeF = labeledInput(
    '每批完整句数（2–32）',
    'gl-translation-batch-size',
    'number',
    String(settings.translation.batchSize),
    '8',
  )
  batchSizeF.input.min = '2'
  batchSizeF.input.max = '32'
  batchSizeF.input.step = '1'
  const batchSizeBox = h('div', {}, [batchSizeF.label, batchSizeF.input])
  const strategyHint = h('p', {
    className: 'gl-hint',
    textContent: '模式只影响新翻译；已有缓存不会自动重做。要用新模式处理当前视频，请使用“重新翻译当前视频”。',
  })
  const updateBatchVisibility = () => {
    batchSizeBox.style.display = strategySelect.value === 'batch' ? 'block' : 'none'
  }
  strategySelect.addEventListener('change', updateBatchVisibility)
  updateBatchVisibility()

  const oaiUrlF = labeledInput('Base URL', 'gl-openai-url', 'text', settings.openai.baseUrl, 'https://api.openai.com/v1')
  const oaiModelF = labeledInput('模型', 'gl-openai-model', 'text', settings.openai.model, 'gpt-4o-mini')
  const oaiKeyF = labeledInput('API Key', 'gl-openai-key', 'password', openaiKey, 'sk-...')
  const oaiTestBtn = h('button', { className: 'gl-btn-test', textContent: '测试连接' })
  const oaiStatus = h('div', { className: 'gl-status' })

  const ghOwnerF = labeledInput('Owner', 'gl-gh-owner', 'text', settings.github.owner, 'your-username')
  const ghRepoF = labeledInput('Repo', 'gl-gh-repo', 'text', settings.github.repo, 'gistlate-pool')
  const ghBranchF = labeledInput('Branch', 'gl-gh-branch', 'text', settings.github.branch, 'main')
  const ghPatF = labeledInput('PAT (public_repo scope)', 'gl-gh-pat', 'password', githubPat, 'ghp_...')
  const ghTestBtn = h('button', { className: 'gl-btn-test', textContent: '测试连接' })
  const ghStatus = h('div', { className: 'gl-status' })

  const cancelBtn = h('button', { className: 'gl-btn-secondary', textContent: '取消' })
  const saveBtn = h('button', { className: 'gl-btn-primary', textContent: '保存' })

  // ── Assemble modal ─────────────────────────
  const modal = h('div', { id: `${PANEL_ID}-modal` }, [
    h('h2', { textContent: 'Gistlate 设置' }),

    tgtF.label, tgtF.input,
    displayLabel, displaySelect,

    h('h3', { textContent: '翻译策略' }),
    strategyLabel, strategySelect,
    batchSizeBox,
    strategyHint,

    h('h3', { textContent: 'OpenAI' }),
    oaiUrlF.label, oaiUrlF.input,
    oaiModelF.label, oaiModelF.input,
    oaiKeyF.label,
    h('div', { className: 'gl-row' }, [oaiKeyF.input, oaiTestBtn]),
    oaiStatus,

    h('h3', { textContent: 'GitHub 池仓库' }),
    ghOwnerF.label, ghOwnerF.input,
    ghRepoF.label, ghRepoF.input,
    ghBranchF.label, ghBranchF.input,
    ghPatF.label,
    h('div', { className: 'gl-row' }, [ghPatF.input, ghTestBtn]),
    ghStatus,

    h('div', { className: 'gl-actions' }, [cancelBtn, saveBtn]),
  ])

  const backdrop = h('div', { id: `${PANEL_ID}-backdrop` }, [modal])
  document.body.appendChild(backdrop)

  // ── Events ─────────────────────────────────

  oaiTestBtn.addEventListener('click', async () => {
    oaiTestBtn.disabled = true
    oaiStatus.textContent = '测试中...'
    oaiStatus.className = 'gl-status'
    try {
      await translateBatch(
        ['hello'],
        'zh-Hans',
        { baseUrl: oaiUrlF.input.value, model: oaiModelF.input.value },
        oaiKeyF.input.value,
        undefined,
        1,
      )
      oaiStatus.textContent = '✅ 连接成功'
      oaiStatus.className = 'gl-status gl-ok'
    } catch (e) {
      oaiStatus.textContent = `❌ ${(e as Error).message.slice(0, 120)}`
      oaiStatus.className = 'gl-status gl-err'
    } finally {
      oaiTestBtn.disabled = false
    }
  })

  ghTestBtn.addEventListener('click', async () => {
    ghTestBtn.disabled = true
    ghStatus.textContent = '测试中...'
    ghStatus.className = 'gl-status'
    try {
      const r = await gmFetch({
        method: 'GET',
        url: `https://api.github.com/repos/${ghOwnerF.input.value}/${ghRepoF.input.value}`,
        headers: { Authorization: `Bearer ${ghPatF.input.value}` },
      })
      if (r.status === 200) {
        ghStatus.textContent = '✅ 仓库访问正常'
        ghStatus.className = 'gl-status gl-ok'
      } else if (r.status === 401) {
        ghStatus.textContent = '❌ PAT 无效或权限不足'
        ghStatus.className = 'gl-status gl-err'
      } else if (r.status === 404) {
        ghStatus.textContent = '❌ 仓库不存在或没有读取权限'
        ghStatus.className = 'gl-status gl-err'
      } else {
        ghStatus.textContent = `❌ ${r.status}`
        ghStatus.className = 'gl-status gl-err'
      }
    } catch (e) {
      ghStatus.textContent = `❌ ${(e as Error).message.slice(0, 120)}`
      ghStatus.className = 'gl-status gl-err'
    } finally {
      ghTestBtn.disabled = false
    }
  })

  cancelBtn.addEventListener('click', () => backdrop.remove())

  saveBtn.addEventListener('click', () => {
    const newSettings: Settings = {
      tgt: tgtF.input.value || 'zh-Hans',
      displayMode: displaySelect.value as Settings['displayMode'],
      openai: {
        baseUrl: oaiUrlF.input.value || 'https://api.openai.com/v1',
        model: oaiModelF.input.value || 'gpt-4o-mini',
      },
      github: {
        owner: ghOwnerF.input.value.trim(),
        repo: ghRepoF.input.value.trim(),
        branch: ghBranchF.input.value.trim() || 'main',
      },
      translation: {
        mode: strategySelect.value as Settings['translation']['mode'],
        batchSize: Math.min(32, Math.max(2, Math.trunc(Number(batchSizeF.input.value) || 8))),
      },
      // Preserve subtitle style — it is edited only in the style panel. Re-read
      // at save time so a style saved there while this modal is open (both can be
      // open at once) is not clobbered by this snapshot.
      style: loadSettings().style,
    }
    saveSettings(newSettings)
    saveOpenAIKey(oaiKeyF.input.value)
    saveGitHubPat(ghPatF.input.value)
    backdrop.remove()
    console.log('[Gistlate] Settings saved')
  })

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove()
  })
}
