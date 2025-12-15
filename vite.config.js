import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// GitHubのリポジトリ名（例: https://github.com/<you>/plank-trainer なら "plank-trainer"）
const REPO_NAME = 'plank-trainer'

// GitHub Actions / GitHub Pages用のビルド判定
// - どちらかをtrueにすればOK（好みで運用してください）
const isGhPages =
  process.env.GITHUB_PAGES === 'true' ||
  process.env.GITHUB_ACTIONS === 'true'

export default defineConfig({
  plugins: [
    react(),
    // 開発時に https://localhost を使うため（自己署名証明書）
    basicSsl(),
  ],

  // GitHub Pagesはサブパス配信になるため base を合わせる
  // 例: https://<you>.github.io/plank-trainer/ なら "/plank-trainer/"
  base: isGhPages ? `/${REPO_NAME}/` : '/',

  server: {
    https: true,  // iPhone Safariでカメラを使う開発時に重要
    host: true,   // LAN内のスマホからPCの開発サーバへアクセス可能にする
    port: 5173,
    strictPort: true,
  },

  preview: {
    port: 4173,
    strictPort: true,
  },
})
