import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { presetUno, presetAttributify, presetIcons } from 'unocss'
import transformerDirective from '@unocss/transformer-directives'
import Replace from 'unplugin-replace/vite'

process.env = { ...process.env, ...loadEnv(process.env.NODE_ENV!, process.cwd()) }
const mainPlugins = [
  externalizeDepsPlugin({
    exclude: [
      '@geekgeekrun/utils',
      'find-chrome-bin',
      '@geekgeekrun/launch-bosszhipin-login-page-with-preload-extension'
    ]
  }),
  Replace({
    delimiters: ['', ''],
    sourcemap: true,
    include: ['**/src/main/utils/gtag/Analytics.ts'],
    values: [
      {
        find: /<measurement_id>/g,
        replacement: process.env.VITE_APP_GTAG_MEASUREMENT_ID as string
      },
      {
        find: /<api_secret>/g,
        replacement: process.env.VITE_APP_GTAG_API_SECRET as string
      }
    ]
  })
]
const preloadPlugins = [externalizeDepsPlugin()]
const rendererPlugins = [
  vue(),
  UnoCSS({
    presets: [presetUno(), presetAttributify(), presetIcons()],
    transformers: [transformerDirective()]
  })
]
if (process.env.NODE_ENV) {
  ;[mainPlugins, preloadPlugins, rendererPlugins].forEach((pluginList) => {
    pluginList.push(
      Replace({
        delimiters: ['', ''],
        sourcemap: true,
        include: ['**'],
        values: [
          {
            find: /process.env.NODE_ENV/g,
            replacement: `'${process.env.NODE_ENV}'` as string
          }
        ]
      })
    )
  })
}

export default defineConfig({
  main: {
    build: {
      // 每次构建先清空 out/main，避免多次构建堆叠出哈希对不上的悬挂 chunk（如 local-storage-*.js 找不到）
      emptyOutDir: true,
      rollupOptions: {
        external: []
      },
      minify: process.env.NODE_ENV === 'development' ? undefined : 'terser',
      watch: process.env.NODE_ENV === 'development' ? {} : undefined
    },
    plugins: mainPlugins
  },
  preload: {
    plugins: preloadPlugins,
    build: {
      emptyOutDir: true,
      minify: process.env.NODE_ENV === 'development' ? undefined : 'terser',
      watch: process.env.NODE_ENV === 'development' ? {} : undefined
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: rendererPlugins,
    build: {
      emptyOutDir: true,
      minify: process.env.NODE_ENV === 'development' ? undefined : 'terser'
    }
  }
})
