import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Gistlate',
        namespace: 'https://github.com/j-iNFINITE/gistlate',
        description: 'YouTube bilingual subtitles via LLM + GitHub repo reuse',
        match: ['https://www.youtube.com/*'],
        'run-at': 'document-start',
        connect: [
          'api.github.com',
          'raw.githubusercontent.com',
          '*',
        ],
        // Distribution via GitHub Releases (kept separate from the `pool` data
        // branch). Publish gistlate.user.js / gistlate.meta.js as release assets.
        // Adjust owner/repo here if your repository differs.
        updateURL: 'https://github.com/j-iNFINITE/gistlate/releases/latest/download/gistlate.meta.js',
        downloadURL: 'https://github.com/j-iNFINITE/gistlate/releases/latest/download/gistlate.user.js',
      },
      build: {
        fileName: 'gistlate.user.js',
        metaFileName: true,
      },
    }),
  ],
})
