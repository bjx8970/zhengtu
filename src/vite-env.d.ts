/// <reference types="vite/client" />

/** 构建时注入的软件版本号（来源：package.json） */
declare const __APP_VERSION__: string;

/** Debug Trace 侧车编译期开关（vite.config.ts define 注入，默认 true） */
declare const __ZHENGTU_DEBUG_TRACE__: boolean;

/** 构建时的 git 短 SHA（非 git 环境为 null，仅用于诊断信息展示） */
declare const __GIT_COMMIT_SHA__: string | null;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** 设为 'false' 时构建产物彻底移除 Debug Trace 代码 */
  readonly VITE_ENABLE_DEBUG_TRACE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
