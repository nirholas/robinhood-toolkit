/**
 * robinhood-toolkit · Vite configuration
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Two things are load-bearing here.
 *
 * 1. PRE-RENDERING. buildContent() writes one real HTML file per route into this
 *    directory before Vite reads its inputs, and every one of those files is a
 *    build input. The output is a directory of finished documents with no client
 *    router and no SPA fallback, which is the only approach that behaves
 *    identically on Cloudflare Workers, Vercel, Railway, Cloud Run AND GitHub
 *    Pages. Pages has no server execution at all, so any rewrite-based routing
 *    would work on four targets and silently fail on the fifth.
 *
 * 2. CONFIGURABLE BASE. GitHub Pages project sites serve from /<reponame>/, and
 *    the configure-pages action does not inject a base path for Vite the way it
 *    does for Next, Nuxt, Gatsby and SvelteKit. SITE_BASE sets it, the
 *    pre-renderer writes every internal link through it, and the same commit
 *    deploys to a root domain or a project path with no code change:
 *
 *      SITE_BASE=/robinhood-toolkit/ npm run build
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

import { buildContent, normaliseBase } from './scripts/build-content.mjs'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig(async ({ command }) => {
  const base = normaliseBase(process.env.SITE_BASE)

  // Generate before Vite resolves inputs. In dev this also means a restart
  // picks up content edits without any extra command.
  const { pages } = await buildContent({ base, quiet: command === 'serve' })

  return {
    root,
    base,
    publicDir: 'public',
    appType: 'mpa',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: false,
      rollupOptions: {
        input: Object.fromEntries(pages.map((page) => [page.file.replace(/\//g, '-'), resolve(root, page.file)]))
      }
    },
    server: {
      port: 3000,
      strictPort: false
    },
    preview: {
      port: 4173
    },
    plugins: [
      {
        // Content lives in .mjs modules rather than markdown, so Vite's own HMR
        // graph does not see it. Watch it explicitly and do a full reload.
        name: 'robinhood-toolkit-content-watch',
        apply: 'serve',
        configureServer(server) {
          const watched = [resolve(root, 'content'), resolve(root, 'scripts'), resolve(root, '../prompts')]
          server.watcher.add(watched)
          server.watcher.on('change', async (file) => {
            if (!watched.some((dir) => file.startsWith(dir))) return
            try {
              await buildContent({ base, quiet: true, fresh: true })
              server.ws.send({ type: 'full-reload' })
              server.config.logger.info(`content regenerated after change in ${file}`)
            } catch (error) {
              server.config.logger.error(`content build failed: ${error.message}`)
            }
          })
        }
      }
    ]
  }
})
