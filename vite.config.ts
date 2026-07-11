import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Gistlate',
        namespace: 'https://github.com/elivthrar/gistlate',
        description: 'YouTube bilingual subtitles via LLM + GitHub repo reuse',
        match: ['https://www.youtube.com/*'],
        'run-at': 'document-start',
        connect: [
          'api.github.com',
          'raw.githubusercontent.com',
          '*',
        ],
        updateURL: 'https://raw.githubusercontent.com/elivthrar/gistlate-pool/main/gistlate.meta.js',
        downloadURL: 'https://raw.githubusercontent.com/elivthrar/gistlate-pool/main/gistlate.user.js',
      },
      build: {
        fileName: 'gistlate.user.js',
        metaFileName: true,
      },
    }),
  ],
})
