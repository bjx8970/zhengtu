import { defineConfig, loadEnv } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

/** 从 package.json 读取版本号（唯一事实来源） */
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

/** 构建时的 git 短 SHA（非 git 环境返回 null，仅用于诊断信息展示） */
function resolveGitCommitSha(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
  } catch {
    return null;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  // Debug Trace 侧车默认开启（dev 与生产构建均开启，供玩家在设置页导出诊断文件）；
  // 设为 'false' 时可在构建产物中彻底 dead-code eliminate 调试代码。
  const debugTraceEnabled = env.VITE_ENABLE_DEBUG_TRACE !== 'false';

  return {
    plugins: [solidPlugin()],
    base: '/zhengtu/',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __ZHENGTU_DEBUG_TRACE__: JSON.stringify(debugTraceEnabled),
      __GIT_COMMIT_SHA__: JSON.stringify(resolveGitCommitSha()),
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      target: 'esnext',
      outDir: 'dist',
      sourcemap: false,
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks: undefined,
        },
      },
    },
    server: {
      port: 3000,
      open: false,
    },
  };
});
